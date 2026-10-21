import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

import type { Scrobble } from "./library.ts";

export const LAST_SEEN_FILE = "./data/last-seen.json";

export type LastSeen = Pick<Scrobble, "artist" | "track" | "timestamp">;

export const readLastSeen = async (): Promise<LastSeen | undefined> => {
  if (!existsSync(LAST_SEEN_FILE)) {
    return undefined;
  }
  const { artist, track, timestamp } = JSON.parse(await readFile(LAST_SEEN_FILE, "utf-8"));
  const lastSeen = { artist, track, timestamp: new Date(timestamp) };
  if (typeof artist !== "string" || typeof track !== "string" || Number.isNaN(lastSeen.timestamp.getTime())) {
    throw new Error("it needs an artist, a track and a timestamp");
  }
  return lastSeen;
};

export const writeLastSeen = async ({ artist, track, timestamp }: LastSeen) => {
  await writeFile(
    LAST_SEEN_FILE,
    `${JSON.stringify({ artist, track, timestamp: timestamp.toISOString() }, null, 2)}\n`,
  );
};
