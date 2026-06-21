import { ArrHttpClient, findQualityProfile, type QualityProfile } from "./http.js";
import { sleep } from "../util/sleep.js";

type RadarrMovieLookup = {
  title: string;
  originalTitle?: string;
  year: number;
  tmdbId: number;
  titleSlug: string;
  status?: string;
  inCinemas?: string;
  digitalRelease?: string;
  physicalRelease?: string;
  images?: unknown[];
};

type RadarrMovie = RadarrMovieLookup & {
  id: number;
  path?: string;
};

type RadarrHistoryPage = {
  records: Array<{
    id?: number;
    eventType: string;
    date: string;
    movieId: number;
    sourceTitle?: string;
    movie?: {
      title?: string;
      year?: number;
    };
  }>;
};

type RadarrQueuePage = {
  records: Array<{
    movieId?: number;
    title?: string;
    status?: string;
  }>;
};

export type RadarrSearchResult =
  | { status: "already_exists"; title: string }
  | { status: "unreleased"; title: string }
  | { status: "found"; title: string }
  | { status: "not_found"; title: string };

export type RadarrRelease = {
  id: string;
  title: string;
  year?: number;
  date: Date;
};

export class RadarrClient {
  private readonly http: ArrHttpClient;

  constructor(
    baseUrl: string,
    apiKey: string,
    private readonly rootFolderPath: string,
    private readonly minimumAvailability: string,
    private readonly timeoutMs: number,
    private readonly pollIntervalMs: number
  ) {
    this.http = new ArrHttpClient(baseUrl, apiKey);
  }

  async addAndSearch(title: string, year: number, qualityProfileName: string): Promise<RadarrSearchResult> {
    const match = await this.lookupMovie(title, year);
    const existing = await this.findExistingMovie(match.tmdbId);

    if (existing) {
      return { status: "already_exists", title: existing.title };
    }

    const qualityProfile = await this.getQualityProfile(qualityProfileName);
    const movie = await this.addMovie(match, qualityProfile.id);
    if (this.isUnreleasedMovie(match)) {
      return { status: "unreleased", title: movie.title };
    }

    const startedAt = new Date();

    await this.http.post("/api/v3/command", {
      name: "MoviesSearch",
      movieIds: [movie.id]
    });

    const found = await this.pollForMovieGrab(movie.id, startedAt);
    return { status: found ? "found" : "not_found", title: movie.title };
  }

  async getImportedMoviesSince(since: Date): Promise<RadarrRelease[]> {
    const history = await this.http.get<RadarrHistoryPage>("/api/v3/history", {
      page: 1,
      pageSize: 100,
      sortKey: "date",
      sortDirection: "descending"
    });

    return history.records
      .filter((record) => this.isMovieImportEvent(record.eventType))
      .filter((record) => new Date(record.date) > since)
      .map((record) => ({
        id: String(record.id ?? `${record.movieId}:${record.date}:${record.eventType}`),
        title: record.movie?.title || record.sourceTitle || `Movie ${record.movieId}`,
        year: record.movie?.year,
        date: new Date(record.date)
      }));
  }

  private async lookupMovie(title: string, year: number): Promise<RadarrMovieLookup> {
    const results = await this.http.get<RadarrMovieLookup[]>("/api/v3/movie/lookup", {
      term: `${title} ${year}`
    });

    const exact = results.find(
      (movie) => movie.year === year && movie.title.toLowerCase() === title.toLowerCase()
    );
    const sameYear = results.find((movie) => movie.year === year);
    const match = exact || sameYear || results[0];

    if (!match) {
      throw new Error(`Could not identify movie "${title} ${year}" in Radarr.`);
    }

    return match;
  }

  private async findExistingMovie(tmdbId: number): Promise<RadarrMovie | undefined> {
    const movies = await this.http.get<RadarrMovie[]>("/api/v3/movie");
    return movies.find((movie) => movie.tmdbId === tmdbId);
  }

  private async getQualityProfile(name: string): Promise<QualityProfile> {
    const profiles = await this.http.get<QualityProfile[]>("/api/v3/qualityprofile");
    return findQualityProfile(profiles, name);
  }

  private async addMovie(movie: RadarrMovieLookup, qualityProfileId: number): Promise<RadarrMovie> {
    return this.http.post<RadarrMovie>("/api/v3/movie", {
      title: movie.title,
      qualityProfileId,
      titleSlug: movie.titleSlug,
      images: movie.images || [],
      tmdbId: movie.tmdbId,
      year: movie.year,
      rootFolderPath: this.rootFolderPath,
      monitored: true,
      minimumAvailability: this.minimumAvailability,
      addOptions: {
        searchForMovie: false
      }
    });
  }

  private async pollForMovieGrab(movieId: number, startedAt: Date): Promise<boolean> {
    const deadline = Date.now() + this.timeoutMs;

    while (Date.now() < deadline) {
      const [history, queue] = await Promise.all([
        this.http.get<RadarrHistoryPage>("/api/v3/history", {
          movieId,
          page: 1,
          pageSize: 10,
          sortKey: "date",
          sortDirection: "descending"
        }),
        this.http.get<RadarrQueuePage>("/api/v3/queue", {
          movieId,
          page: 1,
          pageSize: 10
        })
      ]);

      const grabbed = history.records.some((record) => {
        if (record.movieId !== movieId || new Date(record.date) < startedAt) return false;
        return ["grabbed", ...movieImportEvents].includes(record.eventType);
      });
      const queued = queue.records.some((record) => record.movieId === movieId);

      if (grabbed || queued) {
        return true;
      }

      await sleep(this.pollIntervalMs);
    }

    return false;
  }

  private isMovieImportEvent(eventType: string): boolean {
    return movieImportEvents.includes(eventType);
  }

  private isUnreleasedMovie(movie: RadarrMovieLookup): boolean {
    if (movie.status && movie.status !== "released") {
      return true;
    }

    const now = Date.now();
    const knownReleaseTimes = [movie.digitalRelease, movie.physicalRelease, movie.inCinemas]
      .map((value) => (value ? Date.parse(value) : Number.NaN))
      .filter(Number.isFinite);

    return knownReleaseTimes.length > 0 && knownReleaseTimes.every((time) => time > now);
  }
}

const movieImportEvents = ["movieFileImported", "downloadFolderImported"];
