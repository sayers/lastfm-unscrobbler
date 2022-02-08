import * as puppeteer from "puppeteer";

const USERNAME = process.env.LASTFM_USERNAME || "Username missing";
const PASSWORD = process.env.LASTFM_PASSWORD || "Password missing";

(async () => {
  const browser = await puppeteer.launch({headless: false});
  const page = await browser.newPage();
  await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/80.0.3987.0 Safari/537.36");
  await page.goto("https://www.last.fm/login");
  
  await page.type("#id_username_or_email", USERNAME);
  await page.type("#id_password", PASSWORD);
  await page.click('.form-submit [type="submit"]');
  await page.waitForNavigation();
  
  await page.goto(`https://www.last.fm/user/${USERNAME}/library`);
  
  await page.waitFor(4000);
  await browser.close();
})();