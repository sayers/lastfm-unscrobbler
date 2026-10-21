import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

import { BANNED_ALBUMS_FILE, BANNED_ARTISTS_FILE, loadBanned } from "./banned.ts";
import { readLibraryPage } from "./library.ts";

const USERNAME = process.env.LASTFM_USERNAME;
const PASSWORD = process.env.LASTFM_PASSWORD;

const problems: string[] = [];
if (!USERNAME || !PASSWORD) {
  problems.push("LASTFM_USERNAME and LASTFM_PASSWORD must both be set in .env.");
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
if (problems.length > 0 || !USERNAME || !PASSWORD) {
  console.error(`Cannot start:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`);
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

const bannedLookups = await loadBanned();
const scrobbles = await readLibraryPage(page, USERNAME, 1);
console.log(`Processing ${scrobbles.length} scrobbles`);

const unwanted = scrobbles.filter(
  (scrobble) => bannedLookups.artists.has(scrobble.artist) || bannedLookups.albums.has(scrobble.album),
);

// Delete bottom-up so removing a row doesn't shift the rows still to be deleted.
for (const { artist, album, row } of unwanted.toReversed()) {
  console.log(`Unwanted scrobble: ${artist} - ${album} `);
  console.log(`Matched on Name: ${bannedLookups.artists.has(artist)} Album: ${bannedLookups.albums.has(album)} `);
  if (dryRun) {
    continue;
  }
  await row.hover();
  await row.locator(".chartlist-more button.chartlist-more-button").click();
  await row.locator('.chartlist-more [type="submit"].more-item--delete').click();
  await page.waitForTimeout(1000);
}

await browser.close();
