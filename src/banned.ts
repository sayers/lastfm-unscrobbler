import * as fs from "fs";

export const loadBanned = async () => {
    const bannedArtists = await fs.promises.readFile("./banned.list.txt", "utf-8");
    const bannedArtistLookup = new Set();
  
    for (let artist of bannedArtists.split("\r\n")) {
      bannedArtistLookup.add(artist);
    }
    console.log(`Banned artists loaded: ${bannedArtistLookup.size}`);
    
    const bannedAlbums = await fs.promises.readFile("./banned.album.list.txt", "utf-8");
    const bannedAlbumsLookup = new Set();
  
    for (let album of bannedAlbums.split("\r\n")) {
      bannedAlbumsLookup.add(`https://www.last.fm/${album}`);
    }
    console.log(`Banned albums loaded: ${bannedAlbumsLookup.size}`);
  
    return {
      artists: bannedArtistLookup,
      albums: bannedAlbumsLookup
    }
  }
  