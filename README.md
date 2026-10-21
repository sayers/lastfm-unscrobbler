# Last.fm unscrobbler
A simple tool that will remove unwanted scrobbles from your Last.fm account

## Why?
When the family shares one Last.fm account, the kids' music ends up all over your history. This tool logs in to Last.fm, goes through your library, and deletes any scrobble by a banned artist or from a banned album.

## Requirements
- Node.js 22.6 or newer
- A Last.fm account (username and password; no API key is needed)

## Setup
1. Install the dependencies and the Playwright browser:
   ```bash
   npm install
   ```
   ```bash
   npx playwright install chromium
   ```
2. Copy `.env-example` to `.env` and fill in your details (see [Configuration](#configuration)).
3. Create the `data/` folder with your lists (see [Data files](#data-files)).

## Usage
| Command | What it does |
|---|---|
| `npm run start:dry-run` | Lists what would be deleted. Nothing is changed. |
| `npm start` | Deletes the unwanted scrobbles. |
| `npm run start:debug` | Shows the browser and slows each action down. Defaults to a dry run; add `-- --no-dry-run` to really delete. |

Start with a dry run, check the output, then run it for real.

## Configuration
Settings live in `.env`:

| Setting | Meaning |
|---|---|
| `LASTFM_USERNAME` | Your Last.fm username (required) |
| `LASTFM_PASSWORD` | Your Last.fm password (required) |
| `DEFAULT_PAGES` | How many library pages to scan (default `10`) |

## Data files
Your lists live in the `data/` folder, which is kept out of source control. Each list has one entry per line.

| File | Contents |
|---|---|
| `data/banned.list.txt` | Artists whose scrobbles are deleted, e.g. `Peppa Pig` |
| `data/banned.album.list.txt` | Albums whose scrobbles are deleted, as the path from the album's Last.fm URL, e.g. `music/Various+Artists/Shrek` |

Both files are required. Artist names must match Last.fm exactly.

## How a run works
A run checks the newest `DEFAULT_PAGES` pages of your library and deletes the scrobbles that match a banned artist or album. A dry run only lists them.

Pages are worked from the oldest back to page 1, so deletions never shift pages that are still to be checked.

## Development
```bash
npm run typecheck
```
```bash
npm run lint
```
