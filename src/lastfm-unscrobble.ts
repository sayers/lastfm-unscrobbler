import { parseArgs } from "node:util";
import { chromium } from "playwright";

import { loadBanned } from "./banned.ts";

const USERNAME = process.env.LASTFM_USERNAME || "Username missing";
const PASSWORD = process.env.LASTFM_PASSWORD || "Password missing";

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
await page.goto("https://www.last.fm/login");
await page.fill("#id_username_or_email", USERNAME);
await page.fill("#id_password", PASSWORD);

await Promise.all([
  page.waitForURL((url) => !url.pathname.startsWith("/login")),
  page.click('.form-submit [type="submit"]'),
]);
console.log("Log in successful, going to library.");

await page.goto(`https://www.last.fm/user/${USERNAME}/library?page=1`);

const rows = page.locator(".chartlist-row--with-artist");
await rows.first().waitFor();
const bannedLookups = await loadBanned();

const count = await rows.count();
console.log(`Processing ${count} scrobbles`);

// Walk the rows bottom-up so deleting one doesn't shift the indexes of those still to be checked.
for (let i = count - 1; i >= 0; i--) {
  const scrobbleContainer = rows.nth(i);
  const artist = scrobbleContainer.locator(".chartlist-artist a");
  if (await artist.count() > 0) {
    const artistName = (await artist.first().innerHTML()).trim();
    // Read the resolved href property (absolute URL) rather than the raw attribute.
    const albumName = (await scrobbleContainer.locator(".chartlist-image a").first()
      .evaluate((a) => (a as HTMLAnchorElement).href)).trim();

    if (bannedLookups.artists.has(artistName) || bannedLookups.albums.has(albumName)) {
      console.log(`Unwanted scrobble: ${artistName} - ${albumName} `);
      console.log(`Matched on Name: ${bannedLookups.artists.has(artistName)} Album: ${bannedLookups.albums.has(albumName)} `);
      if (dryRun) {
        continue;
      }
      await scrobbleContainer.hover();
      await scrobbleContainer.locator(".chartlist-more button.chartlist-more-button").click();
      await scrobbleContainer.locator('.chartlist-more [type="submit"].more-item--delete').click();
      await page.waitForTimeout(1000);
    }
  }
}

await browser.close();
