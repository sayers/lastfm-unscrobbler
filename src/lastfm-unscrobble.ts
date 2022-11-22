import * as puppeteer from "puppeteer";

import { loadBanned } from "./banned";

const USERNAME = process.env.LASTFM_USERNAME || "Username missing";
const PASSWORD = process.env.LASTFM_PASSWORD || "Password missing";

(async () => {
  const browser = await puppeteer.launch({headless: true});
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/80.0.3987.0 Safari/537.36");
  await page.goto("https://www.last.fm/login");
  await page.type("#id_username_or_email", USERNAME);
  await page.type("#id_password", PASSWORD);
  
  await Promise.all([
    page.click('.form-submit [type="submit"]'),
    page.waitForNavigation({ waitUntil: 'networkidle0' }),
  ]);
  console.log("Log in successful, going to library.");

  await page.goto(`https://www.last.fm/user/${USERNAME}/library?page=1`);

  await page.waitForTimeout(4000);
  const bannedLookups = await loadBanned();

  const scrobbles = await page.$$(".chartlist-row--with-artist ");
  console.log(`Processing ${scrobbles.length} scrobbles`);  

  for (const scrobbleContainer of scrobbles) {
    const artist: any = await scrobbleContainer.$(".chartlist-artist a");
    if (artist !== null) {
      const artistName = (await (await artist.getProperty("innerHTML")).jsonValue()).trim();
      const album: any = await scrobbleContainer.$(".chartlist-image a");
      const albumName = (await (await album.getProperty("href")).jsonValue()).trim();


      if (bannedLookups.artists.has(artistName) || bannedLookups.albums.has(albumName)) {
        console.log(`Unwanted scrobble: ${artistName} - ${albumName} `);
        console.log(`Matched on Name: ${bannedLookups.artists.has(artistName)} Album: ${bannedLookups.albums.has(albumName)} `);
        await scrobbleContainer.hover();
        await page.waitForTimeout(2000);
        const artistMore = await scrobbleContainer.$(".chartlist-more button.chartlist-more-button");
        if (artistMore) {
          await artistMore.click();
        }
    
        await page.waitForTimeout(4000);
        const artistDelete = await scrobbleContainer.$('.chartlist-more [type="submit"].more-item--delete');
        if (artistDelete) {
          await artistDelete.click();
          await page.waitForTimeout(1000);
        }
      }
    }
  }

  await browser.close();
})();