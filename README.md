# BadScout – analyse badminton matches

**Online (after setup):** https://badscout.mpdalbeck.workers.dev/

Part of the “Bad Apps” family, next to [BadClip](https://badclip.mpdalbeck.workers.dev/) (video library), [BadPlan](https://badplan.mpdalbeck.workers.dev/) (training plans) and [BadTeam](https://badteam.mpdalbeck.workers.dev/) (players, groups).
Record your own players’ matches rally by rally and review them. Local-first: no login, no server, no build step.

## Status
Steps 1–4 done: analysis per match (score course per game, how points are won, error rate, shots, players in doubles, coach comment), player page across matches and seasons with trend charts, printable match and player reports (PDF via the print dialog), rally marking (who wins the point and how, keys Q–T / A–G, editable buttons, optional shot and player), automatic score (21 or 15, sets, change of ends), timeline over the whole video, notes at a time (keep playing or pause), rally list for corrections, videos (upload in 8 MB pieces to `badscout-videos/`, streaming via Dropbox link, YouTube, take over from BadClip by copying inside Dropbox), player with slow motion and frame steps, matches (date, event, singles/doubles, scoring to 21 or 15, our players from BadTeam, opponents by name), player pages,
Dropbox sync, backup, tour, German/English, light/dark.
Step 5 done: transfer to BadClip – whole match or selected moments as scenes (player tag, kind of point, shot), optionally as a session; BadScout writes into BadClip's mailbox `badclip-eingang/`, BadClip picks it up. Step 6 done: BadScout is part of the Bad Apps family (green slot, magnifier glyph).
Later: automatic rally detection (AI), live analysis courtside, reports via link to BadPlayer.

## How it works with the other apps
- Players come from BadTeam: BadScout only **reads** `badteam-daten.json` (players without contact data, groups) – it never writes it.
- Sending to BadClip goes through BadClip's mailbox folder `badclip-eingang/*.json`, which BadClip picks up; BadScout never writes BadClip's file.
- Videos taken over from BadClip are copied inside Dropbox (`badclip-videos/` → `badscout-videos/`); BadScout only deletes its own copies.

## Files
- `index.html`, `styles.css`: user interface (accent green `#2ee69b`)
- `js/store.js`: data layer (IndexedDB, export/import, merge with tombstones)
- `js/i18n.js`: all UI texts in German and English
- `js/icons.js`: icon set and the BadScout logo
- `js/app.js`: routing, home and backup pages, keyboard shortcuts
- `js/games.js`: match list, match page, form
- `js/players.js`: players (from BadTeam) and their matches
- `js/badteam.js`: BadTeam bridge (reads `badteam-daten.json`)
- `js/sync.js`, `js/dropbox.js`, `js/config.js`: Dropbox sync (shared Dropbox app “Bad Apps”, file `Dropbox/Apps/Bad Apps/badscout-daten.json`)
- `js/tour.js`: introduction tour
- `js/family.js`: app switcher – identical in all Bad Apps
- `sw.js`, `manifest.webmanifest`, `icon.svg`: PWA
- `wrangler.jsonc`, `_headers`, `.assetsignore`: Cloudflare Workers hosting

## Data format (`badscout-daten.json`)
```
games   { id, day, event, kind: 'single' | 'double', scoring: 21 | 15, ours: [playerId], names: { playerId: name },
          opp: [name], comment, video, rallies: [{ id, t0, t1, win, type, shot, by }], notes: [{ id, t, text }], done, createdAt, updatedAt }
settings { types: [{ id, name, kind }], shots: [], notePause, updatedAt }
deleted { id: timestamp }   (kept 120 days)
```

## Run locally
```bash
python3 -m http.server 8000
```
Then open http://localhost:8000/. For Dropbox, add the local address as a redirect URI in the Dropbox app “Bad Apps”.
