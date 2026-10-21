import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export const BANNED_ARTISTS_FILE = "./data/banned.list.txt";
export const BANNED_ALBUMS_FILE = "./data/banned.album.list.txt";
export const ALLOWED_ARTISTS_FILE = "./data/allow.list.txt";

export const readList = async (file: string) =>
  (await readFile(file, "utf-8")).split(/\r?\n/).filter((line) => line.trim() !== "");

// Entries that appear more than once in a list, each named once.
export const findDuplicates = (entries: string[]) => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of entries) {
    if (seen.has(entry)) {
      duplicates.add(entry);
    }
    seen.add(entry);
  }
  return [...duplicates];
};

// Artists on both lists; banning would quietly win, so these need a decision.
export const findConflicts = (bannedArtists: Set<string>, allowedArtists: Set<string>) =>
  [...bannedArtists].filter((artist) => allowedArtists.has(artist));

export const loadBanned = async () => {
  const bannedArtistLookup = new Set<string>();

  for (const artist of await readList(BANNED_ARTISTS_FILE)) {
    bannedArtistLookup.add(artist);
  }
  console.log(`Banned artists loaded: ${bannedArtistLookup.size}`);

  const bannedAlbumsLookup = new Set<string>();

  for (const album of await readList(BANNED_ALBUMS_FILE)) {
    bannedAlbumsLookup.add(`https://www.last.fm/${album}`);
  }
  console.log(`Banned albums loaded: ${bannedAlbumsLookup.size}`);

  return {
    artists: bannedArtistLookup,
    albums: bannedAlbumsLookup,
  };
};

// The allow list is optional; without it every artist not yet banned is a candidate for suggestions.
export const loadAllowed = async () => {
  const allowedArtistLookup = new Set(existsSync(ALLOWED_ARTISTS_FILE) ? await readList(ALLOWED_ARTISTS_FILE) : []);
  console.log(`Allowed artists loaded: ${allowedArtistLookup.size}`);
  return allowedArtistLookup;
};
