# NAStastic Bot

Discord request bot for adding movies to Radarr and shows/seasons to Sonarr.

## Request formats

Movies channel:

```text
Superbad 2011 1080p
Superbad 2011
```

Shows channel:

```text
Severance 2022 Full 1080p
Severance 2022 Season 1 1080p
Severance 2022 S1 1080p
Severance 2022 1080p
```

If `Full` is omitted and no season is specified, the bot searches season 1 initially.

The bot also posts completed movie and show downloads into the configured release channels.
If a requested movie or show has not released yet, it is still added as monitored and the bot skips the immediate search.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `DISCORD_TOKEN`, `RADARR_API_KEY`, and `SONARR_API_KEY`.
3. Run locally:

```sh
npm install
npm run dev
```

4. Or run with Docker:

```sh
docker compose up -d --build
```

For TrueNAS SCALE custom apps, use the `Dockerfile` image and configure the same environment variables shown in `.env.example`.
