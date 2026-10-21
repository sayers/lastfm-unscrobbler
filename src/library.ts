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

export const readLibraryPage = async (page: Page, username: string, pageNumber: number): Promise<Scrobble[]> => {
  await page.goto(`https://www.last.fm/user/${username}/library?page=${pageNumber}`);

  const rows = page.locator(".chartlist-row--with-artist");
  await rows.first().waitFor();

  const scrobbles: Scrobble[] = [];
  const count = await rows.count();
  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);
    const artist = row.locator(".chartlist-artist a");
    if ((await artist.count()) === 0) {
      continue;
    }
    scrobbles.push({
      artist: (await artist.first().innerHTML()).trim(),
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
    });
  }
  return scrobbles;
};
