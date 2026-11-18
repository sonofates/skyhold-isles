# Handoff: UI round 3 (fixes + store / free-version scope). Branch `hermes/skyhold-ui3`

Base: `art-2d` (`9c2caa2`). UI only. Nothing changed in `game2d.ts`, the render layers, `src/platform/**`,
`src/sim/**`, `src/data/**`, `public/art2d/**` / the manifest, or `tools/**`.

## What was done

1. **The build ring no longer covers the Guide (Rehber) button.**
   - The Guide button is DOM over the Pixi canvas. A medallion under it could be neither seen nor tapped, and its
     caption sat on top of the tokens (plots 2–4 of `l1c` at every size, plot 23 on the phone).
   - `layoutRadial`, `towerRingAngles` and `placeTooltip` (`uiLayout.ts`) now take `avoid` rects.
     `dodgeRects()` moves the ring the shortest distance that clears them, without leaving the screen.
     The tooltip skips any spot that covers them.
   - The ring avoids the whole top-right HUD row: speed, pause, Guide and its caption.
     - `hudButtonsKeepOut()` estimates the row from the HUD layout and the caption CSS.
     - `codex2d.ts` also reports the button's real DOM box (button + caption) through `uiKit.addHudKeepOut()`.
       `BuildRing` combines both.
   - `game2d.ts` was not touched. The ring reads the rects itself.
   - `qa/ringprobe.mjs` opens the build ring and the tooltip on every plot at 1366×768, 1600×900, 1920×1080,
     2560×1080 and 844×390. It checks them against Guide, its caption, pause and speed.
     - Before the fix: 16 overlaps on `l1c`.
     - After: 0 of 240 checks on `l1c`, 0 of 720 on `i02, i07, i12`.
2. **Settings: sound is live.**
   - The dimmed "no sound in the painted isles yet" rows and their mute glyph are gone.
   - The rows are now Sound (on/off), Volume (master) and a new **Music** slider. Music uses
     `audio/musicPrefs.setMusicVolume`, which the `SoundManager` already listens to.
   - Volume and Music dim while Sound is off.
   - New EN+TR copy: `set.volumeNote`, `set.soundNote`, `set.music*`.
   - The mixer (`audio2d.ts`) re-syncs on every click / key / slider drag. QA confirms that the saved values reach
     the run's mixer (`__p0.state().settings.audio`).
3. **Free-version scope + store card (mobile only).** The new file is `ui/store2d.ts`.
   - `storeEnabled()` is true on native mobile (`platform.isMobile`), and with `?iapmock=1` in a desktop browser
     (QA, same rule as `p5-mobile.md`). It is never true on Steam or on plain web, where every island stays
     playable and nothing store-related is drawn.
   - `canPlayIsland()` uses `isUnlocked(id, iap.entitlements())`.
   - **World map:** islands past `FREE_ISLANDS` wear a "full adventure" lock. It is a gold-banded chest seal
     (new `chest` glyph in `paintedIcons.ts`) over a warm sepia island, plus a red forked ribbon reading
     "Full adventure" / "Tam macera". This is distinct from the grey padlock of an island not yet reached.
     Tapping one, or pressing Enter on it, opens the store card instead of the briefing.
   - **Store card (painted ribbon board):**
     - An intro line ("{island} is part of the full adventure. The first 6 isles are free…").
     - One parchment card per catalogue product, full adventure first. Each card shows the **name and price from
       the adapter** (`products()`), a short blurb, and **Buy**. Owned items show a crown "Owned" / "Sende".
     - Below the cards: **Restore purchases** and a status line for thanks / cancelled / unavailable / error /
       restored / nothing to restore.
     - "Loading" and "store did not answer + Try again" states.
     - A purchase or restore refreshes the map, so the locks drop.
   - **Settings** gets a "Full adventure → Store" row on mobile scope, so Restore stays reachable after a purchase.
   - **Routing (`main2d.ts`):** a run into an island past the scope goes to the map with that island's store
     card open (`?store=<id>`, keeps `?iapmock=1`). This covers a deep link, a Daily Squall on a paid island, or
     End-panel "Next Isle". Debug / QA scenes are not gated.
4. **Screenshots** in `docs/ui3-shots/`: 100 JPEGs, TR + EN × 5 sizes × 10 screens. The screens are the ring
   beside Guide, Settings, Settings muted, Settings with the store row, the web map, the map with scope, the store,
   the store after Buy, the deep-link store, and the map once owned.
   - All were looked at.
   - Fixed after looking: the store intro ran under the ribbon tails on desktop, and Settings' "Dil/Language" label
     touched the gold corner bracket now that the board is taller.

## Files

- New: `src/render2d/ui/store2d.ts`, `tests/render/store2d.test.ts` (5 tests), `qa/ringprobe.mjs`,
  `qa/ui3shots.mjs`, `docs/ui3-shots/*.jpg`, this file.
- Changed: `uiLayout.ts`, `uiKit.ts`, `buildRing.ts`, `codex2d.ts`, `main2d.ts`, `ui/worldMap.ts`,
  `ui/metaScreens.ts`, `ui/paintedIcons.ts`, `ui/paintedUi.css`, `i18n/en.ts`, `i18n/tr.ts`,
  `tests/render/uiLayout2d.test.ts` (+4 tests).

## Gate

- `npx tsc --noEmit` ✓
- `npm run lint` ✓
- `npm test`: **83 files passed (1 skipped), 1075 passed / 11 skipped**
- `npm run sim:balance`: **PASSED, 33 levels**
- `npm run build` ✓

## QA (against `vite preview`)

- `node qa/ui3shots.mjs`: **no problems**. It runs the layout checks (overflow, off-screen, settings rows, store
  cards, English left on TR screens) plus **35 flow checks**:
  - web: no store row, no locks, a paid island plays;
  - sound settings save, survive a reload and reach the mixer;
  - mock scope, desktop and phone: 11 islands locked; the store opens instead of the briefing; 3 products with
    adapter prices; Buy drops every lock; Restore brings the unlock back; `?level=i09` goes to the store; a free
    island plays.
- `node qa/ringprobe.mjs`: no overlaps (see above).
- `node qa/p3flow.mjs`: all checks pass.
- `node qa/l10nshots.mjs` (TR, output to the ignored `qa-out/`): no layout problems; 6/6 language-flow checks.
- Playwright is not in package.json: `npm install --no-save playwright`.

## Doubts / open questions for the owner

- **Mock product names are the adapter's placeholders.** The mock shows "[Mock] full_unlock", English
  "Placeholder store entry…" descriptions and the price "MOCK", even on Turkish screens.
  - This follows the brief (names and prices come from the adapter). On a phone they will be the store-localised
    titles and prices.
  - Only the full adventure's blurb is ours (EN+TR); the other two show the store's description.
  - The TR "no English" check skips the product names and those adapter descriptions.
- **`remove_ads` is listed**, because the catalogue lists it, but the game has no ads. Decide whether to drop it from
  `iapProducts.ts`. It would then vanish from the card with no UI change.
- **Daily Squall / Endless on paid islands:** a Daily that picks a paid island currently leads to the store card
  when the player sets sail. A Daily that sticks to free isles on the free version is a data / platform decision.
- **Guide button vs ring:** the ring now keeps clear of the whole top-right button row, so a ring for a top-right
  plot sits a little lower than its plot. Hiding the Guide button while the ring is open was the alternative.
- **Painted UI art:** the chest seal, the ribbon, the price plaque and the store icons are SVG/CSS in the kit style.
  When the Codex art run delivers painted pieces, the swap points are `ICONS.chest` and `.pu-node-ribbon` /
  `.pu-store-price` in `paintedUi.css`.
- **The Turkish copy has not had a native-speaker review.** It follows the glossary in `tr.ts`; "Tam macera" is new.
- The `mute` glyph in `paintedIcons.ts` is no longer used by Settings. It was kept in case it is needed elsewhere.
