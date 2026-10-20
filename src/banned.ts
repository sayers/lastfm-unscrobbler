import { readFile } from "node:fs/promises";

export const BANNED_ARTISTS_FILE = "./banned.list.txt";
export const BANNED_ALBUMS_FILE = "./banned.album.list.txt";

export const loadBanned = async () => {
  const bannedArtists = await readFile(BANNED_ARTISTS_FILE, "utf-8");
  const bannedArtistLookup = new Set();

  for (const artist of bannedArtists.split("\r\n")) {
    bannedArtistLookup.add(artist);
  }
  console.log(`Banned artists loaded: ${bannedArtistLookup.size}`);

  const bannedAlbums = await readFile(BANNED_ALBUMS_FILE, "utf-8");
  const bannedAlbumsLookup = new Set();

  for (const album of bannedAlbums.split("\r\n")) {
    bannedAlbumsLookup.add(`https://www.last.fm/${album}`);
  }
  console.log(`Banned albums loaded: ${bannedAlbumsLookup.size}`);

  return {
    artists: bannedArtistLookup,
    albums: bannedAlbumsLookup,
  };
};
