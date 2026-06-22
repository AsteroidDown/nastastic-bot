# NAStastic Bot

Discord request bot for adding movies to Radarr and shows/seasons to Sonarr.

## Request formats

Movies channel:

```text
Back to the Future
Superbad 2011 1080p
Superbad 2011
```

Title-only movie requests search Radarr and ask you to pick from the possible matches.

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

## Download notifications

The bot receives Radarr and Sonarr webhooks when downloads are imported, then posts release messages immediately.

Configure these environment variables:

```text
WEBHOOK_ENABLED=true
WEBHOOK_HOST=0.0.0.0
WEBHOOK_PORT=3456
WEBHOOK_TOKEN=replace-me
```

In Radarr, add a Webhook connection for the On Import event:

```text
http://<bot-host>:3456/webhooks/radarr?token=<WEBHOOK_TOKEN>
```

In Sonarr, add a Webhook connection for the On Import event:

```text
http://<bot-host>:3456/webhooks/sonarr?token=<WEBHOOK_TOKEN>
```

If the bot runs through Docker Compose, port `3456` is published by default.

## Setup

1. Copy `.env.example` to `.env`.
2. Fill in `DISCORD_TOKEN`, `RADARR_API_KEY`, and `SONARR_API_KEY`.
3. In the Discord Developer Portal, enable the bot's privileged Message Content Intent.
4. Run locally:

```sh
npm install
npm run dev
```

5. Or run with Docker:

```sh
docker compose up -d --build
```

For TrueNAS SCALE custom apps, use the `Dockerfile` image and configure the same environment variables shown in `.env.example`.
