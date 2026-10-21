import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Locator } from "playwright";

import type { Scrobble } from "./library.ts";
import {
  formatSuggestions,
  type Session,
  suggestAlbumsToBan,
  suggestArtistsToAllow,
  suggestArtistsToBan,
  toSessions,
} from "./suggestions.ts";

const bannedArtists = new Set(["Peppa Pig", "Bluey"]);
const isUnwanted = (scrobble: Scrobble) => bannedArtists.has(scrobble.artist);

// A scrobble the given number of minutes after 9am; the row is never touched by the suggestion logic.
const scrobble = (artist: string, minute: number): Scrobble => ({
  artist,
  track: "Track",
  album: `https://www.last.fm/music/${artist}/Album`,
  timestamp: new Date(2026, 9, 20, 9, minute),
  row: {} as Locator,
});

const session = (banned: boolean, ...artists: string[]): Session => ({
  scrobbles: artists.map((artist, i) => scrobble(artist, i)),
  banned,
});

// A session of plays given as [artist, album path] pairs.
const albumSession = (banned: boolean, ...plays: [artist: string, albumPath: string][]): Session => ({
  scrobbles: plays.map(([artist, albumPath], i) => ({
    ...scrobble(artist, i),
    album: `https://www.last.fm/${albumPath}`,
  })),
  banned,
});

const artistsIn = (sessions: Session[]) => sessions.map(({ scrobbles }) => scrobbles.map(({ artist }) => artist));

describe("toSessions", () => {
  it("starts a new session after a gap longer than the setting", () => {
    const sessions = toSessions([scrobble("A", 0), scrobble("B", 10), scrobble("C", 41)], 30, isUnwanted);
    assert.deepEqual(artistsIn(sessions), [["A", "B"], ["C"]]);
  });

  it("keeps a gap of exactly the setting in the same session", () => {
    const sessions = toSessions([scrobble("A", 0), scrobble("B", 30)], 30, isUnwanted);
    assert.deepEqual(artistsIn(sessions), [["A", "B"]]);
  });

  it("sorts scrobbles by time before splitting", () => {
    const sessions = toSessions(
      [scrobble("C", 100), scrobble("B", 10), scrobble("D", 110), scrobble("A", 0)],
      30,
      isUnwanted,
    );
    assert.deepEqual(artistsIn(sessions), [
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  it("counts a session as banned when at least half of it would be deleted", () => {
    const [half] = toSessions([scrobble("Peppa Pig", 0), scrobble("Mine", 1)], 30, isUnwanted);
    const [underHalf] = toSessions(
      [scrobble("Peppa Pig", 0), scrobble("Mine", 1), scrobble("Mine", 2)],
      30,
      isUnwanted,
    );
    assert.equal(half.banned, true);
    assert.equal(underHalf.banned, false);
  });

  it("returns no sessions for no scrobbles", () => {
    assert.deepEqual(toSessions([], 30, isUnwanted), []);
  });
});

describe("suggestArtistsToBan", () => {
  const notListed = () => false;

  it("suggests an artist with at least 3 plays, mostly in banned sessions", () => {
    const sessions = [
      session(true, "Peppa Pig", "Josh Gad"),
      session(false, "Mine", "Josh Gad"),
      session(true, "Bluey", "Josh Gad"),
    ];
    assert.deepEqual(suggestArtistsToBan(sessions, notListed), [
      { name: "Josh Gad", reason: "2 of 3 plays in banned sessions" },
    ]);
  });

  it("needs at least 3 plays", () => {
    const sessions = [session(true, "Peppa Pig", "Josh Gad"), session(true, "Bluey", "Josh Gad")];
    assert.deepEqual(suggestArtistsToBan(sessions, notListed), []);
  });

  it("needs more than half of the plays in banned sessions", () => {
    const sessions = [session(true, "Josh Gad", "Josh Gad"), session(false, "Josh Gad", "Josh Gad")];
    assert.deepEqual(suggestArtistsToBan(sessions, notListed), []);
  });

  it("skips artists already on a list", () => {
    const sessions = [session(true, "Josh Gad", "Josh Gad", "Josh Gad", "Peppa Pig")];
    const suggestions = suggestArtistsToBan(sessions, (artist) => artist === "Josh Gad" || bannedArtists.has(artist));
    assert.deepEqual(suggestions, []);
  });

  it("puts the most plays in banned sessions first, then the fewest plays overall", () => {
    const sessions = [
      session(true, "Five", "Five", "Five", "Five", "Five"),
      session(true, "ThreeOfFour", "ThreeOfFour", "ThreeOfFour", "ThreeOfThree", "ThreeOfThree", "ThreeOfThree"),
      session(false, "ThreeOfFour"),
    ];
    assert.deepEqual(
      suggestArtistsToBan(sessions, notListed).map(({ name }) => name),
      ["Five", "ThreeOfThree", "ThreeOfFour"],
    );
  });
});

describe("suggestAlbumsToBan", () => {
  const SHREK = "music/Various+Artists/Shrek";
  const CINDERELLA = "music/Various+Artists/Cinderella";
  const GIRL = "music/Pharrell+Williams/G+I+R+L";
  const isAllowed = (artist: string) => artist === "Pharrell Williams";
  const notBanned = () => false;

  it("suggests a compilation that only turns up in banned sessions", () => {
    const sessions = [
      albumSession(true, ["Smash Mouth", SHREK], ["Eels", SHREK]),
      albumSession(true, ["Smash Mouth", SHREK]),
    ];
    assert.deepEqual(suggestAlbumsToBan(sessions, isAllowed, notBanned), [
      { name: SHREK, reason: "compilation, all 3 plays in banned sessions" },
    ]);
  });

  it("suggests an album by an allow-listed artist that only turns up in banned sessions", () => {
    const sessions = [
      albumSession(true, ["Pharrell Williams", GIRL], ["Pharrell Williams", GIRL]),
      albumSession(true, ["Pharrell Williams", GIRL]),
    ];
    assert.deepEqual(suggestAlbumsToBan(sessions, isAllowed, notBanned), [
      { name: GIRL, reason: "by Pharrell Williams, all 3 plays in banned sessions" },
    ]);
  });

  it("leaves albums by other artists to the artist suggestions", () => {
    const frozen = "music/Josh+Gad/Frozen";
    const sessions = [albumSession(true, ["Josh Gad", frozen], ["Josh Gad", frozen], ["Josh Gad", frozen])];
    assert.deepEqual(suggestAlbumsToBan(sessions, isAllowed, notBanned), []);
  });

  it("needs every play to be in a banned session", () => {
    const sessions = [
      albumSession(true, ["Smash Mouth", SHREK], ["Eels", SHREK]),
      albumSession(false, ["Smash Mouth", SHREK]),
    ];
    assert.deepEqual(suggestAlbumsToBan(sessions, isAllowed, notBanned), []);
  });

  it("needs at least 3 plays", () => {
    const sessions = [albumSession(true, ["Smash Mouth", SHREK], ["Eels", SHREK])];
    assert.deepEqual(suggestAlbumsToBan(sessions, isAllowed, notBanned), []);
  });

  it("skips albums that are already banned", () => {
    const sessions = [albumSession(true, ["Smash Mouth", SHREK], ["Eels", SHREK], ["Smash Mouth", SHREK])];
    const isBannedAlbum = (album: string) => album === `https://www.last.fm/${SHREK}`;
    assert.deepEqual(suggestAlbumsToBan(sessions, isAllowed, isBannedAlbum), []);
  });

  it("skips links that are not albums", () => {
    const track = "music/Pharrell+Williams/_/Happy";
    const sessions = [
      albumSession(true, ["Pharrell Williams", track], ["Pharrell Williams", track], ["Pharrell Williams", track]),
    ];
    assert.deepEqual(suggestAlbumsToBan(sessions, isAllowed, notBanned), []);
  });

  it("puts the most played albums first, then sorts by path", () => {
    const sessions = [
      albumSession(true, ["A", CINDERELLA], ["B", CINDERELLA], ["C", CINDERELLA]),
      albumSession(true, ["A", SHREK], ["B", SHREK], ["C", SHREK], ["D", SHREK]),
      albumSession(true, ["Pharrell Williams", GIRL], ["Pharrell Williams", GIRL], ["Pharrell Williams", GIRL]),
    ];
    assert.deepEqual(
      suggestAlbumsToBan(sessions, isAllowed, notBanned).map(({ name }) => name),
      [SHREK, GIRL, CINDERELLA],
    );
  });
});

describe("suggestArtistsToAllow", () => {
  const notListed = () => false;

  it("suggests an artist with at least 3 plays, none in banned sessions", () => {
    const sessions = [session(false, "Massive Attack", "Massive Attack"), session(false, "Massive Attack")];
    assert.deepEqual(suggestArtistsToAllow(sessions, notListed), [
      { name: "Massive Attack", reason: "3 plays, none in banned sessions" },
    ]);
  });

  it("needs at least 3 plays", () => {
    const sessions = [session(false, "Massive Attack", "Massive Attack")];
    assert.deepEqual(suggestArtistsToAllow(sessions, notListed), []);
  });

  it("rules out an artist with any play in a banned session", () => {
    const sessions = [
      session(false, "Massive Attack", "Massive Attack", "Massive Attack"),
      session(true, "Peppa Pig", "Massive Attack"),
    ];
    assert.deepEqual(suggestArtistsToAllow(sessions, notListed), []);
  });

  it("skips artists already on a list", () => {
    const sessions = [session(false, "Massive Attack", "Massive Attack", "Massive Attack")];
    assert.deepEqual(
      suggestArtistsToAllow(sessions, (artist) => artist === "Massive Attack"),
      [],
    );
  });

  it("puts the most played first, then sorts by name", () => {
    const sessions = [
      session(false, "UNKLE", "UNKLE", "UNKLE"),
      session(false, "Zero 7", "Zero 7", "Zero 7", "Zero 7"),
      session(false, "Archive", "Archive", "Archive"),
    ];
    assert.deepEqual(
      suggestArtistsToAllow(sessions, notListed).map(({ name }) => name),
      ["Zero 7", "Archive", "UNKLE"],
    );
  });
});

describe("formatSuggestions", () => {
  it("starts with when it was generated, then writes each section with a heading, one suggestion per line, and (none) when empty", () => {
    const generatedAt = new Date(2026, 9, 21, 16, 20);
    const text = formatSuggestions(
      [
        {
          title: "Artists to ban",
          suggestions: [
            { name: "Josh Gad", reason: "3 of 4 plays in banned sessions" },
            { name: "Gummy Kid", reason: "3 of 3 plays in banned sessions" },
          ],
        },
        { title: "Albums to ban", suggestions: [] },
      ],
      generatedAt,
    );
    assert.equal(
      text,
      [
        `# Suggestions from the dry run at ${generatedAt.toLocaleString()}`,
        "",
        "# Artists to ban",
        "Josh Gad  # 3 of 4 plays in banned sessions",
        "Gummy Kid  # 3 of 3 plays in banned sessions",
        "",
        "# Albums to ban",
        "# (none)",
        "",
      ].join("\n"),
    );
  });
});
