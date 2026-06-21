import { ArrHttpClient, findQualityProfile, type QualityProfile } from "./http.js";
import { sleep } from "../util/sleep.js";

type SonarrSeason = {
  seasonNumber: number;
  monitored: boolean;
};

type SonarrSeriesLookup = {
  title: string;
  year: number;
  tvdbId: number;
  titleSlug: string;
  images?: unknown[];
  seasons?: SonarrSeason[];
};

type SonarrSeries = SonarrSeriesLookup & {
  id: number;
};

type SonarrHistoryPage = {
  records: Array<{
    eventType: string;
    date: string;
    seriesId: number;
    episode?: {
      seasonNumber?: number;
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

export type SonarrSearchScope =
  | { scope: "full"; monitorWholeShow: true }
  | { scope: "season"; seasonNumber: number; monitorWholeShow: boolean };

export type SonarrSearchResult =
  | { status: "already_exists"; title: string }
  | { status: "found"; title: string; seasonNumber?: number }
  | { status: "not_found"; title: string; seasonNumber?: number };

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
    year: number,
    qualityProfileName: string,
    searchScope: SonarrSearchScope
  ): Promise<SonarrSearchResult> {
    const match = await this.lookupSeries(title, year);
    const existing = await this.findExistingSeries(match.tvdbId);

    if (existing) {
      return { status: "already_exists", title: existing.title };
    }

    const qualityProfile = await this.getQualityProfile(qualityProfileName);
    const series = await this.addSeries(match, qualityProfile.id, searchScope);
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

    const found = await this.pollForSeriesGrab(series.id, startedAt, searchScope);
    return {
      status: found ? "found" : "not_found",
      title: series.title,
      seasonNumber: searchScope.scope === "season" ? searchScope.seasonNumber : undefined
    };
  }

  private async lookupSeries(title: string, year: number): Promise<SonarrSeriesLookup> {
    const results = await this.http.get<SonarrSeriesLookup[]>("/api/v3/series/lookup", {
      term: `${title} ${year}`
    });

    const exact = results.find(
      (series) => series.year === year && series.title.toLowerCase() === title.toLowerCase()
    );
    const sameYear = results.find((series) => series.year === year);
    const match = exact || sameYear || results[0];

    if (!match) {
      throw new Error(`Could not identify show "${title} ${year}" in Sonarr.`);
    }

    return match;
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
          eventType: "grabbed",
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
}
