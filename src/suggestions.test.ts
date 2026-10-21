import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Locator } from "playwright";

import type { Scrobble } from "./library.ts";
import { formatSuggestions, type Session, suggestArtistsToBan, toSessions } from "./suggestions.ts";

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
