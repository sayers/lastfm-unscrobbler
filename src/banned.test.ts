import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { findConflicts, findDuplicates } from "./banned.ts";

describe("findDuplicates", () => {
  it("names each entry that appears more than once, once, in the order first repeated", () => {
    assert.deepEqual(findDuplicates(["Bluey", "Peppa Pig", "Bluey", "Morphle", "Peppa Pig", "Bluey"]), [
      "Bluey",
      "Peppa Pig",
    ]);
  });

  it("finds nothing in a list with no repeats", () => {
    assert.deepEqual(findDuplicates(["Bluey", "Peppa Pig"]), []);
  });

  it("matches entries exactly, as the lists do", () => {
    assert.deepEqual(findDuplicates(["Bluey", "bluey", "Bluey "]), []);
  });
});

describe("findConflicts", () => {
  it("finds artists on both the banned and allow lists", () => {
    const banned = new Set(["Peppa Pig", "Elton John", "Bluey"]);
    const allowed = new Set(["Massive Attack", "Elton John"]);
    assert.deepEqual(findConflicts(banned, allowed), ["Elton John"]);
  });

  it("finds nothing when the lists don't overlap", () => {
    assert.deepEqual(findConflicts(new Set(["Peppa Pig"]), new Set(["Massive Attack"])), []);
  });

  it("finds nothing when there is no allow list", () => {
    assert.deepEqual(findConflicts(new Set(["Peppa Pig"]), new Set()), []);
  });
});
