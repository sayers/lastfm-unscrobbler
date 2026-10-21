import type { Locator, Page } from "playwright";

export type Scrobble = {
  artist: string;
  track: string;
  // The album's absolute Last.fm URL, e.g. https://www.last.fm/music/Artist/Album
  album: string;
  // Last.fm only shows scrobble times to the minute, in the account's time zone.
  timestamp: Date;
  row: Locator;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Timestamp titles look like "Wednesday 21 Oct 2026, 4:20am".
const parseTimestamp = (title: string) => {
  const match = /(\d{1,2}) (\w{3}) (\d{4}), (\d{1,2}):(\d{2})(am|pm)/.exec(title);
  const month = match ? MONTHS.indexOf(match[2]) : -1;
  if (!match || month === -1) {
    throw new Error(
      `Could not read the scrobble time "${title}". The Last.fm account's language may need to be English.`,
    );
  }
  const [, day, , year, hour, minute, half] = match;
  return new Date(Number(year), month, Number(day), (Number(hour) % 12) + (half === "pm" ? 12 : 0), Number(minute));
};

// The pagination always ends with the last page's number, either as a link or as the current page.
export const readLastPageNumber = async (page: Page, username: string) => {
  await page.goto(`https://www.last.fm/user/${username}/library?page=1`);
  await page.locator(".chartlist-row--with-artist").first().waitFor();
  const pages = page.locator(".pagination-page:not(.pagination-page--ellipsis)");
  if ((await pages.count()) === 0) {
    return 1;
  }
  return Number(((await pages.last().textContent()) ?? "").trim());
};

// A row's scrobble, or undefined for a row without an artist link.
const readRow = async (row: Locator): Promise<Scrobble | undefined> => {
  const artist = row.locator(".chartlist-artist a");
  if ((await artist.count()) === 0) {
    return undefined;
  }
  return {
    artist: ((await artist.first().textContent()) ?? "").trim(),
    track: ((await row.locator(".chartlist-name a").first().textContent()) ?? "").trim(),
    // Read the resolved href property (absolute URL) rather than the raw attribute.
    album: (
      await row
        .locator(".chartlist-image a")
        .first()
        .evaluate((a) => (a as HTMLAnchorElement).href)
    ).trim(),
    timestamp: parseTimestamp((await row.locator(".chartlist-timestamp span").first().getAttribute("title")) ?? ""),
    row,
  };
};

export const readLibraryPage = async (page: Page, username: string, pageNumber: number): Promise<Scrobble[]> => {
  await page.goto(`https://www.last.fm/user/${username}/library?page=${pageNumber}`);

  const rows = page.locator(".chartlist-row--with-artist");
  await rows.first().waitFor();

  const scrobbles: Scrobble[] = [];
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const scrobble = await readRow(rows.nth(i));
    if (scrobble) {
      scrobbles.push(scrobble);
    }
  }
  return scrobbles;
};

export type DeleteOutcome = { result: "deleted" } | { result: "skipped" } | { result: "failed"; reason: string };

// How long Last.fm gets to remove a row after its delete button is clicked.
const DELETE_TIMEOUT_MS = 10_000;

// Deletes a scrobble, but only if its row still shows the scrobble it was read as,
// so a page that has shifted since it was read can't lose the wrong one.
// Counts as deleted only once Last.fm has removed the row.
export const deleteScrobble = async ({ artist, track, timestamp, row }: Scrobble): Promise<DeleteOutcome> => {
  try {
    const current = (await row.count()) === 1 ? await readRow(row) : undefined;
    if (current?.artist !== artist || current.track !== track || current.timestamp.getTime() !== timestamp.getTime()) {
      return { result: "skipped" };
    }
    // Hold on to this exact element: the row locator moves on to the next row once this one goes.
    const element = await row.elementHandle();
    await row.hover();
    await row.locator(".chartlist-more button.chartlist-more-button").click();
    await row.locator('.chartlist-more [type="submit"].more-item--delete').click();
    await element.waitForElementState("hidden", { timeout: DELETE_TIMEOUT_MS });
    return { result: "deleted" };
  } catch (error) {
    // Playwright errors carry a multi-line call log; the first line says what went wrong.
    return { result: "failed", reason: (error instanceof Error ? error.message : String(error)).split("\n")[0] };
  }
};
