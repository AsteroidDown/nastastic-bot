import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { URL } from "node:url";
import { type AppConfig } from "../config.js";
import { type RadarrRelease } from "../arr/radarr.js";
import { type SonarrRelease } from "../arr/sonarr.js";
import { type ReleaseAnnouncer } from "../discord/releases.js";

type WebhookServices = {
  config: AppConfig;
  announcer: ReleaseAnnouncer;
};

type RadarrWebhookPayload = {
  eventType?: string;
  isUpgrade?: boolean;
  movie?: {
    id?: number;
    title?: string;
    year?: number;
  };
  movieFile?: {
    id?: number;
  };
};

type SonarrWebhookPayload = {
  eventType?: string;
  isUpgrade?: boolean;
  series?: {
    id?: number;
    title?: string;
    year?: number;
  };
  episodes?: Array<{
    id?: number;
    seasonNumber?: number;
    episodeNumber?: number;
    title?: string;
  }>;
  episodeFile?: {
    id?: number;
  };
};

type WebhookResult =
  | { status: "announced" }
  | { status: "ignored"; reason: string };

export function startArrWebhookServer(services: WebhookServices): Server | undefined {
  if (!services.config.webhooks.enabled) {
    return undefined;
  }

  const server = createServer((request, response) => {
    void routeRequest(request, response, services);
  });

  server.listen(services.config.webhooks.port, services.config.webhooks.host, () => {
    const { host, port } = services.config.webhooks;
    console.log(`ARR webhook server listening on http://${host}:${port}`);
  });

  return server;
}

async function routeRequest(
  request: IncomingMessage,
  response: ServerResponse,
  services: WebhookServices
): Promise<void> {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (request.method !== "POST") {
      sendJson(response, 405, { error: "Method not allowed" });
      return;
    }

    if (!isAuthorized(request, url, services.config.webhooks.token)) {
      sendJson(response, 401, { error: "Unauthorized" });
      return;
    }

    const payload = await readJsonBody(request);

    if (url.pathname === "/webhooks/radarr" || url.pathname === "/webhook/radarr") {
      const result = await handleRadarrWebhook(payload as RadarrWebhookPayload, services.announcer);
      logWebhookResult("radarr", payload, result);
      sendJson(response, 202, { ok: true, ...result });
      return;
    }

    if (url.pathname === "/webhooks/sonarr" || url.pathname === "/webhook/sonarr") {
      const result = await handleSonarrWebhook(payload as SonarrWebhookPayload, services.announcer);
      logWebhookResult("sonarr", payload, result);
      sendJson(response, 202, { ok: true, ...result });
      return;
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    console.error("Failed to handle ARR webhook", error);
    sendJson(response, 500, { error: "Webhook handling failed" });
  }
}

async function handleRadarrWebhook(
  payload: RadarrWebhookPayload,
  announcer: ReleaseAnnouncer
): Promise<WebhookResult> {
  if (payload.eventType !== "Download") {
    return { status: "ignored", reason: `unsupported event type ${payload.eventType || "unknown"}` };
  }
  if (payload.isUpgrade) {
    return { status: "ignored", reason: "upgrade event" };
  }
  if (!payload.movie?.title) {
    return { status: "ignored", reason: "missing movie title" };
  }

  const release: RadarrRelease = {
    id: String(payload.movieFile?.id ?? payload.movie.id ?? payload.movie.title),
    title: payload.movie.title,
    year: payload.movie.year,
    date: new Date()
  };

  await announcer.announceMovie(release);
  return { status: "announced" };
}

async function handleSonarrWebhook(
  payload: SonarrWebhookPayload,
  announcer: ReleaseAnnouncer
): Promise<WebhookResult> {
  if (payload.eventType !== "Download") {
    return { status: "ignored", reason: `unsupported event type ${payload.eventType || "unknown"}` };
  }
  if (payload.isUpgrade) {
    return { status: "ignored", reason: "upgrade event" };
  }
  if (!payload.series?.title) {
    return { status: "ignored", reason: "missing series title" };
  }

  const episodes = payload.episodes?.length ? payload.episodes : [undefined];

  for (const episode of episodes) {
    const release: SonarrRelease = {
      id: String(episode?.id ?? payload.episodeFile?.id ?? payload.series.id ?? payload.series.title),
      title: payload.series.title,
      year: payload.series.year,
      seasonNumber: episode?.seasonNumber,
      episodeNumber: episode?.episodeNumber,
      episodeTitle: episode?.title,
      date: new Date()
    };

    await announcer.announceShow(release);
  }

  return { status: "announced" };
}

function isAuthorized(request: IncomingMessage, url: URL, token: string | undefined): boolean {
  if (!token) return true;

  const queryToken = url.searchParams.get("token");
  const headerToken = request.headers["x-nastastic-token"];
  const authorization = request.headers.authorization;

  return (
    queryToken === token ||
    headerToken === token ||
    authorization === `Bearer ${token}`
  );
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalLength = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalLength += buffer.length;

    if (totalLength > 1024 * 1024) {
      throw new Error("Webhook payload was larger than 1MB.");
    }

    chunks.push(buffer);
  }

  const body = Buffer.concat(chunks).toString("utf8").trim();
  if (!body) return {};

  return JSON.parse(body);
}

function sendJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

function logWebhookResult(source: "radarr" | "sonarr", payload: unknown, result: WebhookResult): void {
  const summary = payloadSummary(payload);
  console.log(`[webhook] ${JSON.stringify({ source, ...summary, ...result })}`);
}

function payloadSummary(payload: unknown): Record<string, unknown> {
  if (!payload || typeof payload !== "object") {
    return { eventType: "unknown" };
  }

  const record = payload as Record<string, unknown>;
  const movie = valueRecord(record.movie);
  const series = valueRecord(record.series);

  return {
    eventType: record.eventType,
    isUpgrade: record.isUpgrade,
    title: valueString(movie?.title) || valueString(series?.title)
  };
}

function valueRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function valueString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
