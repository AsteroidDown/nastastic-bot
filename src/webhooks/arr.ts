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
      await handleRadarrWebhook(payload as RadarrWebhookPayload, services.announcer);
      sendJson(response, 202, { ok: true });
      return;
    }

    if (url.pathname === "/webhooks/sonarr" || url.pathname === "/webhook/sonarr") {
      await handleSonarrWebhook(payload as SonarrWebhookPayload, services.announcer);
      sendJson(response, 202, { ok: true });
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
): Promise<void> {
  if (payload.eventType !== "Download" || payload.isUpgrade) return;
  if (!payload.movie?.title) {
    throw new Error("Radarr webhook payload did not include a movie title.");
  }

  const release: RadarrRelease = {
    id: String(payload.movieFile?.id ?? payload.movie.id ?? payload.movie.title),
    title: payload.movie.title,
    year: payload.movie.year,
    date: new Date()
  };

  await announcer.announceMovie(release);
}

async function handleSonarrWebhook(
  payload: SonarrWebhookPayload,
  announcer: ReleaseAnnouncer
): Promise<void> {
  if (payload.eventType !== "Download" || payload.isUpgrade) return;
  if (!payload.series?.title) {
    throw new Error("Sonarr webhook payload did not include a series title.");
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
