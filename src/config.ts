import "dotenv/config";

export type AppConfig = {
  discord: {
    token: string;
    guildId: string;
    clientId?: string;
    moviesChannelId: string;
    showsChannelId: string;
    movieReleasesChannelId: string;
    showReleasesChannelId: string;
  };
  radarr: {
    url: string;
    apiKey: string;
    rootFolder: string;
    minimumAvailability: string;
    defaultQuality: string;
    qualityMap: Map<string, string>;
  };
  sonarr: {
    url: string;
    apiKey: string;
    rootFolder: string;
    seriesType: "standard" | "anime" | "daily";
    defaultQuality: string;
    qualityMap: Map<string, string>;
  };
  search: {
    timeoutMs: number;
    pollIntervalMs: number;
  };
  webhooks: {
    enabled: boolean;
    host: string;
    port: number;
    token?: string;
  };
};

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  return process.env[name] || undefined;
}

function parseQualityMap(raw: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!raw) return map;

  for (const pair of raw.split(",")) {
    const [key, ...valueParts] = pair.split(":");
    const value = valueParts.join(":").trim();
    if (key?.trim() && value) {
      map.set(key.trim().toLowerCase(), value);
    }
  }

  return map;
}

function numberFromEnv(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive number`);
  }

  return parsed;
}

function booleanFromEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (!value) return fallback;

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;

  throw new Error(`${name} must be true or false`);
}

function seriesTypeFromEnv(value: string): "standard" | "anime" | "daily" {
  if (value === "standard" || value === "anime" || value === "daily") {
    return value;
  }

  throw new Error("SONARR_SERIES_TYPE must be standard, anime, or daily");
}

export function loadConfig(): AppConfig {
  return {
    discord: {
      token: required("DISCORD_TOKEN"),
      guildId: required("DISCORD_GUILD_ID"),
      clientId: optional("DISCORD_CLIENT_ID"),
      moviesChannelId: required("MOVIES_CHANNEL_ID"),
      showsChannelId: required("SHOWS_CHANNEL_ID"),
      movieReleasesChannelId: required("MOVIE_RELEASES_CHANNEL_ID"),
      showReleasesChannelId: required("SHOW_RELEASES_CHANNEL_ID")
    },
    radarr: {
      url: required("RADARR_URL").replace(/\/$/, ""),
      apiKey: required("RADARR_API_KEY"),
      rootFolder: required("RADARR_ROOT_FOLDER"),
      minimumAvailability: process.env.RADARR_MINIMUM_AVAILABILITY || "released",
      defaultQuality: process.env.RADARR_DEFAULT_QUALITY || "HD 1080p",
      qualityMap: parseQualityMap(process.env.RADARR_QUALITY_MAP)
    },
    sonarr: {
      url: required("SONARR_URL").replace(/\/$/, ""),
      apiKey: required("SONARR_API_KEY"),
      rootFolder: required("SONARR_ROOT_FOLDER"),
      seriesType: seriesTypeFromEnv(process.env.SONARR_SERIES_TYPE || "standard"),
      defaultQuality: process.env.SONARR_DEFAULT_QUALITY || "HD 1080p",
      qualityMap: parseQualityMap(process.env.SONARR_QUALITY_MAP)
    },
    search: {
      timeoutMs: numberFromEnv("SEARCH_TIMEOUT_SECONDS", 60) * 1000,
      pollIntervalMs: numberFromEnv("POLL_INTERVAL_SECONDS", 5) * 1000
    },
    webhooks: {
      enabled: booleanFromEnv("WEBHOOK_ENABLED", true),
      host: process.env.WEBHOOK_HOST || "0.0.0.0",
      port: numberFromEnv("WEBHOOK_PORT", 3456),
      token: optional("WEBHOOK_TOKEN")
    }
  };
}

export function resolveQuality(
  token: string | undefined,
  qualityMap: Map<string, string>,
  fallback: string
): string {
  if (!token) return fallback;
  return qualityMap.get(token.toLowerCase()) || fallback;
}
