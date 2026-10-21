import { writeFile } from "node:fs/promises";

import type { Scrobble } from "./library.ts";

export const SUGGESTIONS_FILE = "./data/suggestions.txt";

// An artist needs at least this many plays in the scanned pages before it is worth suggesting.
const MIN_PLAYS = 3;

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

// Artists on neither list who turn up mostly in banned sessions.
export const suggestArtistsToBan = (sessions: Session[], isListed: (artist: string) => boolean): Suggestion[] => {
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
  return [...plays]
    .filter(([artist, { total, inBanned }]) => !isListed(artist) && total >= MIN_PLAYS && inBanned * 2 > total)
    .sort(([, a], [, b]) => b.inBanned - a.inBanned || a.total - b.total)
    .map(([artist, { total, inBanned }]) => ({
      name: artist,
      reason: `${inBanned} of ${total} plays in banned sessions`,
    }));
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
