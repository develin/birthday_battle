# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Birthday Battle is a scorekeeper for kids' birthday party games. It is a static, dependency-free browser app (plain HTML/CSS/JS, no build step, no framework, no package manager) that must keep working offline, opened straight from disk.

## Running

Open `src/index.html` in a browser (works from `file://`). There is no build, lint or test tooling, and Node is not installed on the dev machine.

To check rendering without a browser UI, use headless Edge. `--virtual-time-budget` advances timers so animations and delayed reveals finish before the screenshot:

```powershell
& "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" --headless=new --disable-gpu --user-data-dir="<scratch>\edge" --window-size=1100,800 --virtual-time-budget=8000 --screenshot="<scratch>\shot.png" "file:///C:/.../src/index.html#/scores"
```

To test a screen with data, copy `src/` to a scratch folder and inject a `<script>` before `app.js` that calls `localStorage.setItem('birthday-battle-v1', JSON.stringify({...}))`.

## Architecture

All logic lives in `src/app.js`; `src/index.html` is only a shell (`#nav`, `#app`).

- **State**: one `state` object `{ kids, gameList, games, current, points }`, persisted whole to `localStorage` under `birthday-battle-v1` via `saveState()` after every mutation. `gameList` is the configurable list of games (`{ id, name, active }`); `games` is the history of games played. `points` holds the 1st/2nd/3rd place values. Changing the state shape requires keeping `loadState()` compatible with existing saved data (it merges saved state over `defaultState()`, which is how older saves get `DEFAULT_GAMES`). "Start a new party" clears kids and history but keeps `gameList` and `points`.
- **Picking a game**: wherever a new game can be started there are two buttons (`newGameButtons()`): "Neues Spiel" (`#/game`, tap a game tile) and "🎲 Zufall" (`#/wheel`, the Glücksrad). Both only offer active `gameList` entries.
- **Wheel weighting and sessions**: each list entry has a `played` round count. A slice's size is `0.5^played` of the total (`wheelWeight`, `wheelSlices`). `finishGame()` increments `played` for the game (matched by `current.gameId`, falling back to name) and calls `normalizeRounds()`: once every *active* game has `played >= 1`, all counts drop by one, which starts a new session. Toggling or deleting games also normalizes; "Neue Party starten" resets all counts to 0. `played` is separate from the history count (`timesPlayed`), which never decreases.
- **Wheel animation** (`startWheel`): driven by `requestAnimationFrame` with a phase machine — `slow` (2 s, Stopp button locked), `ramp`, `fast` (random top speed, Stopp enabled), `stopping` (random exponential friction), `done`. The winner is the slice under the top pointer. `render()` calls `stopWheel()` so leaving the screen cancels the loop. Headless Edge doesn't run rAF under `--virtual-time-budget`; when testing, shim `requestAnimationFrame` with `setTimeout` in the test page.
- History entries store the game's name, not its id, so deleting or renaming a list entry doesn't affect past results.
- **Scores are derived, never stored**: totals are recomputed from `state.games[].results` (`totals()`), so deleting a game removes its points. `ranked()` sorts by points and gives tied kids the same rank (Olympic style: two 1sts → next is 3rd); the scoreboard, game history and podium all use it.
- **Game lifecycle**: the new-game form edits a module-level `draft` (not persisted). Starting a game moves it to `state.current` (persisted, so it survives refresh). Finishing pushes it onto `state.games` with an `id` and routes to `#/podium/<gameId>`, or straight to scores if no points were given.
- **Routing**: hash routes `#/setup` (kids), `#/games` (game list), `#/scores`, `#/game`, `#/wheel`, `#/podium/<gameId>`. `render()` is the single entry point: it guards routes (everything except setup and games requires ≥2 kids, all named), redraws the nav, and calls one `renderX()` function. Screens are full `innerHTML` rewrites from template strings. Small in-screen updates call the specific `renderX()` directly rather than `render()`, to avoid scrolling to the top.
- **Events**: one delegated `click` listener dispatches on `data-action` attributes (plus `input` and `keydown` listeners). New buttons should add a `data-action` case, not their own listeners. Setup name inputs update state on `input` without re-rendering, to keep focus.
- **Escaping**: user text (kid and game names) must go through `esc()` when interpolated into templates.
- **Podium**: steps and ground kids start hidden; the `.reveal` class on `#stage` triggers the CSS rise and pop animations. It is added when the "Sieger <name>" overlay (`showWinnerPop`) is dismissed (3 s timeout or click).

## Design and layout

- **Primary target is a TV (1280×720 and up)**, viewed from across the room. The root `font-size` scales with the viewport (`min(1.45vw, 2.6vh)`) and everything is sized in `rem`, so the UI scales with the screen. The scoreboard, game-in-progress and podium screens (`.screen.fit`) fill the viewport height and should not scroll at 720p; the scoreboard switches to two columns above `BOARD_ONE_COLUMN_MAX` kids. Below 900px wide or in portrait, screens fall back to normal scrolling layouts, down to phone width.
- Look: a dark "game-show stage" (palette tokens on `:root` in `src/styles.css`), Bungee for display text and numbers, Baloo 2 for UI text. Both fonts are bundled in `src/fonts/` so the app works offline.
- Each kid has a `color` (from `KID_COLORS`, assigned on creation; `ensureKidColors()` backfills older saved data). Templates pass it as the CSS variable `--kid` via `kidStyle(kid)`, and it should appear wherever that kid appears.
- Watch selector specificity: `.screen.fit` sets `display: flex`, so screen-specific layout rules must be at least as specific (e.g. `.screen.scores-screen`).
- When checking rendering at small widths, note that headless Edge enforces a minimum viewport of about 492px and crops narrower screenshots.
- **All UI text is German**, written for elementary-school kids: short sentences, everyday words, no abbreviations (e.g. "Punkte", not "Pkt."), places written as "4. Platz". Keep code, comments and identifiers in English. Avatars are emoji (no image assets).
