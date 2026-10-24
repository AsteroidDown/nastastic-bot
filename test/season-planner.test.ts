import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { SonarrClient, type SonarrReleaseOption } from "../src/arr/sonarr.js";
import { isSeasonPack } from "../src/arr/season-planner.js";
import { formatSonarrReleaseChoice, formatSonarrReleaseOptions, formatSonarrResult } from "../src/discord/messages.js";

const GiB = 1024 ** 3;
function rawRelease(title: string, size: number, extra: Record<string, unknown> = {}) {
  return { title, size, guid: title, indexerId: 1, seasonNumber: 1, mappedSeriesId: 7,
    downloadAllowed: true, approved: true, rejections: [], fullSeason: true, episodeNumbers: [], ...extra };
}
function option(title: string): SonarrReleaseOption {
  return { title, guid: title, indexerId: 1, rejections: [], downloadAllowed: true, raw: {} };
}

test("season packs require an exact padded season token followed by a literal space or period", () => {
  for (const title of ["The Ark S01 1080p", "The Ark (2023) s01 (1080p)", "The.Ark.S01.1080p", "The.Ark.S01."]) {
    assert.equal(isSeasonPack(option(title), 7, 1), true, title);
  }
  for (const title of ["The Ark S03E11 1080p", "The Ark S02 1080p", "The Ark S010 1080p",
    "The Ark S1 1080p", "The Ark S01E01.1080p", "The.Ark.S01.E01.1080p", "The Ark S01\t1080p", "The Ark S01",
    "The Ark S01-S03 1080p", "The Ark S01 S02 1080p", "The Ark S01 E01 1080p"]) {
    assert.equal(isSeasonPack(option(title), 7, 1), false, title);
  }
  assert.equal(isSeasonPack(option("Show S12 1080p"), 7, 12), true);
});

test("matching title cannot override conflicting Sonarr episode/season/series metadata", () => {
  for (const raw of [{ seasonNumber: 2 }, { mappedSeasonNumber: 2 }, { mappedSeriesId: 8 },
    { fullSeason: false }, { episodeNumbers: [1] }, { seasonNumbers: [1, 2] }, { episodeRequested: false }]) {
    assert.equal(isSeasonPack({ ...option("The Ark S01 1080p"), raw }, 7, 1), false);
  }
  assert.equal(isSeasonPack({ ...option("The Ark S01 1080p"),
    rejections: ["Episode wasn't requested: 3x11"] }, 7, 1), false);
});

test("Discord pack choices show only title, season, resolution and sizes", () => {
  const text = formatSonarrReleaseChoice({
    ...option("The Ark (2023) S01 (1080p AMZN WEB DL x265 10bit EAC3 5 1 Celdra) [QxR]"),
    sizeBytes: 17.1 * GiB, episodeCount: 12, indexer: "LimeTorrents (Prowlarr)",
    seeders: 63, quality: "WEBDL-1080p",
    rejections: ["Custom Formats have score 0 below Series profile minimum 1"]
  });
  assert.equal(text, "The Ark (2023) S01 | 1080p | 17.1 GiB | ~1.4 GiB/episode");
});

test("Discord pack choices handle period-delimited releases and missing size metadata", () => {
  assert.equal(formatSonarrReleaseChoice(option("The.Ark.(2023).S01.1080p.WEB.x265")),
    "The Ark (2023) S01 | 1080p");
});

type Scenario = {
  packSize?: number;
  rejectedPack?: boolean;
  episodeSizes?: Array<number | undefined>;
  existingFirst?: boolean;
  queuedFirst?: boolean;
  noPacks?: boolean;
  failEpisode?: number;
  transientFailure?: boolean;
};
async function runScenario(t: TestContext, scenario: Scenario = {}) {
  const posts: Array<{ path: string; body: Record<string, unknown> }> = [];
  const searches: string[] = [];
  const episodeAttempts = new Map<number, number>();
  const episodes = [1, 2, 3].map((n) => ({ id: n, seasonNumber: 1, episodeNumber: n,
    hasFile: scenario.existingFirst && n === 1, airDateUtc: "2023-01-01T00:00:00Z" }));
  const pack = rawRelease("The Ark S01 1080p", scenario.packSize ?? 17.1 * GiB,
    scenario.rejectedPack ? { approved: false, rejections: ["Custom Formats have score 0 below Series profile minimum 1"] } : {});
  t.mock.method(globalThis, "fetch", async (input: URL | RequestInfo, init?: RequestInit) => {
    const url = new URL(String(input));
    if (init?.method === "POST") {
      posts.push({ path: url.pathname, body: JSON.parse(String(init.body)) });
      return Response.json({});
    }
    if (url.pathname.endsWith("/series/7")) return Response.json({ id: 7, title: "The Ark", tvdbId: 42, seasons: [] });
    if (url.pathname.endsWith("/series")) return Response.json([{ id: 7, title: "The Ark", tvdbId: 42, seasons: [] }]);
    if (url.pathname.endsWith("/episode")) return Response.json(episodes);
    if (url.pathname.endsWith("/queue")) return Response.json({ totalRecords: scenario.queuedFirst ? 1 : 0,
      records: scenario.queuedFirst ? [{ seriesId: 7, episodeId: 1 }] : [] });
    if (url.pathname.endsWith("/release")) {
      searches.push(url.search);
      const episodeId = Number(url.searchParams.get("episodeId"));
      if (episodeId) {
        const attempt = (episodeAttempts.get(episodeId) || 0) + 1;
        episodeAttempts.set(episodeId, attempt);
        if (episodeId === scenario.failEpisode && (!scenario.transientFailure || attempt === 1)) {
          throw new TypeError("fetch failed", { cause: Object.assign(new Error("other side closed"), { code: "UND_ERR_SOCKET" }) });
        }
        const size = scenario.episodeSizes ? scenario.episodeSizes[episodeId - 1] : 350 * 1024 ** 2;
        return Response.json(size === undefined ? [] : [
          rawRelease(`The Ark S01E0${episodeId} 1080p`, size,
            { fullSeason: false, episodeNumbers: [episodeId] }),
          rawRelease("Wrong season S03E11 1080p", 1, { seasonNumber: 3, fullSeason: false, episodeNumbers: [11] })
        ]);
      }
      return Response.json(scenario.noPacks ? [] : [
        rawRelease("The Ark S03E11 1080p", 1, { seasonNumber: 3, fullSeason: false, episodeNumbers: [11] }),
        rawRelease("The Ark S02 1080p", 1, { seasonNumber: 2 }), pack
      ]);
    }
    throw new Error(`Unexpected API call: ${url}`);
  });
  const client = new SonarrClient("http://sonarr.test", "test", "/shows", "standard", 1, 1);
  const result = await client.addLookupAndSearch({ title: "The Ark", tvdbId: 42, year: 2023, titleSlug: "the-ark" },
    "HD 1080p", { scope: "season", seasonNumber: 1, monitorWholeShow: false });
  return { result, posts, searches, episodeAttempts };
}

test("chooses the smaller complete approved episode set before Sonarr can auto-grab a large pack", async (t) => {
  const { result, posts } = await runScenario(t);
  assert.equal(result.status, "found");
  if (result.status !== "found") return;
  assert.equal(result.strategy, "episodes");
  assert.equal(result.sizeBytes, 3 * 350 * 1024 ** 2);
  assert.equal(posts.length, 3);
  assert.ok(posts.every((post) => post.path === "/api/v3/release" && post.body.shouldOverride === false));
});

test("chooses a smaller approved pack instead of episodes", async (t) => {
  const { result, posts } = await runScenario(t, { packSize: 500 * 1024 ** 2 });
  assert.equal(result.status === "found" && result.strategy, "pack");
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body.title, "The Ark S01 1080p");
});

test("CF rejection on a pack does not prevent downloading approved individual episodes", async (t) => {
  const { result, posts } = await runScenario(t, { rejectedPack: true });
  assert.equal(result.status === "found" && result.strategy, "episodes");
  assert.equal(posts.length, 3);
});

test("incomplete episode results cannot auto-override a rejected pack or leak wrong-season options", async (t) => {
  const { result, posts } = await runScenario(t, { rejectedPack: true, episodeSizes: [100, undefined, 100] });
  assert.equal(posts.length, 0);
  assert.equal(result.status, "manual_options");
  if (result.status !== "manual_options") return;
  assert.equal(result.releases.length, 1);
  assert.equal(result.releases[0].episodeCount, 3);
  assert.equal(result.releases[0].raw.seriesId, 7);
  assert.deepEqual(result.releases[0].raw.episodeIds, [1, 2, 3]);
});

for (const state of ["existingFirst", "queuedFirst"] as const) {
  test(`does not redownload ${state} episodes to get a cheap pack`, async (t) => {
    const { result, posts, searches } = await runScenario(t, { [state]: true, packSize: 1 });
    assert.equal(result.status === "found" && result.strategy, "episodes");
    assert.equal(posts.length, 2);
    assert.ok(!searches.includes("?episodeId=1"));
  });
}

test("does not queue an incomplete collection if no valid pack is available", async (t) => {
  const { result, posts } = await runScenario(t, { noPacks: true, episodeSizes: [100, undefined, 100] });
  assert.equal(result.status, "not_found");
  assert.equal(posts.length, 0);
});


test("a closed episode-search socket is retried once and a successful retry completes the comparison", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { result, posts, episodeAttempts } = await runScenario(t, { failEpisode: 1, transientFailure: true });
  assert.equal(episodeAttempts.get(1), 2);
  assert.equal(result.status === "found" && result.strategy, "episodes");
  assert.equal(posts.length, 3);
});

test("repeated socket failure preserves compact pack choices without auto-downloading an un-compared pack", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { result, posts, episodeAttempts } = await runScenario(t, { failEpisode: 2 });
  assert.equal(episodeAttempts.get(2), 2);
  assert.equal(posts.length, 0);
  assert.equal(result.status, "manual_options");
  if (result.status !== "manual_options") return;
  assert.equal(result.comparisonUnavailable, true);
  assert.equal(result.releases.length, 1);
  const message = formatSonarrReleaseOptions(result.title, result.seasonNumber, result.releases, result.comparisonUnavailable);
  assert.match(message, /couldn't compare download sizes/);
  assert.match(message, /1\. The Ark S01 \| 1080p \| 17.1 GiB \| ~5.7 GiB\/episode/);
});

test("connection failure without a valid pack is reported as an incomplete search, not no episode results", async (t) => {
  t.mock.method(console, "warn", () => {});
  const { result, posts } = await runScenario(t, { failEpisode: 1, noPacks: true });
  assert.equal(posts.length, 0);
  assert.equal(result.status, "search_failed");
  assert.match(formatSonarrResult(result), /couldn't finish the episode search/);
});
