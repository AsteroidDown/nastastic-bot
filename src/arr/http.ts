import { sleep } from "../util/sleep.js";

export class ArrApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseBody?: string
  ) {
    super(message);
  }
}

export class ArrRequestError extends Error {
  constructor(
    public readonly method: string,
    public readonly path: string,
    public readonly kind: "timeout" | "connection",
    cause: unknown
  ) {
    super(`ARR ${method} ${path}: ${kind === "timeout" ? "request timed out" : "connection failed"}`, { cause });
  }
}

function isRetryableConnectionError(error: unknown): boolean {
  const failure = error as { code?: string; cause?: { code?: string } } | undefined;
  const code = failure?.cause?.code ?? failure?.code;
  return code === "UND_ERR_SOCKET" || code === "ECONNRESET" || code === "EPIPE";
}

export class ArrHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly requestTimeoutMs = 30_000
  ) {}

  async get<T>(path: string, params?: Record<string, string | number | undefined>, timeoutMs = this.requestTimeoutMs): Promise<T> {
    const url = this.url(path, params);
    return this.request<T>(url, { method: "GET" }, timeoutMs);
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.url(path);
    return this.request<T>(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  async put<T>(path: string, body: unknown): Promise<T> {
    const url = this.url(path);
    return this.request<T>(url, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
  }

  private url(path: string, params?: Record<string, string | number | undefined>): URL {
    const normalizedPath = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(`${this.baseUrl}${normalizedPath}`);

    for (const [key, value] of Object.entries(params || {})) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }

    return url;
  }

  private async request<T>(url: URL, init: RequestInit, timeoutMs = this.requestTimeoutMs): Promise<T> {
    const method = init.method || "GET";
    // Retrying a grab could queue it twice. Only read requests may be retried.
    for (let attempt = 0; ; attempt++) {
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const response = await fetch(url, {
          ...init,
          signal,
          headers: {
            "x-api-key": this.apiKey,
            ...(init.headers || {})
          }
        });

        if (!response.ok) {
          const body = await response.text();
          throw new ArrApiError(`ARR ${method} ${url.pathname} failed: HTTP ${response.status}`, response.status, body);
        }
        if (response.status === 204) return undefined as T;
        return await response.json() as T;
      } catch (error) {
        if (error instanceof ArrApiError || error instanceof SyntaxError) throw error;
        if (method === "GET" && attempt === 0 && !signal.aborted && isRetryableConnectionError(error)) {
          console.warn(`ARR GET ${url.pathname}: connection interrupted; retrying once.`);
          await sleep(250);
          continue;
        }
        throw new ArrRequestError(method, url.pathname, signal.aborted ? "timeout" : "connection", error);
      }
    }
  }
}

export type QualityProfile = {
  id: number;
  name: string;
};

export function findQualityProfile(profiles: QualityProfile[], name: string): QualityProfile {
  const profile = profiles.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!profile) {
    const available = profiles.map((item) => item.name).join(", ");
    throw new Error(`Quality profile "${name}" was not found. Available profiles: ${available}`);
  }

  return profile;
}
