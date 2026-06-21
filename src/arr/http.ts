export class ArrApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseBody?: string
  ) {
    super(message);
  }
}

export class ArrHttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string
  ) {}

  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = this.url(path, params);
    return this.request<T>(url, { method: "GET" });
  }

  async post<T>(path: string, body: unknown): Promise<T> {
    const url = this.url(path);
    return this.request<T>(url, {
      method: "POST",
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

  private async request<T>(url: URL, init: RequestInit): Promise<T> {
    const response = await fetch(url, {
      ...init,
      headers: {
        "x-api-key": this.apiKey,
        ...(init.headers || {})
      }
    });

    if (!response.ok) {
      const body = await response.text();
      throw new ArrApiError(`ARR API request failed: ${response.status}`, response.status, body);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
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
