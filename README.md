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
| `data/deleted.log` | Written by the tool: one line for every scrobble a real run deleted, skipped or failed to delete |

Both banned lists are required. The allow list is optional, but the tool warns when it is missing, as suggestions are noisier without it. Artist names must match Last.fm exactly.

The lists are checked before logging in. An artist on both the banned and allow lists stops the run, so you can decide which list it belongs on. An entry listed twice in the same list only gets a warning. Delete `data/last-seen.json` to make the next run start from `DEFAULT_PAGES` again.

## How a run works
A run deletes the scrobbles that match a banned artist or album. A dry run only lists them. Both scan the same pages:

1. Read library pages from page 1 back to the last-seen scrobble from the previous real run, then 2 pages further. With no previous run, read `DEFAULT_PAGES` pages.
2. While the oldest page read still has a scrobble to delete, read one more page.
3. Stop at `MAX_PAGES`, with a warning that unwanted scrobbles may go back further.

Pages are worked from the oldest back to page 1, so deletions never shift pages that are still to be checked. When a real run finishes it records the newest remaining scrobble in `data/last-seen.json`, so the next run only has to look at what is new. The record is left unchanged, so the next run covers the same ground again, if the run stopped at `MAX_PAGES`, if any artist in the scanned pages is on neither list, or if any unwanted scrobble was not deleted.

Before deleting a scrobble, a real run checks that its row still shows the same artist, track and time, and skips it if not. A deletion only counts once Last.fm has removed the row; if that doesn't happen within 10 seconds it counts as failed. The run ends with how many scrobbles were deleted, skipped and failed.

Last.fm has no undo, so every attempt is appended to `data/deleted.log` as it happens: when, the outcome, the artist and track, when it was scrobbled, the album, and whether the artist or album matched, plus the reason for a failure. For example:

```
2026-10-21T04:30:12.000Z  deleted  Peppa Pig - Theme  scrobbled 2026-10-21T03:20:00.000Z  music/Peppa+Pig/Album  matched artist
```

Every artist must end up on the banned or allow list. An artist on neither list, whose scrobbles are not all being deleted anyway, is an unknown artist. Any run with unknown artists ends with a warning naming them, and real runs hold back `data/last-seen.json` until each one has been added to a list.

A dry run never deletes anything and never updates `data/last-seen.json`.

## Suggestions
A dry run judges each play by the scrobbles around it. It looks at up to 3 known scrobbles on each side: banned ones (scrobbles that would be deleted) and your own (allow-listed artists). Unknown artists next to it are skipped, so unknown artists played together can't vouch for each other. The search stops at a gap longer than `SESSION_GAP_MINUTES`, so a long break keeps one listener's music from judging another's. A play with more banned neighbours is next to banned scrobbles, one with more of your own is next to your own, and a tie or no known neighbours is unclear.

From those judgements it suggests:

- **Artists to ban**: unknown artists with more than half of their plays next to banned scrobbles.
- **Albums to ban**: albums that cannot be banned by artist, played at least 3 times and every time next to banned scrobbles. These are Various Artists compilations and albums by artists on your allow list.
- **Artists to allow**: unknown artists played next to your own music and never next to banned scrobbles.
- **Artists to decide**: every other unknown artist, with mixed neighbours or none clear enough to guess from.

Every unknown artist appears in exactly one of the three artist sections, even after a single play, so none can be missed. The play counts in each reason show how strong the guess is, e.g. `Josh Gad  # 4 of 5 plays in banned sessions`. A summary is printed at the end of the run and the full list is written to `data/suggestions.txt`. Copy the entries you agree with into the matching list, without the `# ...` reason. Album suggestions are already in the path form `data/banned.album.list.txt` uses. Once an artist is on either list, it is no longer suggested.

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
