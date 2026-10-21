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

export type Session = { scrobbles: Scrobble[]; banned: boolean };

export type Suggestion = { name: string; reason: string };

export type SuggestionSection = { title: string; suggestions: Suggestion[] };

// Split scrobbles into listening sessions wherever there is a gap longer than gapMinutes.
// A session counts as banned when at least half of its scrobbles would be deleted.
export const toSessions = (
  scrobbles: Scrobble[],
  gapMinutes: number,
  isUnwanted: (scrobble: Scrobble) => boolean,
): Session[] => {
  const groups: Scrobble[][] = [];
  let previous: Scrobble | undefined;
  for (const scrobble of scrobbles.toSorted((a, b) => a.timestamp.getTime() - b.timestamp.getTime())) {
    if (!previous || scrobble.timestamp.getTime() - previous.timestamp.getTime() > gapMinutes * 60_000) {
      groups.push([]);
    }
    groups[groups.length - 1].push(scrobble);
    previous = scrobble;
  }
  return groups.map((group) => ({ scrobbles: group, banned: group.filter(isUnwanted).length * 2 >= group.length }));
};

// Each artist's plays, and how many of them were in banned sessions.
const countArtistPlays = (sessions: Session[]) => {
  const plays = new Map<string, { total: number; inBanned: number }>();
  for (const { scrobbles, banned } of sessions) {
    for (const { artist } of scrobbles) {
      const counts = plays.get(artist) ?? { total: 0, inBanned: 0 };
      counts.total++;
      if (banned) {
        counts.inBanned++;
      }
      plays.set(artist, counts);
    }
  }
  return [...plays];
};

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

// Unknown artists who turn up mostly in banned sessions.
export const suggestArtistsToBan = (sessions: Session[], isUnknown: (artist: string) => boolean): Suggestion[] =>
  countArtistPlays(sessions)
    .filter(([artist, { total, inBanned }]) => isUnknown(artist) && inBanned * 2 > total)
    .sort(([, a], [, b]) => b.inBanned - a.inBanned || a.total - b.total)
    .map(([artist, { total, inBanned }]) => ({
      name: artist,
      reason: `${inBanned} of ${playCount(total)} in banned sessions`,
    }));

// Unknown artists who never turn up in a banned session, so are most likely yours.
export const suggestArtistsToAllow = (sessions: Session[], isUnknown: (artist: string) => boolean): Suggestion[] =>
  countArtistPlays(sessions)
    .filter(([artist, { inBanned }]) => isUnknown(artist) && inBanned === 0)
    .sort(([artistA, a], [artistB, b]) => b.total - a.total || artistA.localeCompare(artistB))
    .map(([artist, { total }]) => ({ name: artist, reason: `${playCount(total)}, none in banned sessions` }));

// Unknown artists split between banned sessions and yours, so there is no clear guess.
export const suggestArtistsToDecide = (sessions: Session[], isUnknown: (artist: string) => boolean): Suggestion[] =>
  countArtistPlays(sessions)
    .filter(([artist, { total, inBanned }]) => isUnknown(artist) && inBanned > 0 && inBanned * 2 <= total)
    .sort(
      ([artistA, a], [artistB, b]) => b.inBanned - a.inBanned || b.total - a.total || artistA.localeCompare(artistB),
    )
    .map(([artist, { total, inBanned }]) => ({
      name: artist,
      reason: `${inBanned} of ${playCount(total)} in banned sessions`,
    }));

// Albums that only turn up in banned sessions but can't be banned by artist:
// compilations, whose tracks are by many artists, and albums by allow-listed artists.
// Suggested as paths, e.g. music/Various+Artists/Shrek, ready for the banned album list.
export const suggestAlbumsToBan = (
  sessions: Session[],
  isAllowed: (artist: string) => boolean,
  isBannedAlbum: (album: string) => boolean,
): Suggestion[] => {
  const plays = new Map<string, { total: number; inBanned: number; by: string }>();
  for (const { scrobbles, banned } of sessions) {
    for (const { artist, album } of scrobbles) {
      const path = album.startsWith(LASTFM_URL) ? album.slice(LASTFM_URL.length) : "";
      const compilation = path.startsWith(COMPILATION_PREFIX);
      if (!ALBUM_PATH.test(path) || isBannedAlbum(album) || !(compilation || isAllowed(artist))) {
        continue;
      }
      const counts = plays.get(path) ?? { total: 0, inBanned: 0, by: compilation ? "compilation" : `by ${artist}` };
      counts.total++;
      if (banned) {
        counts.inBanned++;
      }
      plays.set(path, counts);
    }
  }
  return [...plays]
    .filter(([, { total, inBanned }]) => total >= MIN_ALBUM_PLAYS && inBanned === total)
    .sort(([pathA, a], [pathB, b]) => b.total - a.total || pathA.localeCompare(pathB))
    .map(([path, { total, by }]) => ({ name: path, reason: `${by}, all ${total} plays in banned sessions` }));
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
