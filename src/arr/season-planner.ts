import type { SonarrReleaseOption } from "./sonarr.js";

export type SeasonEpisode = {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  hasFile: boolean;
  airDateUtc?: string;
};

function info(release: SonarrReleaseOption): Record<string, unknown> {
  return { ...(release.raw.parsedInfo as object | undefined), ...release.raw };
}

export function matchesSeason(release: SonarrReleaseOption, seriesId: number, seasonNumber: number): boolean {
  const raw = info(release);
  return (raw.mappedSeriesId === undefined || raw.mappedSeriesId === seriesId)
    && (raw.seriesId === undefined || raw.seriesId === seriesId)
    && (raw.seasonNumber === undefined || raw.seasonNumber === seasonNumber)
    && (raw.mappedSeasonNumber === undefined || raw.mappedSeasonNumber === seasonNumber)
    && (raw.episodeRequested !== false)
    && !release.rejections.some((reason) => /episode.*(?:wasn't|not) requested/i.test(reason));
}

export function isSeasonPack(release: SonarrReleaseOption, seriesId: number, seasonNumber: number): boolean {
  const raw = info(release);
  const marker = new RegExp(`\\bS${String(seasonNumber).padStart(2, "0")}[ .]`, "i");
  const seasons = release.title.match(/\bS\d+/gi) || [];
  return matchesSeason(release, seriesId, seasonNumber)
    && marker.test(release.title)
    && seasons.every((season) => season.toUpperCase() === `S${String(seasonNumber).padStart(2, "0")}`)
    && !/\bS\d+E\d+|\bE\d+\b/i.test(release.title)
    && raw.fullSeason !== false
    && (!Array.isArray(raw.seasonNumbers) || raw.seasonNumbers.every((number) => number === seasonNumber))
    && (!Array.isArray(raw.episodeNumbers) || raw.episodeNumbers.length === 0);
}

export function isSingleEpisode(release: SonarrReleaseOption, seriesId: number, episode: SeasonEpisode): boolean {
  const raw = info(release);
  const numbers = raw.mappedEpisodeNumbers ?? raw.episodeNumbers;
  return matchesSeason(release, seriesId, episode.seasonNumber)
    && raw.fullSeason !== true
    && Array.isArray(numbers) && numbers.length === 1 && numbers[0] === episode.episodeNumber
    && (raw.mappedSeasonNumber ?? raw.seasonNumber) === episode.seasonNumber;
}

export function isApproved(release: SonarrReleaseOption): boolean {
  return release.downloadAllowed && release.rejections.length === 0
    && release.raw.approved !== false && release.raw.rejected !== true;
}

export function releaseSize(release: SonarrReleaseOption): number {
  return release.sizeBytes !== undefined && release.sizeBytes > 0 ? release.sizeBytes : Infinity;
}
