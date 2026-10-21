import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

import {
  ALLOWED_ARTISTS_FILE,
  BANNED_ALBUMS_FILE,
  BANNED_ARTISTS_FILE,
  findConflicts,
  findDuplicates,
  loadAllowed,
  loadBanned,
  readList,
} from "./banned.ts";
import { appendToDeletedLog, DELETED_LOG_FILE } from "./deleted-log.ts";
import { LAST_SEEN_FILE, type LastSeen, readLastSeen, writeLastSeen } from "./last-seen.ts";
import { deleteScrobble, readLastPageNumber, readLibraryPage, type Scrobble } from "./library.ts";
import {
  findUnknownArtists,
  printSuggestions,
  SUGGESTIONS_FILE,
  suggestAlbumsToBan,
  suggestArtistsToAllow,
  suggestArtistsToBan,
  suggestArtistsToDecide,
  toSessions,
  writeSuggestions,
} from "./suggestions.ts";

const USERNAME = process.env.LASTFM_USERNAME;
const PASSWORD = process.env.LASTFM_PASSWORD;
const DEFAULT_PAGES = Number(process.env.DEFAULT_PAGES || 10);
const MAX_PAGES = Number(process.env.MAX_PAGES || 50);
const SESSION_GAP_MINUTES = Number(process.env.SESSION_GAP_MINUTES || 30);

const problems: string[] = [];
if (!USERNAME || !PASSWORD) {
  problems.push("LASTFM_USERNAME and LASTFM_PASSWORD must both be set in .env.");
}
if (!Number.isInteger(DEFAULT_PAGES) || DEFAULT_PAGES < 1) {
  problems.push(`DEFAULT_PAGES in .env must be a whole number of at least 1, not "${process.env.DEFAULT_PAGES}".`);
} else if (!Number.isInteger(MAX_PAGES) || MAX_PAGES < DEFAULT_PAGES) {
  problems.push(
    `MAX_PAGES in .env must be a whole number no smaller than DEFAULT_PAGES (${DEFAULT_PAGES}), not "${process.env.MAX_PAGES ?? MAX_PAGES}".`,
  );
}
if (!(SESSION_GAP_MINUTES > 0)) {
  problems.push(
    `SESSION_GAP_MINUTES in .env must be a number of minutes above 0, not "${process.env.SESSION_GAP_MINUTES}".`,
  );
}
if (!existsSync(BANNED_ARTISTS_FILE)) {
  problems.push(
    `No banned artist list found at ${resolve(BANNED_ARTISTS_FILE)}. Create it with one artist name per line.`,
  );
}
if (!existsSync(BANNED_ALBUMS_FILE)) {
  problems.push(
    `No banned album list found at ${resolve(BANNED_ALBUMS_FILE)}. Create it with one album path per line, e.g. music/Artist/Album.`,
  );
}
let lastSeen: LastSeen | undefined;
try {
  lastSeen = await readLastSeen();
} catch (error) {
  problems.push(
    `Could not read ${resolve(LAST_SEEN_FILE)} (${error instanceof Error ? error.message : String(error)}). Fix or delete it; without it the run scans DEFAULT_PAGES pages.`,
  );
}
if (problems.length > 0 || !USERNAME || !PASSWORD) {
  console.error(`Cannot start:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
  process.exit(1);
}
if (!existsSync(ALLOWED_ARTISTS_FILE)) {
  console.warn(
    `Warning: no allow list found at ${resolve(ALLOWED_ARTISTS_FILE)}. It would be wise to create it with one artist name per line for the artists that are yours, so they are never suggested for banning.`,
  );
}

// Check the lists before logging in, so mistakes in them are caught straight away.
for (const file of [BANNED_ARTISTS_FILE, BANNED_ALBUMS_FILE, ALLOWED_ARTISTS_FILE].filter((file) => existsSync(file))) {
  const duplicates = findDuplicates(await readList(file));
  if (duplicates.length > 0) {
    console.warn(`Warning: ${resolve(file)} lists these more than once: ${duplicates.join(", ")}`);
  }
}
const bannedLookups = await loadBanned();
const allowedArtists = await loadAllowed();
const conflicts = findConflicts(bannedLookups.artists, allowedArtists);
if (conflicts.length > 0) {
  console.error(
    `Cannot start: these artists are on both ${resolve(BANNED_ARTISTS_FILE)} and ${resolve(ALLOWED_ARTISTS_FILE)}. Remove each one from the list it doesn't belong on:\n${conflicts.map((artist) => `  - ${artist}`).join("\n")}`,
  );
  process.exit(1);
}

const { values } = parseArgs({
  options: {
    "dry-run": { type: "boolean" },
    debug: { type: "boolean", default: false },
  },
  allowNegative: true,
});
const debug = values.debug;
// Debug runs default to a dry run; pass --no-dry-run alongside --debug to really delete.
const dryRun = values["dry-run"] ?? debug;
if (dryRun) {
  console.log("Dry run: unwanted scrobbles will be listed but not deleted.");
}
if (debug) {
  console.log("Debug: showing the browser and slowing down each action.");
}

// In debug mode show the browser window and slow each action down so it can be followed by eye.
const browser = await chromium.launch(debug ? { headless: false, slowMo: 250 } : { headless: true });
// Present as regular desktop Chrome, matching the bundled browser's version so it never goes stale.
const chromeMajor = browser.version().split(".")[0];
const context = await browser.newContext({
  userAgent: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeMajor}.0.0.0 Safari/537.36`,
});
const page = await context.newPage();

const logIn = async (): Promise<{ result: "loggedIn" | "rejected" } | { result: "failed"; reason: string }> => {
  try {
    await page.goto("https://www.last.fm/login");
    await page.fill("#id_username_or_email", USERNAME);
    await page.fill("#id_password", PASSWORD);

    // After submitting, either we leave the login page or Last.fm shows its bad-credentials error.
    // Each wait resolves to true/false rather than rejecting, so whichever loses the race can't crash the script later.
    const loggedIn = page
      .waitForURL((url) => !url.pathname.startsWith("/login"))
      .then(
        () => true,
        () => false,
      );
    const rejected = page
      .getByText("Please enter a correct username/email and password")
      .waitFor()
      .then(
        () => true,
        () => false,
      );
    await page.click('.form-submit [type="submit"]');
    return await Promise.race([
      loggedIn.then((ok) =>
        ok
          ? ({ result: "loggedIn" } as const)
          : ({ result: "failed", reason: "the login page never moved on" } as const),
      ),
      rejected.then((ok) =>
        ok
          ? ({ result: "rejected" } as const)
          : ({ result: "failed", reason: "the login page never moved on" } as const),
      ),
    ]);
  } catch (error) {
    // Playwright errors carry a multi-line call log; the first line says what went wrong.
    return { result: "failed", reason: (error instanceof Error ? error.message : String(error)).split("\n")[0] };
  }
};

const login = await logIn();
if (login.result === "rejected") {
  console.error(
    `Failed to log in: Last.fm rejected the credentials for "${USERNAME}". Check LASTFM_USERNAME and LASTFM_PASSWORD in .env; both may be case-sensitive.`,
  );
} else if (login.result === "failed") {
  console.error(
    `Failed to log in to Last.fm (${login.reason}). Run with --debug to watch what the login page is doing.`,
  );
}
if (login.result !== "loggedIn") {
  await browser.close();
  process.exit(1);
}
console.log("Log in successful, going to library.");

const isUnwanted = (scrobble: Scrobble) =>
  bannedLookups.artists.has(scrobble.artist) || bannedLookups.albums.has(scrobble.album);

const lastPage = await readLastPageNumber(page, USERNAME);
const pageLimit = Math.min(MAX_PAGES, lastPage);

// The first page whose oldest scrobble is older than the previous real run's newest one.
const findLastSeenPage = async ({ timestamp }: LastSeen) => {
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber++) {
    const oldest = (await readLibraryPage(page, USERNAME, pageNumber)).at(-1);
    if (oldest && oldest.timestamp < timestamp) {
      return pageNumber;
    }
  }
  return undefined;
};

let pageCount: number;
let reachedMaxPages = false;
if (lastSeen === undefined) {
  console.log(`No record of a previous real run, so starting with ${DEFAULT_PAGES} pages.`);
  pageCount = Math.min(DEFAULT_PAGES, lastPage);
} else {
  console.log(
    `Looking for the previous real run's newest scrobble: ${lastSeen.artist} - ${lastSeen.track} at ${lastSeen.timestamp.toLocaleString()}`,
  );
  const lastSeenPage = await findLastSeenPage(lastSeen);
  if (lastSeenPage === undefined) {
    pageCount = pageLimit;
    reachedMaxPages = pageLimit < lastPage;
    if (reachedMaxPages) {
      console.warn(
        `Warning: stopped at MAX_PAGES (${MAX_PAGES}) before reaching the previous real run's newest scrobble, so there may be more to delete further back.`,
      );
    }
  } else {
    // Go 2 pages past it, in case anything around it was missed.
    pageCount = Math.min(lastSeenPage + 2, pageLimit);
    console.log(`Found it on page ${lastSeenPage}, so starting with ${pageCount} pages.`);
  }
}

// Unwanted scrobbles on the oldest page scanned may carry on beyond it, so keep going back until a page has none.
while (
  !reachedMaxPages &&
  pageCount < lastPage &&
  (await readLibraryPage(page, USERNAME, pageCount)).some(isUnwanted)
) {
  if (pageCount === MAX_PAGES) {
    reachedMaxPages = true;
    console.warn(
      `Warning: stopped at MAX_PAGES (${MAX_PAGES}) but page ${MAX_PAGES} still has unwanted scrobbles, so there may be more further back.`,
    );
    break;
  }
  console.log(`Page ${pageCount} has unwanted scrobbles, so page ${pageCount + 1} will be scanned too.`);
  pageCount++;
}
console.log(`Scanning ${pageCount} pages`);

const scanned: Scrobble[] = [];
const deleteCounts = { deleted: 0, skipped: 0, failed: 0 };
// Work from the oldest page back to page 1: deleting on a page only shifts the pages after it, which are already done.
for (let pageNumber = pageCount; pageNumber >= 1; pageNumber--) {
  const scrobbles = await readLibraryPage(page, USERNAME, pageNumber);
  console.log(`Page ${pageNumber}: processing ${scrobbles.length} scrobbles`);
  scanned.push(...scrobbles);

  const unwanted = scrobbles.filter(isUnwanted);

  // Delete bottom-up so removing a row doesn't shift the rows still to be deleted.
  for (const scrobble of unwanted.toReversed()) {
    const { artist, track, album } = scrobble;
    console.log(`Unwanted scrobble: ${artist} - ${album} `);
    console.log(`Matched on Name: ${bannedLookups.artists.has(artist)} Album: ${bannedLookups.albums.has(album)} `);
    if (dryRun) {
      continue;
    }
    const outcome = await deleteScrobble(scrobble);
    deleteCounts[outcome.result]++;
    const matched = [bannedLookups.artists.has(artist) && "artist", bannedLookups.albums.has(album) && "album"]
      .filter(Boolean)
      .join(" and ");
    await appendToDeletedLog({ scrobble, outcome, matched });
    if (outcome.result === "skipped") {
      console.warn(`Skipped ${artist} - ${track}: its row no longer shows that scrobble, so it was left alone.`);
    } else if (outcome.result === "failed") {
      console.warn(`Failed to delete ${artist} - ${track}: ${outcome.reason}`);
    }
    // A short pause between deletions so Last.fm isn't hit too quickly.
    await page.waitForTimeout(1000);
  }
}
if (!dryRun) {
  console.log(
    `Deleted ${deleteCounts.deleted} scrobbles, skipped ${deleteCounts.skipped}, failed ${deleteCounts.failed}.`,
  );
  if (deleteCounts.deleted + deleteCounts.skipped + deleteCounts.failed > 0) {
    console.log(`Each attempt is recorded in ${resolve(DELETED_LOG_FILE)}`);
  }
}

// Every artist left after the deletions must be on the banned or allow list.
const unknownArtists = findUnknownArtists(
  scanned,
  (artist) => bannedLookups.artists.has(artist) || allowedArtists.has(artist),
  isUnwanted,
);
const isUnknown = (artist: string) => unknownArtists.has(artist);

if (dryRun) {
  const sessions = toSessions(scanned, SESSION_GAP_MINUTES, isUnwanted);
  console.log(
    `Found ${sessions.length} listening sessions, ${sessions.filter(({ banned }) => banned).length} of them mostly unwanted.`,
  );
  const sections = [
    { title: `Artists to ban (add to ${BANNED_ARTISTS_FILE})`, suggestions: suggestArtistsToBan(sessions, isUnknown) },
    {
      title: `Albums to ban (add to ${BANNED_ALBUMS_FILE})`,
      suggestions: suggestAlbumsToBan(
        sessions,
        (artist) => allowedArtists.has(artist),
        (album) => bannedLookups.albums.has(album),
      ),
    },
    {
      title: `Artists to allow (add to ${ALLOWED_ARTISTS_FILE})`,
      suggestions: suggestArtistsToAllow(sessions, isUnknown),
    },
    {
      title: `Artists to decide (add to ${BANNED_ARTISTS_FILE} or ${ALLOWED_ARTISTS_FILE})`,
      suggestions: suggestArtistsToDecide(sessions, isUnknown),
    },
  ];
  printSuggestions(sections);
  await writeSuggestions(sections);
  console.log(`Suggestions written to ${resolve(SUGGESTIONS_FILE)}`);
}

if (unknownArtists.size > 0) {
  const names = [...unknownArtists];
  console.warn(
    `Warning: ${names.length} artists are on neither the banned nor the allow list: ${names.slice(0, 10).join(", ")}${names.length > 10 ? ", ..." : ""}. Run a dry run for suggestions and add each one to a list.`,
  );
}

// Only a completed real run with every artist decided moves the starting point on;
// otherwise the next run covers the same ground again.
if (dryRun) {
  console.log("Dry run, so the last-seen scrobble was not updated.");
} else if (reachedMaxPages) {
  console.warn("The last-seen scrobble was not updated because the run stopped at MAX_PAGES.");
} else if (unknownArtists.size > 0) {
  console.warn("The last-seen scrobble was not updated because some artists are on neither list.");
} else if (deleteCounts.skipped + deleteCounts.failed > 0) {
  console.warn("The last-seen scrobble was not updated because some unwanted scrobbles were not deleted.");
} else {
  const [newest] = await readLibraryPage(page, USERNAME, 1);
  if (newest) {
    await writeLastSeen(newest);
    console.log(
      `Recorded the newest scrobble for next time: ${newest.artist} - ${newest.track} at ${newest.timestamp.toLocaleString()}`,
    );
  }
}

await browser.close();
