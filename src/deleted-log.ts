import { appendFile } from "node:fs/promises";

import type { DeleteOutcome, Scrobble } from "./library.ts";

// Last.fm has no undo, so this is the only record of what a real run removed or tried to.
export const DELETED_LOG_FILE = "./data/deleted.log";

const LASTFM_URL = "https://www.last.fm/";

export type DeletedLogEntry = {
  scrobble: Pick<Scrobble, "artist" | "track" | "album" | "timestamp">;
  outcome: DeleteOutcome;
  // What put the scrobble up for deletion, e.g. "artist", "album" or "artist and album".
  matched: string;
};

// One line per attempt, fields split by two spaces, e.g.
// 2026-10-21T04:30:12.000Z  deleted  Peppa Pig - Theme  scrobbled 2026-10-21T03:20:00.000Z  music/Peppa+Pig/Album  matched artist
export const formatLogLine = ({ scrobble, outcome, matched }: DeletedLogEntry, loggedAt: Date) =>
  [
    loggedAt.toISOString(),
    outcome.result,
    `${scrobble.artist} - ${scrobble.track}`,
    `scrobbled ${scrobble.timestamp.toISOString()}`,
    scrobble.album.startsWith(LASTFM_URL) ? scrobble.album.slice(LASTFM_URL.length) : scrobble.album,
    `matched ${matched}`,
    ...(outcome.result === "failed" ? [`reason: ${outcome.reason}`] : []),
  ].join("  ");

// Appended straight away, so the record survives a run that stops part way through.
export const appendToDeletedLog = async (entry: DeletedLogEntry) => {
  await appendFile(DELETED_LOG_FILE, `${formatLogLine(entry, new Date())}\n`);
};
