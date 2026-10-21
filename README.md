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
| `DEFAULT_PAGES` | How many library pages to scan when there is no record of a previous real run (default `10`) |
| `MAX_PAGES` | The most library pages a single run will scan (default `50`) |
| `SESSION_GAP_MINUTES` | A gap longer than this between scrobbles starts a new listening session (default `30`) |

## Data files
Your lists live in the `data/` folder, which is kept out of source control. Each list has one entry per line.

| File | Contents |
|---|---|
| `data/banned.list.txt` | Artists whose scrobbles are deleted, e.g. `Peppa Pig` |
| `data/banned.album.list.txt` | Albums whose scrobbles are deleted, as the path from the album's Last.fm URL, e.g. `music/Various+Artists/Shrek` |
| `data/allow.list.txt` | Artists that are yours. They are never suggested for banning. |
| `data/last-seen.json` | Written by the tool: the newest scrobble left after the last completed real run |
| `data/suggestions.txt` | Written by the tool: the suggestions from the latest dry run |

Both banned lists are required. The allow list is optional, but the tool warns when it is missing, as suggestions are noisier without it. Artist names must match Last.fm exactly. Delete `data/last-seen.json` to make the next run start from `DEFAULT_PAGES` again.

## How a run works
A run deletes the scrobbles that match a banned artist or album. A dry run only lists them. Both scan the same pages:

1. Read library pages from page 1 back to the last-seen scrobble from the previous real run, then 2 pages further. With no previous run, read `DEFAULT_PAGES` pages.
2. While the oldest page read still has a scrobble to delete, read one more page.
3. Stop at `MAX_PAGES`, with a warning that unwanted scrobbles may go back further.

Pages are worked from the oldest back to page 1, so deletions never shift pages that are still to be checked. When a real run finishes it records the newest remaining scrobble in `data/last-seen.json`, so the next run only has to look at what is new. If the run stopped at `MAX_PAGES`, the record is left unchanged so the next run covers the same ground again.

A dry run never deletes anything and never updates `data/last-seen.json`.

## Suggestions
A dry run groups the scanned scrobbles into listening sessions, split wherever there is a gap longer than `SESSION_GAP_MINUTES`. A session counts as banned when at least half of its scrobbles would be deleted.

From those sessions it suggests:

- **Artists to ban**: artists in neither list who appear at least 3 times, mostly in banned sessions.
- **Albums to ban**: albums that cannot be banned by artist, played at least 3 times and only ever in banned sessions. These are Various Artists compilations and albums by artists on your allow list.
- **Artists to allow**: artists in neither list who appear at least 3 times and never in a banned session.

Each suggestion comes with its reason, e.g. `Josh Gad  # 4 of 5 plays in banned sessions`. A summary is printed at the end of the run and the full list is written to `data/suggestions.txt`. Copy the entries you agree with into the matching list, without the `# ...` reason. Album suggestions are already in the path form `data/banned.album.list.txt` uses. To stop an artist being suggested, add them to `data/allow.list.txt`.

## Development
```bash
npm test
```
```bash
npm run typecheck
```
```bash
npm run lint
```
