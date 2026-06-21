export type MovieRequest = {
  kind: "movie";
  title: string;
  year?: number;
  qualityToken?: string;
};

export type ShowRequest = {
  kind: "show";
  title: string;
  year?: number;
  qualityToken?: string;
  scope: "full" | "season";
  seasonNumber?: number;
  monitorWholeShow: boolean;
};

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const YEAR_PATTERN = /^(19\d{2}|20\d{2})$/;
const QUALITY_PATTERN = /^(720p|1080p|2160p|4k|uhd|animation)$/i;
const EPISODE_PATTERN = /\bS\d{1,2}E\d{1,2}\b/i;

function trimWords(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function parseRequestParts(content: string): ParseResult<{
  title: string;
  year?: number;
  rest: string[];
}> {
  const normalized = trimWords(content);
  const parts = normalized ? normalized.split(" ") : [];
  const yearIndex = parts.findIndex((part) => YEAR_PATTERN.test(part));

  if (parts.length === 0) {
    return {
      ok: false,
      error:
        "Please include a title and optional year/quality. Example: `Superbad 2011 1080p`",
    };
  }

  if (yearIndex === -1) {
    return { ok: true, value: { title: trimWords(parts.join(" ")), rest: [] } };
  }

  const title = trimWords(parts.slice(0, yearIndex).join(" "));
  const year = Number(parts[yearIndex]);
  const rest = parts.slice(yearIndex + 1);

  if (!title) {
    return {
      ok: false,
      error:
        "Please put the title before the year. Example: `Superbad 2011 1080p`",
    };
  }

  return { ok: true, value: { title, year, rest } };
}

function popQualityToken(parts: string[]): string | undefined {
  const last = parts.at(-1);
  if (last && QUALITY_PATTERN.test(last)) {
    parts.pop();
    return last;
  }

  return undefined;
}

export function parseMovieRequest(content: string): ParseResult<MovieRequest> {
  const parts = trimWords(content).split(" ").filter(Boolean);
  const qualityToken = popQualityToken(parts);
  const split = parseRequestParts(parts.join(" "));
  if (!split.ok) return split;

  if (split.value.rest.length > 0) {
    return {
      ok: false,
      error:
        "Movie format is `Title Year Quality`. Example: `Superbad 2011 1080p`",
    };
  }

  return {
    ok: true,
    value: {
      kind: "movie",
      title: split.value.title,
      year: split.value.year,
      qualityToken,
    },
  };
}

export function parseShowRequest(content: string): ParseResult<ShowRequest> {
  if (EPISODE_PATTERN.test(content)) {
    return {
      ok: false,
      error:
        "Episode requests are not supported yet. Use `Title Year Full Quality` or `Title Year Season 1 Quality`.",
    };
  }

  const parts = trimWords(content).split(" ").filter(Boolean);
  const qualityToken = popQualityToken(parts);
  const scope = popShowScope(parts);
  const split = parseRequestParts(parts.join(" "));
  if (!split.ok) {
    return {
      ok: false,
      error:
        "Please include a show title and optional year/scope. Example: `Severance 2022 Full 1080p`",
    };
  }

  if (split.value.rest.length === 0 && !scope) {
    return {
      ok: true,
      value: {
        kind: "show",
        title: split.value.title,
        year: split.value.year,
        qualityToken,
        scope: "season",
        seasonNumber: 1,
        monitorWholeShow: false,
      },
    };
  }

  if (split.value.rest.length === 0 && scope?.scope === "full") {
    return {
      ok: true,
      value: {
        kind: "show",
        title: split.value.title,
        year: split.value.year,
        qualityToken,
        scope: "full",
        monitorWholeShow: true,
      },
    };
  }

  if (split.value.rest.length === 0 && scope?.scope === "season") {
    return {
      ok: true,
      value: {
        kind: "show",
        title: split.value.title,
        year: split.value.year,
        qualityToken,
        scope: "season",
        seasonNumber: scope.seasonNumber,
        monitorWholeShow: true,
      },
    };
  }

  return {
    ok: false,
    error:
      "Show format is `Title Year Full Quality` or `Title Year Season 1 Quality`.",
  };
}

function popShowScope(parts: string[]):
  | { scope: "full" }
  | { scope: "season"; seasonNumber: number }
  | undefined {
  const last = parts.at(-1);
  if (!last) return undefined;

  if (/^full$/i.test(last)) {
    parts.pop();
    return { scope: "full" };
  }

  const compactSeason = last.match(/^s(\d{1,2})$/i);
  if (compactSeason) {
    parts.pop();
    return { scope: "season", seasonNumber: Number(compactSeason[1]) };
  }

  const maybeNumber = Number(last);
  const maybeSeason = parts.at(-2);
  if (Number.isInteger(maybeNumber) && maybeNumber > 0 && maybeSeason && /^season$/i.test(maybeSeason)) {
    parts.pop();
    parts.pop();
    return { scope: "season", seasonNumber: maybeNumber };
  }

  return undefined;
}
