export type MovieRequest = {
  kind: "movie";
  title: string;
  year: number;
  qualityToken?: string;
};

export type ShowRequest = {
  kind: "show";
  title: string;
  year: number;
  qualityToken?: string;
  scope: "full" | "season";
  seasonNumber?: number;
  monitorWholeShow: boolean;
};

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

const YEAR_PATTERN = /\b(19\d{2}|20\d{2})\b/;
const QUALITY_PATTERN = /^(720p|1080p|2160p|4k|uhd|animation)$/i;
const EPISODE_PATTERN = /\bS\d{1,2}E\d{1,2}\b/i;

function trimWords(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function splitAroundYear(content: string): ParseResult<{
  title: string;
  year: number;
  rest: string[];
}> {
  const normalized = trimWords(content);
  const match = YEAR_PATTERN.exec(normalized);

  if (!match?.index) {
    return {
      ok: false,
      error:
        "Please include a title, year, and optional quality. Example: `Superbad 2011 1080p`",
    };
  }

  const title = trimWords(normalized.slice(0, match.index));
  const year = Number(match[1]);
  const restText = trimWords(normalized.slice(match.index + match[1].length));
  const rest = restText ? restText.split(" ") : [];

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
  const split = splitAroundYear(content);
  if (!split.ok) return split;

  const rest = [...split.value.rest];
  const qualityToken = popQualityToken(rest);

  if (rest.length > 0) {
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

  const split = splitAroundYear(content);
  if (!split.ok) {
    return {
      ok: false,
      error:
        "Please include a show title, year, and optional scope. Example: `Severance 2022 Full 1080p`",
    };
  }

  const rest = [...split.value.rest];
  const qualityToken = popQualityToken(rest);

  if (rest.length === 0) {
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

  if (rest.length === 1 && /^full$/i.test(rest[0])) {
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

  const seasonMatch =
    rest.join(" ").match(/^season\s+(\d{1,2})$/i) ||
    rest.join(" ").match(/^s(\d{1,2})$/i);

  if (seasonMatch) {
    return {
      ok: true,
      value: {
        kind: "show",
        title: split.value.title,
        year: split.value.year,
        qualityToken,
        scope: "season",
        seasonNumber: Number(seasonMatch[1]),
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
