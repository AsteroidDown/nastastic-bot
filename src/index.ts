import { RadarrClient } from "./arr/radarr.js";
import { SonarrClient } from "./arr/sonarr.js";
import { loadConfig } from "./config.js";
import { createDiscordClient } from "./discord/messages.js";

async function main(): Promise<void> {
  const config = loadConfig();

  const radarr = new RadarrClient(
    config.radarr.url,
    config.radarr.apiKey,
    config.radarr.rootFolder,
    config.radarr.minimumAvailability,
    config.search.timeoutMs,
    config.search.pollIntervalMs
  );

  const sonarr = new SonarrClient(
    config.sonarr.url,
    config.sonarr.apiKey,
    config.sonarr.rootFolder,
    config.sonarr.seriesType,
    config.search.timeoutMs,
    config.search.pollIntervalMs
  );

  const client = createDiscordClient({ config, radarr, sonarr });
  await client.login(config.discord.token);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
