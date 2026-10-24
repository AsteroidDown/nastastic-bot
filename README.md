# NAStastic Bot

Discord request bot for adding movies to Radarr and shows/seasons to Sonarr.

## Request formats

Movies channel:

```text
Back to the Future
Superbad 2011 1080p
Superbad 2011
```

Title-only movie requests search Radarr. If exactly one match is found, the bot starts the download automatically; otherwise it asks you to pick from the possible matches.

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
Season requests compare releases before queuing any downloads:

- Pack candidates must contain the exact requested season token followed by a literal space or period, such as `S01 ` or `S01.`. Single episodes, other seasons, multi-season packs, and conflicting Sonarr metadata are excluded from pack choices.
- The bot separately searches each missing, aired episode in that season. Only single-episode releases approved by Sonarr can form an automatic episode download set. Existing files and queued episodes are skipped.
- When all missing episodes have approved releases, the bot compares their combined download size with the smallest approved pack and queues the smaller option. A pack is only queued automatically when the entire season is aired and missing. Every automatic choice must pass Sonarr's current profile and custom-format checks; minimum file size alone does not bypass them.
- If no complete approved option exists, Discord lists up to 5 matching packs for manual selection, ordered by approval then size. Choices use the compact format `The Ark (2023) S01 | 1080p | 17.1 GiB | ~1.4 GiB/episode`, showing only the title, season, resolution, total size, and estimated average size per episode. Release details, rejection reasons, indexer, seeder count, and quality-profile labels are omitted. Rejected packs require manual selection and are sent as override grabs.

A pack's average size per episode is an estimate, not a measurement of its individual files. The bot does not automatically override a custom-format score rejection based on that average: a score rejection may involve other conditions as well as size. Approved individual episodes can still be downloaded when pack scoring fails. For example, twelve 350 MiB episodes total about 4.1 GiB, so they are preferred over an approved 17.1 GiB pack. No fixed 350 MiB or 1.5 GiB limit is imposed; Sonarr's configured profile decides which releases qualify.

Searches for individual episodes run sequentially to limit load on indexers, so season requests can take longer. Release searches use `SEARCH_TIMEOUT_SECONDS` (at least 30 seconds) for each request. A connection that closes unexpectedly during a read is retried once; download grabs are never retried automatically. If an episode search still fails, the bot preserves matching packs for manual selection and explains that the size comparison is unavailable. It does not automatically download a pack after a failed comparison. An incomplete set is not queued automatically. If a grab fails partway through, the bot reports how many downloads were queued; retrying skips episodes already in Sonarr's queue. Whole-show `Full` requests continue to use Sonarr's standard series search.

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
