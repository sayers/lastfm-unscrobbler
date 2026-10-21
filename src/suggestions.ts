import { writeFile } from "node:fs/promises";

import type { Scrobble } from "./library.ts";

export const SUGGESTIONS_FILE = "./data/suggestions.txt";

// An album needs at least this many plays in the scanned pages before it is worth suggesting.
// Artists have no minimum: every unknown artist is suggested somewhere, so none can be missed.
const MIN_ALBUM_PLAYS = 3;

const LASTFM_URL = "https://www.last.fm/";
// Album paths look like music/Artist/Album; a track path has an extra /_/ part.
const ALBUM_PATH = /^music\/[^/]+\/[^/]+$/;
const COMPILATION_PREFIX = "music/Various+Artists/";

// How many known scrobbles on each side of a play it is judged by.
const NEIGHBOURS = 3;

export type Judgement = "near banned" | "near own" | "unclear";

export type JudgedPlay = { scrobble: Scrobble; judgement: Judgement };

export type Suggestion = { name: string; reason: string };

export type SuggestionSection = { title: string; suggestions: Suggestion[] };

// Split scrobbles, oldest first, into listening sessions wherever there is a gap longer than gapMinutes.
export const toSessions = (scrobbles: Scrobble[], gapMinutes: number): Scrobble[][] => {
  const sessions: Scrobble[][] = [];
  let previous: Scrobble | undefined;
  for (const scrobble of scrobbles.toSorted((a, b) => a.timestamp.getTime() - b.timestamp.getTime())) {
    if (!previous || scrobble.timestamp.getTime() - previous.timestamp.getTime() > gapMinutes * 60_000) {
      sessions.push([]);
    }
    sessions[sessions.length - 1].push(scrobble);
    previous = scrobble;
  }
  return sessions;
};

// Judge every play by up to NEIGHBOURS known scrobbles on each side of it in its session:
// banned ones (that would be deleted) against your own (allow-listed artists).
// Unknown neighbours are skipped, so unknown artists played together can't vouch for each other,
// and a session boundary stops the search, so a long break keeps one listener's music from judging another's.
export const judgePlays = (
  sessions: Scrobble[][],
  isUnwanted: (scrobble: Scrobble) => boolean,
  isAllowed: (artist: string) => boolean,
): JudgedPlay[] =>
  sessions.flatMap((session) => {
    const kinds = session.map((scrobble) =>
      isUnwanted(scrobble) ? "banned" : isAllowed(scrobble.artist) ? "own" : undefined,
    );
    return session.map((scrobble, i): JudgedPlay => {
      let banned = 0;
      let own = 0;
      for (const step of [-1, 1]) {
        let found = 0;
        for (let j = i + step; j >= 0 && j < session.length && found < NEIGHBOURS; j += step) {
          if (kinds[j] === undefined) {
            continue;
          }
          found++;
          if (kinds[j] === "banned") {
            banned++;
          } else {
            own++;
          }
        }
      }
      return { scrobble, judgement: banned > own ? "near banned" : own > banned ? "near own" : "unclear" };
    });
  });

// Each artist's plays, and how many of them were judged next to banned scrobbles or to your own.
const countArtistPlays = (plays: JudgedPlay[]) => {
  const counts = new Map<string, { total: number; nearBanned: number; nearOwn: number }>();
  for (const { scrobble, judgement } of plays) {
    const artistCounts = counts.get(scrobble.artist) ?? { total: 0, nearBanned: 0, nearOwn: 0 };
    artistCounts.total++;
    if (judgement === "near banned") {
      artistCounts.nearBanned++;
    } else if (judgement === "near own") {
      artistCounts.nearOwn++;
    }
    counts.set(scrobble.artist, artistCounts);
  }
  return [...counts];
};

type ArtistCounts = ReturnType<typeof countArtistPlays>[number][1];

const isBanSuggestion = ({ total, nearBanned }: ArtistCounts) => nearBanned * 2 > total;
const isAllowSuggestion = ({ nearBanned, nearOwn }: ArtistCounts) => nearBanned === 0 && nearOwn > 0;

const playCount = (count: number) => `${count} ${count === 1 ? "play" : "plays"}`;

// Artists on neither list that would still have scrobbles left after the deletions.
// An artist whose every scrobble is deleted, e.g. through a banned album, needs no decision.
export const findUnknownArtists = (
  scrobbles: Scrobble[],
  isListed: (artist: string) => boolean,
  isUnwanted: (scrobble: Scrobble) => boolean,
) =>
  new Set(
    scrobbles.filter((scrobble) => !isUnwanted(scrobble) && !isListed(scrobble.artist)).map(({ artist }) => artist),
  );

// Every unknown artist lands in exactly one of the next three: to ban, to allow, or to decide.

// Unknown artists with more than half their plays next to banned scrobbles.
export const suggestArtistsToBan = (plays: JudgedPlay[], isUnknown: (artist: string) => boolean): Suggestion[] =>
  countArtistPlays(plays)
    .filter(([artist, counts]) => isUnknown(artist) && isBanSuggestion(counts))
    .sort(([, a], [, b]) => b.nearBanned - a.nearBanned || a.total - b.total)
    .map(([artist, { total, nearBanned }]) => ({
      name: artist,
      reason: `${nearBanned} of ${playCount(total)} next to banned scrobbles`,
    }));

// Unknown artists played next to your own music and never next to banned scrobbles, so most likely yours.
export const suggestArtistsToAllow = (plays: JudgedPlay[], isUnknown: (artist: string) => boolean): Suggestion[] =>
  countArtistPlays(plays)
    .filter(([artist, counts]) => isUnknown(artist) && isAllowSuggestion(counts))
    .sort(([artistA, a], [artistB, b]) => b.nearOwn - a.nearOwn || artistA.localeCompare(artistB))
    .map(([artist, { total, nearOwn }]) => ({
      name: artist,
      reason: `${nearOwn} of ${playCount(total)} next to your own, none next to banned`,
    }));

// Every other unknown artist: mixed neighbours, or none clear enough to guess from.
export const suggestArtistsToDecide = (plays: JudgedPlay[], isUnknown: (artist: string) => boolean): Suggestion[] =>
  countArtistPlays(plays)
    .filter(([artist, counts]) => isUnknown(artist) && !isBanSuggestion(counts) && !isAllowSuggestion(counts))
    .sort(
      ([artistA, a], [artistB, b]) =>
        b.nearBanned - a.nearBanned || b.total - a.total || artistA.localeCompare(artistB),
    )
    .map(([artist, { total, nearBanned, nearOwn }]) => ({
      name: artist,
      reason: `${nearBanned} of ${playCount(total)} next to banned, ${nearOwn} next to your own`,
    }));

// Albums whose every play is next to banned scrobbles but which can't be banned by artist:
// compilations, whose tracks are by many artists, and albums by allow-listed artists.
// Suggested as paths, e.g. music/Various+Artists/Shrek, ready for the banned album list.
export const suggestAlbumsToBan = (
  plays: JudgedPlay[],
  isAllowed: (artist: string) => boolean,
  isBannedAlbum: (album: string) => boolean,
): Suggestion[] => {
  const counts = new Map<string, { total: number; nearBanned: number; by: string }>();
  for (const { scrobble, judgement } of plays) {
    const { artist, album } = scrobble;
    const path = album.startsWith(LASTFM_URL) ? album.slice(LASTFM_URL.length) : "";
    const compilation = path.startsWith(COMPILATION_PREFIX);
    if (!ALBUM_PATH.test(path) || isBannedAlbum(album) || !(compilation || isAllowed(artist))) {
      continue;
    }
    const albumCounts = counts.get(path) ?? {
      total: 0,
      nearBanned: 0,
      by: compilation ? "compilation" : `by ${artist}`,
    };
    albumCounts.total++;
    if (judgement === "near banned") {
      albumCounts.nearBanned++;
    }
    counts.set(path, albumCounts);
  }
  return [...counts]
    .filter(([, { total, nearBanned }]) => total >= MIN_ALBUM_PLAYS && nearBanned === total)
    .sort(([pathA, a], [pathB, b]) => b.total - a.total || pathA.localeCompare(pathB))
    .map(([path, { total, by }]) => ({ name: path, reason: `${by}, all ${total} plays next to banned scrobbles` }));
};

const formatSuggestion = ({ name, reason }: Suggestion) => `${name}  # ${reason}`;

export const formatSuggestions = (sections: SuggestionSection[], generatedAt: Date) =>
  `${[
    `# Suggestions from the dry run at ${generatedAt.toLocaleString()}`,
    ...sections.map(({ title, suggestions }) =>
      [`# ${title}`, ...(suggestions.length > 0 ? suggestions.map(formatSuggestion) : ["# (none)"])].join("\n"),
    ),
  ].join("\n\n")}\n`;

export const writeSuggestions = async (sections: SuggestionSection[]) => {
  await writeFile(SUGGESTIONS_FILE, formatSuggestions(sections, new Date()));
};

// Show the strongest few of each section; the file has the rest.
export const printSuggestions = (sections: SuggestionSection[], shown = 10) => {
  for (const { title, suggestions } of sections) {
    console.log(`${title}: ${suggestions.length}`);
    for (const suggestion of suggestions.slice(0, shown)) {
      console.log(`  ${formatSuggestion(suggestion)}`);
    }
    if (suggestions.length > shown) {
      console.log(`  ...and ${suggestions.length - shown} more in ${SUGGESTIONS_FILE}`);
    }
  }
};
