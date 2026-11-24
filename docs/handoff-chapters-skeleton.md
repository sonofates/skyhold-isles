# Handoff: chapter skeleton (Phase A of `docs/chapters-plan.md`)

Branch `hermes/sky-ch-skel` (base `art-2d` @ fa1a6d86). 2026-11-24.

## What changed

### Data and order
- **`src/data/chapters.ts`** (new): `PROLOGUE` (`l1c`) + `CHAPTERS` 1–5 (id, number, i18n name/blurb keys, island slots in order, finale, `playable`/`soon`, accent colour, sea colour grade). `CAMPAIGN_ORDER`, `orderByChapters(pool)`, `chapterOf`, `nextChapter`, `freeIslandIds`, `chapterPages`, `pageOfIsland`, `LEGACY_2D_ORDER`.
  - Ch 1 `i01–i09` (finale i09), Ch 2 `i10–i15, i25, i26, i16` (finale i16), Ch 3 `i17–i23, i27, i24` (finale i24), Ch 4/5 "coming soon" (no islands).
- **`src/data/levels2d/index.ts`**: the imports go into `ISLAND_POOL`; `LEVELS_2D = orderByChapters(ISLAND_POOL)`. A chapter slot whose island is not in the pool is skipped. Today i25–i27 are missing, so the order is the same as before (`l1c, i01…i24`) and Ch 2 shows 7 islands, Ch 3 shows 8.
  - **For the island agent:** to register i25/i26/i27, add the import and put the level in `ISLAND_POOL` (or `chapterTwo`, if it should go through the enemy-roster check). The chapter slot decides where it sits. Nothing else is needed for the map or the unlock chain.
- **Campaign "next island"** is simply the next one in `LEVELS_2D`, so chapter order drives it. `inGame.ts` `nextIslandOpen`: the end panel's **Next Isle is hidden across a chapter boundary** (winning the Prologue or a finale), so the player goes back to the World Map, where the chapter cards show. This is a small change outside my file list (3 lines).

### Unlock rule / saves (`progress2d.ts`, `chapterState.ts`)
- Unlocking stays the existing single frontier over `LEVELS_2D`. The finale is the last island of each chapter, so winning it is exactly what opens the next chapter. `chapterStates()` (new, `src/render2d/ui/chapterState.ts`) gives each chapter: opened (any own island unlocked), complete (finale won), played, cleared/total, stars/max, frontier.
- **No relock:** stored saves keep their id order, and `remapProgress` moves the frontier by id. So a player who beat i16 keeps i17+, and i25/i26 (inserted before i16) appear unlocked but unplayed. A player stopped at i16 keeps i16 open, and the new islands before it open too. Tests cover both cases.
- **New:** `legacyIdOrder()`. A save or save code that never stored an id order is now read in the flat pre-chapter order (`LEGACY_2D_ORDER`) instead of the current order. Without this, stars would shift by two islands once i25 lands. Rosters that are not the real one (tests, other ids) keep their own order.
- No migration flag is stored. "Chapter complete" is derived from the stars, as the plan says.

### World map (`worldMap.ts`, `worldChapters.css`, `mapLayout.ts` unchanged)
- One page per chapter. The Prologue sits on Chapter 1's page with a "P"/"Ö" tag. Islands are numbered 1–9 per chapter. The title banner shows the chapter name.
- **Chapter bar** at the bottom centre: ‹ arrow, plaque "Chapter 2 · 3/7 ★ 6/21", 5 numbered tabs (`role=tablist`, so gamepad LB/RB switch them), › arrow. The layout reserves the bar's height, so the route never goes under it (QA checks this).
- The map opens on the frontier's chapter. `?chapter=N` opens chapter N (QA).
- **Locked chapter:** fog over the page, the islands are faint silhouettes (not clickable or focusable), and a card shows "Chapter 3 · Bell & Lantern Isles · Locked · Win the Chapter 2 finale to open this chapter." On mobile without the full adventure, the card adds "Chapter 2 onward is part of the full adventure."
- **Chapters 4–5:** fog plus a "Coming soon" card, no islands.
- **Turning pages:** the arrows and tabs; keyboard `PageUp`/`PageDown`/`[`/`]`; ←/→ at the end of the route; a touch swipe that starts and ends at the route's end. Enter still opens the frontier island and switches to its page first.
- **Sea tint per chapter:** a new `uGrade` uniform in the WebGL water shader (`seaWater.ts`, per-channel multiplier plus saturation) and `SeaHandle.setGrade` (`seaLife.ts`). These are small changes outside my file list. The still CSS painting gets a `mix-blend-mode: color` wash. Ch 2 is cooler and stormier, Ch 3 warmer; see the `-gl` shots.
- `window.__map` now has `chapter()`, `chapters()`, `showChapter(p)`. `islands()` returns only the islands on the page shown.

### Chapter cards (`chapterCards.ts` + `.css`, new)
- **Title card:** shown when a chapter opens. Story-panel style, with the chapter's first island's intro painting, kicker "A new chapter begins", the name, a blurb and "Set sail".
- **"Chapter complete!" card:** shown after a finale. It has the finale's outro painting, star stamps plus "★ 18/27", "9/9 islands", and "On to Chapter 2" (switches the page, then the title card follows). After Ch 3 it shows "Chapter 4 is coming soon…" and "Back to the map".
- When cards show (`cardsDue`): each card shows once (localStorage `skyhold2d_chapter_cards_v1`). A title card shows only if no island in that chapter has been won yet. A complete card shows only if the next chapter is untouched. Older saves further along are marked as seen without showing anything, so nobody gets a stack of cards after the update. No cards show over a QA `?screen=` or a `?store=` deep link.
- QA: `?chapter=N&screen=chaptertitle|chapterdone`.

### Store / free scope
- `src/platform/iap.ts`: `FREE_ISLANDS = freeIslandIds()` = Prologue + Chapter 1 (10 islands, owner decision).
- `store2d.ts`: the intro now says "The Prologue and Chapter 1 are free. The full adventure opens Chapter 2 onward: all N isles.", and the full-unlock blurb says "Chapter 2 onward: every isle…". Chapter numbers come from the chapter list.

### i18n
- `chapter.*` keys in EN + TR: names (working titles from the owner), blurbs, bar, tabs aria, locked/soon, and the cards. `store.intro` / `store.blurbFull` were reworded with new params (`{free}`, `{n}`).

## How it was verified
- `npx tsc --noEmit`, `npm run lint`, `npx vitest run` (142 files, 1833 passed), `npm run sim:balance`, `sim:items`, `sim:difficulty`, `npm run build`: all pass.
- New tests in `tests/data/chapters.test.ts` (22): chapter list, order from chapters, skipped slots (7/9, 8/9) and new-island slot placement, unlock chain through all finales with i25–i27 stand-ins, old-save no-relock (remap, stored save, id-less save, id-less save code), free scope, store copy (EN/TR), card logic. Updated tests: `tests/platform/iap.test.ts` (free scope = 10 islands), `tests/sim/chapterTwoActivation.test.ts` (now follows the chapter order instead of a fixed 25-island index, so it survives i25).
- Browser QA used ONE Chromium, sequential, about 2 minutes per run. Load average was 2–6.
  - `python3 qa/withPreview.py --port=4397 node qa/chaptershots.mjs [--lang=tr --suffix=-tr] [--extra=&quality=high --suffix=-gl]`: chapter pages, locked, coming soon, title card, complete card, and the natural "finale just won" flow. Each shot checks that the chapter bar covers no island or name plank and that every node is on screen, and tests page turning with `]`, the ‹ arrow and a tab. Result: no problems.
  - `node qa/chapterstore.mjs`: starts its own vite dev server and stops it. It switches in a mobile platform and a mock store through the app's modules (`?iapmock=1` is not wired into the app), then checks the paid locks on Ch 2, the paid line on the fogged Ch 3 and the store card text. Result: no problems.
  - All preview/dev servers and browsers were stopped by the scripts.
- Screenshots in `docs/chapters-shots/` (1280x800 and 932x430 `pu-phone`):
  - Pages: `ch1-*`, `ch2-*`, `ch3-*` (`-gl` = WebGL water with the chapter tint), `ch3-locked-*`, `ch4-soon-*`.
  - Cards: `card-title-*`, `card-done-*`, `card-due-*` (the natural flow after the Ch 1 finale).
  - Store: `ch2-paid-*`, `ch3-locked-paid-*`, `store-lock-*`.
  - TR phone: `*-932x430-tr.png`.

## Open issues / notes
- **Owner check:** "Chapter 2 · 3/7" counts registered islands. With i25–i27 missing, Ch 2 shows x/7 and Ch 3 shows x/8. It becomes x/9 once they are registered.
- **Owner decision still open (plan #2):** whether chapters 4–5 are a free update. The "coming soon" copy makes no promise ("Its isles are still being charted.").
- `?iapmock=1` is documented in worldMap/main2d but never installs a mock store (`isIapMockEnabled` is unused). This was already the case before my change. I used `qa/chapterstore.mjs` instead.
- Older QA scripts that read `window.__map.islands()` or click `map2d-island-<id>` now only see the islands on the current chapter page. Use `?chapter=N` or `__map.showChapter(p)` first. `qa/mapshots.mjs` with `?mockislands=` puts the stand-ins on the last chapter page.
- The "seen" records for the unveil and star pop are still index-based (`skyhold2d_map_unlock_seen_v1`, `…_stars_seen_v1`). When i25/i26 land, at most one cosmetic unveil or star pop may replay once. Progress is not affected.
- The `map.hint` string ("Pick an island to set sail") no longer shows; the chapter bar took its place at the bottom. The key is still in the dictionaries.
- Hero unlock milestones count the frontier index. Inserting i25/i26 before i16 can unlock a hero one or two islands "earlier" for an existing save. Nothing is ever relocked.
- Not done here (other agents or later phases): the i25–i27 islands, wave retuning, chapter-specific bosses, and the "intro story panel" for each chapter beyond reusing the first island's painting.
