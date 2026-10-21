import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatLogLine } from "./deleted-log.ts";

const loggedAt = new Date("2026-10-21T04:30:12.000Z");
const scrobble = {
  artist: "Peppa Pig",
  track: "Theme",
  album: "https://www.last.fm/music/Peppa+Pig/Album",
  timestamp: new Date("2026-10-21T03:20:00.000Z"),
};

describe("formatLogLine", () => {
  it("records a deletion with when, what, the album path and why", () => {
    assert.equal(
      formatLogLine({ scrobble, outcome: { result: "deleted" }, matched: "artist" }, loggedAt),
      "2026-10-21T04:30:12.000Z  deleted  Peppa Pig - Theme  scrobbled 2026-10-21T03:20:00.000Z  music/Peppa+Pig/Album  matched artist",
    );
  });

  it("records a skipped row", () => {
    assert.equal(
      formatLogLine({ scrobble, outcome: { result: "skipped" }, matched: "artist and album" }, loggedAt),
      "2026-10-21T04:30:12.000Z  skipped  Peppa Pig - Theme  scrobbled 2026-10-21T03:20:00.000Z  music/Peppa+Pig/Album  matched artist and album",
    );
  });

  it("adds the reason for a failed deletion", () => {
    assert.equal(
      formatLogLine(
        { scrobble, outcome: { result: "failed", reason: "Timeout 10000ms exceeded." }, matched: "album" },
        loggedAt,
      ),
      "2026-10-21T04:30:12.000Z  failed  Peppa Pig - Theme  scrobbled 2026-10-21T03:20:00.000Z  music/Peppa+Pig/Album  matched album  reason: Timeout 10000ms exceeded.",
    );
  });

  it("keeps an album link that isn't on Last.fm as it is", () => {
    const line = formatLogLine(
      { scrobble: { ...scrobble, album: "about:blank" }, outcome: { result: "deleted" }, matched: "artist" },
      loggedAt,
    );
    assert.match(line, / {2}about:blank {2}matched artist$/);
  });
});
