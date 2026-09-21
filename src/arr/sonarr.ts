import { ArrHttpClient, findQualityProfile, type QualityProfile } from "./http.js";
import { sleep } from "../util/sleep.js";

type SonarrSeason = {
  seasonNumber: number;
  monitored: boolean;
};

export type SonarrSeriesLookup = {
  title: string;
  year: number;
  tvdbId: number;
  titleSlug: string;
  status?: string;
  firstAired?: string;
  images?: unknown[];
  seasons?: SonarrSeason[];
};

type SonarrSeries = SonarrSeriesLookup & {
  id: number;
};

type SonarrHistoryPage = {
  records: Array<{
    id?: number;
    eventType: string;
    date: string;
    seriesId: number;
    series?: {
      title?: string;
      year?: number;
    };
    episode?: {
      seasonNumber?: number;
      episodeNumber?: number;
      title?: string;
    };
  }>;
};

type SonarrQueuePage = {
  records: Array<{
    seriesId?: number;
    seasonNumber?: number;
    title?: string;
    status?: string;
  }>;
};

type SonarrRawRelease = Record<string, unknown>;

export type SonarrSearchScope =
  | { scope: "full"; monitorWholeShow: true }
  | { scope: "season"; seasonNumber: number; monitorWholeShow: boolean };

export type SonarrReleaseOption = {
  title: string;
  guid: string;
  indexerId: number;
  indexer?: string;
  quality?: string;
  sizeBytes?: number;
  seeders?: number;
  rejections: string[];
  downloadAllowed: boolean;
  raw: SonarrRawRelease;
};

export type SonarrSearchResult =
  | { status: "already_exists"; title: string }
  | { status: "unreleased"; title: string; seasonNumber?: number }
  | { status: "found"; title: string; seasonNumber?: number }
  | { status: "manual_options"; title: string; seasonNumber: number; releases: SonarrReleaseOption[] }
  | { status: "not_found"; title: string; seasonNumber?: number };

export type SonarrRelease = {
  id: string;
  title: string;
  year?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  date: Date;
};

export class SonarrClient {
  private readonly http: ArrHttpClient;

  constructor(
    baseUrl: string,
    apiKey: string,
    private readonly rootFolderPath: string,
    private readonly seriesType: "standard" | "anime" | "daily",
    private readonly timeoutMs: number,
    private readonly pollIntervalMs: number
  ) {
    this.http = new ArrHttpClient(baseUrl, apiKey);
  }

  async addAndSearch(
    title: string,
    year: number | undefined,
    qualityProfileName: string,
    searchScope: SonarrSearchScope
  ): Promise<SonarrSearchResult> {
    const matches = await this.lookupSeries(title, year);
    const match = matches[0];
    if (!match) {
      throw new Error(`Could not identify show "${title}${year ? ` ${year}` : ""}" in Sonarr.`);
    }

    return this.addLookupAndSearch(match, qualityProfileName, searchScope);
  }

  async lookupSeries(title: string, year?: number): Promise<SonarrSeriesLookup[]> {
    const results = await this.http.get<SonarrSeriesLookup[]>("/api/v3/series/lookup", {
      term: year ? `${title} ${year}` : title
    });

    if (year === undefined) return results;

    const exact = results.find(
      (series) => series.year === year && series.title.toLowerCase() === title.toLowerCase()
    );
    if (exact) return [exact];

    return results.filter((series) => series.year === year);
  }

  async addLookupAndSearch(
    match: SonarrSeriesLookup,
    qualityProfileName: string,
    searchScope: SonarrSearchScope
  ): Promise<SonarrSearchResult> {
    const existing = await this.findExistingSeries(match.tvdbId);

    if (existing) {
      return this.searchExistingSeries(existing, searchScope);
    }

    const qualityProfile = await this.getQualityProfile(qualityProfileName);
    const series = await this.addSeries(match, qualityProfile.id, searchScope);
    if (this.isUnreleasedSeries(match)) {
      return {
        status: "unreleased",
        title: series.title,
        seasonNumber: searchScope.scope === "season" ? searchScope.seasonNumber : undefined
      };
    }

    const startedAt = new Date();

    if (searchScope.scope === "full") {
      await this.http.post("/api/v3/command", {
        name: "SeriesSearch",
        seriesId: series.id
      });
    } else {
      await this.http.post("/api/v3/command", {
        name: "SeasonSearch",
        seriesId: series.id,
        seasonNumber: searchScope.seasonNumber
      });
    }

    return this.buildSearchResult(series.id, series.title, startedAt, searchScope);
  }

  private async searchExistingSeries(
    series: SonarrSeries,
    searchScope: SonarrSearchScope
  ): Promise<SonarrSearchResult> {
    const updatedSeries = await this.updateMonitoredSeasons(series, searchScope);
    const startedAt = new Date();

    if (searchScope.scope === "full") {
      await this.http.post("/api/v3/command", {
        name: "SeriesSearch",
        seriesId: updatedSeries.id
      });
    } else {
      await this.http.post("/api/v3/command", {
        name: "SeasonSearch",
        seriesId: updatedSeries.id,
        seasonNumber: searchScope.seasonNumber
      });
    }

    return this.buildSearchResult(updatedSeries.id, updatedSeries.title, startedAt, searchScope);
  }

  private async buildSearchResult(
    seriesId: number,
    title: string,
    startedAt: Date,
    searchScope: SonarrSearchScope
  ): Promise<SonarrSearchResult> {
    const found = await this.pollForSeriesGrab(seriesId, startedAt, searchScope);
    const seasonNumber = searchScope.scope === "season" ? searchScope.seasonNumber : undefined;

    if (found) {
      return {
        status: "found",
        title,
        seasonNumber
      };
    }

    if (searchScope.scope === "season") {
      const releases = await this.lookupSeasonReleases(seriesId, searchScope.seasonNumber);
      if (releases.length > 0) {
        return {
          status: "manual_options",
          title,
          seasonNumber: searchScope.seasonNumber,
          releases
        };
      }
    }

    return {
      status: "not_found",
      title,
      seasonNumber
    };
  }

  private async findExistingSeries(tvdbId: number): Promise<SonarrSeries | undefined> {
    const series = await this.http.get<SonarrSeries[]>("/api/v3/series");
    return series.find((item) => item.tvdbId === tvdbId);
  }

  private async getQualityProfile(name: string): Promise<QualityProfile> {
    const profiles = await this.http.get<QualityProfile[]>("/api/v3/qualityprofile");
    return findQualityProfile(profiles, name);
  }

  private async addSeries(
    series: SonarrSeriesLookup,
    qualityProfileId: number,
    searchScope: SonarrSearchScope
  ): Promise<SonarrSeries> {
    const seasons = (series.seasons || []).map((season) => ({
      ...season,
      monitored: this.shouldMonitorSeason(season.seasonNumber, searchScope)
    }));

    return this.http.post<SonarrSeries>("/api/v3/series", {
      title: series.title,
      qualityProfileId,
      titleSlug: series.titleSlug,
      images: series.images || [],
      tvdbId: series.tvdbId,
      year: series.year,
      rootFolderPath: this.rootFolderPath,
      monitored: true,
      seasonFolder: true,
      seriesType: this.seriesType,
      seasons,
      addOptions: {
        searchForMissingEpisodes: false
      }
    });
  }

  private async updateMonitoredSeasons(
    series: SonarrSeries,
    searchScope: SonarrSearchScope
  ): Promise<SonarrSeries> {
    return this.http.put<SonarrSeries>(`/api/v3/series/${series.id}`, {
      ...series,
      monitored: true,
      seasons: (series.seasons || []).map((season) => ({
        ...season,
        monitored: season.monitored || this.shouldMonitorSeason(season.seasonNumber, searchScope)
      }))
    });
  }

  private async lookupSeasonReleases(
    seriesId: number,
    seasonNumber: number
  ): Promise<SonarrReleaseOption[]> {
    const releases = await this.http.get<SonarrRawRelease[]>("/api/v3/release", {
      seriesId,
      seasonNumber
    });

    return releases
      .map((release) => this.normalizeRelease(release))
      .filter((release): release is SonarrReleaseOption => release !== undefined);
  }

  async grabRelease(release: SonarrReleaseOption, shouldOverride: boolean): Promise<void> {
    await this.http.post("/api/v3/release", {
      ...release.raw,
      guid: release.guid,
      indexerId: release.indexerId,
      shouldOverride
    });
  }

  private shouldMonitorSeason(seasonNumber: number, searchScope: SonarrSearchScope): boolean {
    if (seasonNumber === 0) return false;
    if (searchScope.monitorWholeShow) return true;
    if (searchScope.scope === "season") return seasonNumber === searchScope.seasonNumber;
    return true;
  }

  private async pollForSeriesGrab(
    seriesId: number,
    startedAt: Date,
    searchScope: SonarrSearchScope
  ): Promise<boolean> {
    const deadline = Date.now() + this.timeoutMs;

    while (Date.now() < deadline) {
      const [history, queue] = await Promise.all([
        this.http.get<SonarrHistoryPage>("/api/v3/history", {
          seriesId,
          page: 1,
          pageSize: 20,
          sortKey: "date",
          sortDirection: "descending"
        }),
        this.http.get<SonarrQueuePage>("/api/v3/queue", {
          seriesId,
          page: 1,
          pageSize: 20
        })
      ]);

      const grabbed = history.records.some((record) => {
        if (record.seriesId !== seriesId || new Date(record.date) < startedAt) return false;
        if (!["grabbed", ...episodeImportEvents].includes(record.eventType)) {
          return false;
        }
        return this.recordMatchesScope(record.episode?.seasonNumber, searchScope);
      });
      const queued = queue.records.some((record) => {
        if (record.seriesId !== seriesId) return false;
        return this.recordMatchesScope(record.seasonNumber, searchScope);
      });

      if (grabbed || queued) {
        return true;
      }

      await sleep(this.pollIntervalMs);
    }

    return false;
  }

  private recordMatchesScope(seasonNumber: number | undefined, searchScope: SonarrSearchScope): boolean {
    if (searchScope.scope === "full") return true;
    return seasonNumber === undefined || seasonNumber === searchScope.seasonNumber;
  }

  private normalizeRelease(release: SonarrRawRelease): SonarrReleaseOption | undefined {
    const nestedRelease = objectValue(release.release);
    const decision = objectValue(release.decision);
    const parsedInfo = objectValue(release.parsedInfo);

    const guid = stringValue(release.guid) || stringValue(nestedRelease?.guid);
    const indexerId = numberValue(release.indexerId) ?? numberValue(nestedRelease?.indexerId);
    const title = stringValue(release.title) || stringValue(nestedRelease?.title);

    if (!guid || indexerId === undefined || !title) {
      return undefined;
    }

    const rejections = stringArrayValue(release.rejections) || stringArrayValue(decision?.rejections) || [];

    return {
      title,
      guid,
      indexerId,
      indexer: stringValue(release.indexer) || stringValue(nestedRelease?.indexer),
      quality: qualityName(release.quality) || qualityName(parsedInfo?.quality),
      sizeBytes: numberValue(release.size) ?? numberValue(nestedRelease?.size),
      seeders: numberValue(release.seeders) ?? numberValue(nestedRelease?.seeders),
      rejections,
      downloadAllowed: booleanValue(release.downloadAllowed) ?? booleanValue(release.approved) ?? rejections.length === 0,
      raw: release
    };
  }

  private isUnreleasedSeries(series: SonarrSeriesLookup): boolean {
    if (series.status === "upcoming") {
      return true;
    }

    if (!series.firstAired) {
      return false;
    }

    const firstAired = Date.parse(series.firstAired);
    return Number.isFinite(firstAired) && firstAired > Date.now();
  }
}

const episodeImportEvents = ["episodeFileImported", "downloadFolderImported"];

function objectValue(value: unknown): SonarrRawRelease | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as SonarrRawRelease)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function qualityName(value: unknown): string | undefined {
  if (typeof value === "string") return value;

  const quality = objectValue(value);
  if (!quality) return undefined;

  const nestedQuality = objectValue(quality.quality);
  return stringValue(quality.name) || stringValue(nestedQuality?.name);
}
