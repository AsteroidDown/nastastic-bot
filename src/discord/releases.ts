import { type Client } from "discord.js";
import { type AppConfig } from "../config.js";
import { type RadarrClient, type RadarrRelease } from "../arr/radarr.js";
import { type SonarrClient, type SonarrRelease } from "../arr/sonarr.js";

type ReleaseMonitorServices = {
  config: AppConfig;
  radarr: RadarrClient;
  sonarr: SonarrClient;
};

export function startReleaseMonitor(client: Client, services: ReleaseMonitorServices): void {
  const announced = new Set<string>();
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
        const key = `movie:${movie.id}`;
        if (announced.has(key)) continue;

        await sendToChannel(
          client,
          services.config.discord.movieReleasesChannelId,
          formatMovieRelease(movie)
        );
        announced.add(key);
      }

      for (const show of shows.sort(byReleaseDate)) {
        const key = `show:${show.id}`;
        if (announced.has(key)) continue;

        await sendToChannel(
          client,
          services.config.discord.showReleasesChannelId,
          formatShowRelease(show)
        );
        announced.add(key);
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
