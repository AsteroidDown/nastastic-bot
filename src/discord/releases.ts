import { type Client } from "discord.js";
import { type AppConfig } from "../config.js";
import { type RadarrClient, type RadarrRelease } from "../arr/radarr.js";
import { type SonarrClient, type SonarrRelease } from "../arr/sonarr.js";

type ReleaseMonitorServices = {
  config: AppConfig;
  radarr: RadarrClient;
  sonarr: SonarrClient;
};

export type ReleaseAnnouncer = {
  announceMovie(release: RadarrRelease): Promise<void>;
  announceShow(release: SonarrRelease): Promise<void>;
};

export function createReleaseAnnouncer(client: Client, config: AppConfig): ReleaseAnnouncer {
  const announced = new Set<string>();

  return {
    async announceMovie(release: RadarrRelease): Promise<void> {
      const key = movieReleaseKey(release);
      if (announced.has(key)) return;

      await sendToChannel(client, config.discord.movieReleasesChannelId, formatMovieRelease(release));
      announced.add(key);
    },
    async announceShow(release: SonarrRelease): Promise<void> {
      const key = showReleaseKey(release);
      if (announced.has(key)) return;

      await sendToChannel(client, config.discord.showReleasesChannelId, formatShowRelease(release));
      announced.add(key);
    }
  };
}

export function startReleaseMonitor(
  services: ReleaseMonitorServices,
  announcer: ReleaseAnnouncer
): void {
  let lastChecked = new Date();
  let running = false;

  const poll = async (): Promise<void> => {
    if (running) return;
    running = true;
    const startedAt = new Date();

    try {
      const [movies, shows] = await Promise.all([
        services.radarr.getImportedMoviesSince(lastChecked),
        services.sonarr.getImportedEpisodesSince(lastChecked)
      ]);

      for (const movie of movies.sort(byReleaseDate)) {
        await announcer.announceMovie(movie);
      }

      for (const show of shows.sort(byReleaseDate)) {
        await announcer.announceShow(show);
      }

      lastChecked = startedAt;
    } catch (error) {
      console.error("Failed to poll release history", error);
    } finally {
      running = false;
    }
  };

  const interval = setInterval(() => {
    void poll();
  }, services.config.releases.pollIntervalMs);

  interval.unref();
  void poll();
}

function movieReleaseKey(release: RadarrRelease): string {
  return `movie:${release.title.toLowerCase()}:${release.year ?? ""}`;
}

function showReleaseKey(release: SonarrRelease): string {
  return [
    "show",
    release.title.toLowerCase(),
    release.year ?? "",
    release.seasonNumber ?? "",
    release.episodeNumber ?? "",
    release.episodeTitle?.toLowerCase() ?? ""
  ].join(":");
}

function formatMovieRelease(release: RadarrRelease): string {
  const title = release.year ? `${release.title} (${release.year})` : release.title;
  return `${title} has been added to the server!`;
}

function formatShowRelease(release: SonarrRelease): string {
  const title = release.year ? `${release.title} (${release.year})` : release.title;
  const episode =
    release.seasonNumber !== undefined && release.episodeNumber !== undefined
      ? ` S${String(release.seasonNumber).padStart(2, "0")}E${String(release.episodeNumber).padStart(2, "0")}`
      : "";
  const episodeTitle = release.episodeTitle ? ` - ${release.episodeTitle}` : "";

  return `${title}${episode}${episodeTitle} has been added to the server!`;
}

async function sendToChannel(client: Client, channelId: string, content: string): Promise<void> {
  const channel = await client.channels.fetch(channelId);
  if (!channel || !("isSendable" in channel) || !channel.isSendable()) {
    throw new Error(`Release channel ${channelId} is not sendable or could not be found.`);
  }
  if (!("send" in channel) || typeof channel.send !== "function") {
    throw new Error(`Release channel ${channelId} does not support sending messages.`);
  }

  await channel.send(content);
}

function byReleaseDate(a: { date: Date }, b: { date: Date }): number {
  return a.date.getTime() - b.date.getTime();
}
