import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Locator } from "playwright";

import type { Scrobble } from "./library.ts";
import {
  findUnknownArtists,
  formatSuggestions,
  type JudgedPlay,
  type Judgement,
  judgePlays,
  suggestAlbumsToBan,
  suggestArtistsToAllow,
  suggestArtistsToBan,
  suggestArtistsToDecide,
  toSessions,
} from "./suggestions.ts";

const bannedArtists = new Set(["Peppa Pig", "Bluey"]);
const allowedArtists = new Set(["Portishead", "Leftfield"]);
const isUnwanted = (scrobble: Scrobble) => bannedArtists.has(scrobble.artist);
const isAllowed = (artist: string) => allowedArtists.has(artist);
const isUnknown = (artist: string) => !bannedArtists.has(artist) && !allowedArtists.has(artist);

// A scrobble the given number of minutes after 9am; the row is never touched by the suggestion logic.
const scrobble = (artist: string, minute: number): Scrobble => ({
  artist,
  track: "Track",
  album: `https://www.last.fm/music/${artist}/Album`,
  timestamp: new Date(2026, 9, 20, 9, minute),
  row: {} as Locator,
});

// Scrobbles one minute apart, in the order given.
const inOrder = (...artists: string[]) => artists.map((artist, i) => scrobble(artist, i));

// Each scrobble's artist and judgement, in time order.
const judge = (scrobbles: Scrobble[], gapMinutes = 30) =>
  judgePlays(toSessions(scrobbles, gapMinutes), isUnwanted, isAllowed).map(
    ({ scrobble, judgement }) => `${scrobble.artist}: ${judgement}`,
  );

// Plays already judged, for testing the suggestions on their own.
const plays = (judgement: Judgement, ...artists: string[]): JudgedPlay[] =>
  artists.map((artist, i) => ({ scrobble: scrobble(artist, i), judgement }));

const albumPlays = (judgement: Judgement, ...entries: [artist: string, albumPath: string][]): JudgedPlay[] =>
  entries.map(([artist, albumPath], i) => ({
    scrobble: { ...scrobble(artist, i), album: `https://www.last.fm/${albumPath}` },
    judgement,
  }));

const artistsIn = (sessions: Scrobble[][]) => sessions.map((session) => session.map(({ artist }) => artist));

describe("toSessions", () => {
  it("starts a new session after a gap longer than the setting", () => {
    const sessions = toSessions([scrobble("A", 0), scrobble("B", 10), scrobble("C", 41)], 30);
    assert.deepEqual(artistsIn(sessions), [["A", "B"], ["C"]]);
  });

  it("keeps a gap of exactly the setting in the same session", () => {
    const sessions = toSessions([scrobble("A", 0), scrobble("B", 30)], 30);
    assert.deepEqual(artistsIn(sessions), [["A", "B"]]);
  });

  it("sorts scrobbles by time before splitting", () => {
    const sessions = toSessions([scrobble("C", 100), scrobble("B", 10), scrobble("D", 110), scrobble("A", 0)], 30);
    assert.deepEqual(artistsIn(sessions), [
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  it("returns no sessions for no scrobbles", () => {
    assert.deepEqual(toSessions([], 30), []);
  });
});

describe("judgePlays", () => {
  it("judges a play between banned scrobbles as near banned", () => {
    assert.deepEqual(judge(inOrder("Peppa Pig", "Josh Gad", "Bluey"))[1], "Josh Gad: near banned");
  });

  it("judges a play between your own music as near own", () => {
    assert.deepEqual(judge(inOrder("Portishead", "Massive Attack", "Leftfield"))[1], "Massive Attack: near own");
  });

  it("skips unknown neighbours, so unknown artists can't vouch for each other", () => {
    assert.deepEqual(judge(inOrder("Peppa Pig", "Josh Gad", "KATSEYE", "Gummy Kid", "Bluey")).slice(1, 4), [
      "Josh Gad: near banned",
      "KATSEYE: near banned",
      "Gummy Kid: near banned",
    ]);
    assert.deepEqual(judge(inOrder("Josh Gad", "KATSEYE")), ["Josh Gad: unclear", "KATSEYE: unclear"]);
  });

  it("counts at most 3 known neighbours on each side", () => {
    // Before: Peppa Pig and two of the four Portishead plays; after: Bluey. 2 banned, 2 own.
    const scrobbles = inOrder("Portishead", "Portishead", "Portishead", "Portishead", "Peppa Pig", "Josh Gad", "Bluey");
    assert.deepEqual(judge(scrobbles)[5], "Josh Gad: unclear");
  });

  it("judges a tie, or a play with no known neighbours, as unclear", () => {
    assert.deepEqual(judge(inOrder("Peppa Pig", "Josh Gad", "Portishead"))[1], "Josh Gad: unclear");
    assert.deepEqual(judge(inOrder("Josh Gad")), ["Josh Gad: unclear"]);
  });

  it("doesn't look across a gap longer than the session setting", () => {
    const scrobbles = [
      scrobble("Peppa Pig", 0),
      scrobble("Bluey", 1),
      scrobble("Josh Gad", 40),
      scrobble("Portishead", 41),
    ];
    assert.deepEqual(judge(scrobbles)[2], "Josh Gad: near own");
  });

  it("judges every scrobble, known ones included", () => {
    assert.equal(judge(inOrder("Peppa Pig", "Josh Gad", "Portishead")).length, 3);
  });
});

describe("findUnknownArtists", () => {
  const isListed = (artist: string) => bannedArtists.has(artist) || artist === "Massive Attack";

  it("finds artists on neither list", () => {
    const scrobbles = [scrobble("Josh Gad", 0), scrobble("Massive Attack", 1), scrobble("Peppa Pig", 2)];
    assert.deepEqual([...findUnknownArtists(scrobbles, isListed, isUnwanted)], ["Josh Gad"]);
  });

  it("leaves out an artist whose every scrobble would be deleted, but not one with a scrobble left", () => {
    const shrek = "https://www.last.fm/music/Various+Artists/Shrek";
    const onShrek = (artist: string, minute: number) => ({ ...scrobble(artist, minute), album: shrek });
    const isUnwantedAlbum = (s: Scrobble) => s.album === shrek;
    const scrobbles = [onShrek("Smash Mouth", 0), onShrek("Eels", 1), scrobble("Eels", 2)];
    assert.deepEqual([...findUnknownArtists(scrobbles, isListed, isUnwantedAlbum)], ["Eels"]);
  });
});

describe("suggestArtistsToBan", () => {
  it("suggests an unknown artist with more than half its plays next to banned scrobbles", () => {
    const judged = [...plays("near banned", "Josh Gad", "Josh Gad"), ...plays("near own", "Josh Gad")];
    assert.deepEqual(suggestArtistsToBan(judged, isUnknown), [
      { name: "Josh Gad", reason: "2 of 3 plays next to banned scrobbles" },
    ]);
  });

  it("suggests an artist with a single play next to banned scrobbles", () => {
    assert.deepEqual(suggestArtistsToBan(plays("near banned", "Josh Gad"), isUnknown), [
      { name: "Josh Gad", reason: "1 of 1 play next to banned scrobbles" },
    ]);
  });

  it("needs more than half of the plays next to banned scrobbles", () => {
    const judged = [...plays("near banned", "Josh Gad", "Josh Gad"), ...plays("near own", "Josh Gad", "Josh Gad")];
    assert.deepEqual(suggestArtistsToBan(judged, isUnknown), []);
  });

  it("skips artists that are not unknown", () => {
    assert.deepEqual(suggestArtistsToBan(plays("near banned", "Peppa Pig", "Portishead"), isUnknown), []);
  });

  it("puts the most plays next to banned scrobbles first, then the fewest plays overall", () => {
    const judged = [
      ...plays("near banned", "Five", "Five", "Five", "Five", "Five"),
      ...plays(
        "near banned",
        "ThreeOfFour",
        "ThreeOfFour",
        "ThreeOfFour",
        "ThreeOfThree",
        "ThreeOfThree",
        "ThreeOfThree",
      ),
      ...plays("unclear", "ThreeOfFour"),
    ];
    assert.deepEqual(
      suggestArtistsToBan(judged, isUnknown).map(({ name }) => name),
      ["Five", "ThreeOfThree", "ThreeOfFour"],
    );
  });
});

describe("suggestArtistsToAllow", () => {
  it("suggests an unknown artist played next to your own and never next to banned scrobbles", () => {
    const judged = [...plays("near own", "Massive Attack", "Massive Attack"), ...plays("unclear", "Massive Attack")];
    assert.deepEqual(suggestArtistsToAllow(judged, isUnknown), [
      { name: "Massive Attack", reason: "2 of 3 plays next to your own, none next to banned" },
    ]);
  });

  it("suggests an artist with a single play next to your own", () => {
    assert.deepEqual(suggestArtistsToAllow(plays("near own", "Massive Attack"), isUnknown), [
      { name: "Massive Attack", reason: "1 of 1 play next to your own, none next to banned" },
    ]);
  });

  it("rules out an artist with any play next to banned scrobbles", () => {
    const judged = [
      ...plays("near own", "Massive Attack", "Massive Attack"),
      ...plays("near banned", "Massive Attack"),
    ];
    assert.deepEqual(suggestArtistsToAllow(judged, isUnknown), []);
  });

  it("needs at least one play next to your own", () => {
    assert.deepEqual(suggestArtistsToAllow(plays("unclear", "Massive Attack"), isUnknown), []);
  });

  it("puts the most plays next to your own first, then sorts by name", () => {
    const judged = plays("near own", "UNKLE", "UNKLE", "Zero 7", "Zero 7", "Zero 7", "Archive", "Archive");
    assert.deepEqual(
      suggestArtistsToAllow(judged, isUnknown).map(({ name }) => name),
      ["Zero 7", "Archive", "UNKLE"],
    );
  });
});

describe("suggestArtistsToDecide", () => {
  it("suggests an unknown artist with mixed neighbours", () => {
    const judged = [...plays("near banned", "Josh Gad"), ...plays("near own", "Josh Gad")];
    assert.deepEqual(suggestArtistsToDecide(judged, isUnknown), [
      { name: "Josh Gad", reason: "1 of 2 plays next to banned, 1 next to your own" },
    ]);
  });

  it("suggests an unknown artist with no clear neighbours", () => {
    assert.deepEqual(suggestArtistsToDecide(plays("unclear", "Josh Gad"), isUnknown), [
      { name: "Josh Gad", reason: "0 of 1 play next to banned, 0 next to your own" },
    ]);
  });

  it("leaves clear cases to the ban and allow suggestions", () => {
    const judged = [...plays("near banned", "Josh Gad"), ...plays("near own", "Massive Attack")];
    assert.deepEqual(suggestArtistsToDecide(judged, isUnknown), []);
  });

  it("puts the most plays next to banned first, then the most plays overall, then by name", () => {
    const judged = [...plays("near banned", "A", "A", "B", "C"), ...plays("near own", "A", "A", "B", "C", "C")];
    assert.deepEqual(
      suggestArtistsToDecide(judged, isUnknown).map(({ name }) => name),
      ["A", "C", "B"],
    );
  });
});

describe("suggestAlbumsToBan", () => {
  const SHREK = "music/Various+Artists/Shrek";
  const CINDERELLA = "music/Various+Artists/Cinderella";
  const GIRL = "music/Pharrell+Williams/G+I+R+L";
  const isAllowedHere = (artist: string) => artist === "Pharrell Williams";
  const notBanned = () => false;

  it("suggests a compilation whose every play is next to banned scrobbles", () => {
    const judged = albumPlays("near banned", ["Smash Mouth", SHREK], ["Eels", SHREK], ["Smash Mouth", SHREK]);
    assert.deepEqual(suggestAlbumsToBan(judged, isAllowedHere, notBanned), [
      { name: SHREK, reason: "compilation, all 3 plays next to banned scrobbles" },
    ]);
  });

  it("suggests an album by an allow-listed artist whose every play is next to banned scrobbles", () => {
    const judged = albumPlays(
      "near banned",
      ["Pharrell Williams", GIRL],
      ["Pharrell Williams", GIRL],
      ["Pharrell Williams", GIRL],
    );
    assert.deepEqual(suggestAlbumsToBan(judged, isAllowedHere, notBanned), [
      { name: GIRL, reason: "by Pharrell Williams, all 3 plays next to banned scrobbles" },
    ]);
  });

  it("leaves albums by other artists to the artist suggestions", () => {
    const frozen = "music/Josh+Gad/Frozen";
    const judged = albumPlays("near banned", ["Josh Gad", frozen], ["Josh Gad", frozen], ["Josh Gad", frozen]);
    assert.deepEqual(suggestAlbumsToBan(judged, isAllowedHere, notBanned), []);
  });

  it("needs every play to be next to banned scrobbles", () => {
    const judged = [
      ...albumPlays("near banned", ["Smash Mouth", SHREK], ["Eels", SHREK]),
      ...albumPlays("unclear", ["Smash Mouth", SHREK]),
    ];
    assert.deepEqual(suggestAlbumsToBan(judged, isAllowedHere, notBanned), []);
  });

  it("needs at least 3 plays", () => {
    const judged = albumPlays("near banned", ["Smash Mouth", SHREK], ["Eels", SHREK]);
    assert.deepEqual(suggestAlbumsToBan(judged, isAllowedHere, notBanned), []);
  });

  it("skips albums that are already banned", () => {
    const judged = albumPlays("near banned", ["Smash Mouth", SHREK], ["Eels", SHREK], ["Smash Mouth", SHREK]);
    const isBannedAlbum = (album: string) => album === `https://www.last.fm/${SHREK}`;
    assert.deepEqual(suggestAlbumsToBan(judged, isAllowedHere, isBannedAlbum), []);
  });

  it("skips links that are not albums", () => {
    const track = "music/Pharrell+Williams/_/Happy";
    const judged = albumPlays(
      "near banned",
      ["Pharrell Williams", track],
      ["Pharrell Williams", track],
      ["Pharrell Williams", track],
    );
    assert.deepEqual(suggestAlbumsToBan(judged, isAllowedHere, notBanned), []);
  });

  it("puts the most played albums first, then sorts by path", () => {
    const judged = albumPlays(
      "near banned",
      ["A", CINDERELLA],
      ["B", CINDERELLA],
      ["C", CINDERELLA],
      ["A", SHREK],
      ["B", SHREK],
      ["C", SHREK],
      ["D", SHREK],
      ["Pharrell Williams", GIRL],
      ["Pharrell Williams", GIRL],
      ["Pharrell Williams", GIRL],
    );
    assert.deepEqual(
      suggestAlbumsToBan(judged, isAllowedHere, notBanned).map(({ name }) => name),
      [SHREK, GIRL, CINDERELLA],
    );
  });
});

describe("every unknown artist", () => {
  it("is suggested exactly once, to ban, allow or decide", () => {
    const scrobbles = [
      ...inOrder("Peppa Pig", "Josh Gad", "Bluey", "Gummy Kid"),
      scrobble("Portishead", 60),
      scrobble("Josh Gad", 61),
      scrobble("UNKLE", 62),
      scrobble("Leftfield", 63),
      scrobble("Peppa Pig", 120),
      scrobble("Mixed", 121),
      scrobble("Portishead", 122),
      scrobble("Lonely", 300),
    ];
    const judged = judgePlays(toSessions(scrobbles, 30), isUnwanted, isAllowed);
    const unknown = findUnknownArtists(scrobbles, (artist) => !isUnknown(artist), isUnwanted);
    const isUnknownHere = (artist: string) => unknown.has(artist);
    const suggested = [
      ...suggestArtistsToBan(judged, isUnknownHere),
      ...suggestArtistsToAllow(judged, isUnknownHere),
      ...suggestArtistsToDecide(judged, isUnknownHere),
    ].map(({ name }) => name);
    assert.deepEqual(suggested.toSorted(), [...unknown].toSorted());
  });
});

describe("the dry run of 21 Oct 2026", () => {
  // The afternoon from acetonecm's library: their own music, a 22-minute gap, then the kids' music.
  // Judged by whole sessions, the kids' block joined the afternoon's session, which was mostly theirs,
  // so Ninja Sex Party and KATSEYE were wrongly suggested for the allow list.
  const at = (artist: string, time: string): Scrobble => {
    const [hour, minute] = time.split(":").map(Number);
    return { ...scrobble(artist, 0), timestamp: new Date(2026, 9, 21, hour, minute) };
  };
  const banned = new Set(["Justin Bieber", "Pinkfong", "Danny Go!", "PAW Patrol", "Ed Sheeran"]);
  const allowed = new Set(["Younger Brother", "Leftfield", "Portishead", "Chase & Status"]);
  const scrobbles = [
    ...["15:42", "15:49"].map((time) => at("Younger Brother", time)),
    ...["15:54", "16:01", "16:09", "16:14", "16:21", "16:27", "16:31", "16:38", "16:45", "16:51", "16:57", "17:05"].map(
      (time) => at("Leftfield", time),
    ),
    at("Portishead", "17:13"),
    ...["17:21", "17:23", "17:27"].map((time) => at("Chase & Status", time)),
    ...["17:31", "17:38", "17:43", "17:47", "17:53", "17:58", "18:02", "18:06", "18:12", "18:17", "18:23"].map((time) =>
      at("Portishead", time),
    ),
    at("Justin Bieber", "18:45"),
    at("Pinkfong", "18:47"),
    at("Danny Go!", "18:49"),
    ...["18:53", "18:54", "18:55"].map((time) => at("PAW Patrol", time)),
    at("Ninja Sex Party", "18:57"),
    at("KATSEYE", "18:58"),
    at("Justin Bieber", "19:00"),
    at("Justin Bieber", "20:06"),
    at("Ed Sheeran", "21:08"),
  ];
  const isUnwantedHere = (s: Scrobble) => banned.has(s.artist);
  const isUnknownHere = (artist: string) => !banned.has(artist) && !allowed.has(artist);
  const judged = judgePlays(toSessions(scrobbles, 30), isUnwantedHere, (artist) => allowed.has(artist));

  it("suggests banning Ninja Sex Party and KATSEYE", () => {
    assert.deepEqual(
      suggestArtistsToBan(judged, isUnknownHere)
        .map(({ name }) => name)
        .toSorted(),
      ["KATSEYE", "Ninja Sex Party"],
    );
  });

  it("suggests nothing for the allow list", () => {
    assert.deepEqual(suggestArtistsToAllow(judged, isUnknownHere), []);
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
            { name: "Josh Gad", reason: "3 of 4 plays next to banned scrobbles" },
            { name: "Gummy Kid", reason: "3 of 3 plays next to banned scrobbles" },
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
        "Josh Gad  # 3 of 4 plays next to banned scrobbles",
        "Gummy Kid  # 3 of 3 plays next to banned scrobbles",
        "",
        "# Albums to ban",
        "# (none)",
        "",
      ].join("\n"),
    );
  });
});
