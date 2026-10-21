import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

export const BANNED_ARTISTS_FILE = "./data/banned.list.txt";
export const BANNED_ALBUMS_FILE = "./data/banned.album.list.txt";
export const ALLOWED_ARTISTS_FILE = "./data/allow.list.txt";

const readList = async (file: string) =>
  (await readFile(file, "utf-8")).split(/\r?\n/).filter((line) => line.trim() !== "");

export const loadBanned = async () => {
  const bannedArtistLookup = new Set();

  for (const artist of await readList(BANNED_ARTISTS_FILE)) {
    bannedArtistLookup.add(artist);
  }
  console.log(`Banned artists loaded: ${bannedArtistLookup.size}`);

  const bannedAlbumsLookup = new Set();

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
