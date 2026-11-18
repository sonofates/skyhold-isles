# Handoff: P6, TR/EN localisation of the 2D game (UI only). Branch `hermes/skyhold-l10n`

Base: `art-2d` (`854d34a`). UI only. Nothing changed in `src/data`, `src/sim`, `src/core`, `src/platform`,
`desktop`, `mobile`, `game2d.ts` or the render layers.

## What was built

1. **`src/i18n/`: a small typed i18n module**
   - `index.ts`: `t(key, params?)`, `tIn(locale, …)`, `{param}` interpolation, plurals `{ one, other }` chosen by
     `params.n` with `Intl.PluralRules` (EN: 1 → one; TR keeps the noun singular after a number, so most TR
     plurals are plain strings), `upper()` / `lower()` with the TR İ/ı rules, `num()` (TR `0,52`),
     `pct()` (TR `%12`), `shortDate()` (TR `18 Kas`), `LANGUAGE_NAMES` (each language in its own name).
   - Locale: module state, `'en'` until `initLocale()` runs, so tests and node scripts always get English.
     `initLocale()` is called first thing in `main2d.ts` and checks, in order: `?lang=en|tr` (QA), the stored
     setting, then `navigator.language` (`tr*` → tr, else en). `setLocale()` also sets `<html lang>`, so the
     CSS `text-transform: uppercase` follows the TR rules ("SAVAŞTAN ÖNCE").
   - `en.ts` is the source (247 keys, grouped by screen). `tr.ts` is typed `{ [K in MsgKey]: Msg }`, so a
     missing or extra key does not compile. A glossary at the top of the file keeps the terms consistent.
   - `data.ts` + `dataTr.ts`: data-table text looked up by **data id** (islands, towers + short names + role
     lines + signatures + codex lore, enemies + counters, codex tags, challenges, workshop branches/upgrades/
     ranks, Endless medal tiers, feats; 100 entries). In English, or when an id is missing from `DATA_TR`,
     every lookup returns the English text from `src/data` (tested).
   - `localeSetting.ts`: a **thin wrapper** for storing the language next to the shared settings.
     `src/platform/storage.ts` is not in my file list, and its `loadSettings()` rebuilds the object field by
     field, so a `language` field would be lost on the next `saveSettings()`. The wrapper writes `language` into
     the same `skyhold_isles_settings_v1` JSON (older code ignores it, so it is backward compatible) and also
     into its own key `skyhold_isles_language_v1`. After a save, the 2D Settings sheet calls
     `reapplyLocaleSetting()` to put the field back. QA checks that the field survives a settings save.
2. **Every user-visible string of the 2D game now goes through `t()` or the data lookups.** That covers the
   world map (title, top-bar captions, hint, pan arrows, node aria, compass "N" → "K"), the briefing card,
   the mode notes (`modeBits.ts`), the story panels (the l1c placeholder beats are dictionary keys now), the
   Workshop, Logbook, Daily Squall and Settings screens, the HUD (wave banner, horn "Start!", the
   Paused / Tap-the-road plate), the build ring and its tooltip (stat labels, role lines, hints, targeting),
   the end panel, the Codex, the boot line, the page title and the error lines.
   - `game2d.ts` (not mine) still sets `HudState.banner` to `'Paused'` / `'Tap the road'`. `hud.ts` treats
     those as ids, maps them to keys and fits the plate to the screen.
3. **Settings → Language**: two planks, "English" and "Türkçe". Picking one stores the choice and reloads the map
   with Settings open. A reload is simpler and safer than rebuilding every screen in place.
4. **Codex**: the 2D page used to mount the 3D build's DOM codex (`src/ui/content/codexScreen.ts`, not my
   file). That codex has English baked in and uses the 3D slate look. It is replaced on `2d.html` by a
   **painted Codex sheet** (`ui/codexSheet.ts`). It has a ribbon board, Foes / Towers plank tabs, a grid of
   medallion tiles with the painted sprites, and the entry on a parchment card: stats, "How to stop it",
   Strong at / Watch out, the tier lines with costs, and the tier-III signature. Numbers still come from
   `codexData.ts` / `src/data`. The testids (`codex`, `codex-close`, `codex-tab-*`, `codex-tile-*`) are kept,
   so `p1shots` / `p3flow` still work. The 3D build's codex is untouched.
5. **Fredoka latin-ext**: `main2d.ts` now loads the font with a Turkish sample string (`ğşıİçöü…`), so the
   latin-ext subset is fetched before Pixi draws any canvas text and Turkish letters never fall back to
   another font.
6. **Overflow fixes found in the TR shots**:
   - The desktop top-bar captions ran into each other: the button caption is now "Defter" and the sheet title
     stays "Seyir Defteri" (`map.logbookShort`).
   - Volume showed `65%`; TR now shows `%65`. Codex decimals use a comma in TR.
   - The Codex count sat under the ribbon tail and the corner bracket, so it moved to the foot of the tile
     column.
   - The new Language row sat under the ribbon tail and the corner bracket on desktop and phone. It now has
     body top padding on big boards and an indent for the first row.
   - The HUD centre plate and its sub line are fitted to 80% of the screen width.

## Files

- New: `src/i18n/{index,en,tr,data,dataTr,localeSetting}.ts`, `src/render2d/ui/codexSheet.ts`,
  `tests/i18n/coverage.test.ts` (13 tests), `qa/l10nshots.mjs`, `docs/l10n-shots/*.jpg` (70 files),
  this file.
- Changed: `ui/{worldMap,briefing,metaScreens,modeBits,storyPanels,storyBeats,dom,seaPainter,paintedUi.css}`,
  `hud.ts`, `buildRing.ts`, `endPanel.ts`, `codex2d.ts`, `uiLayout.ts` (stat labels; `ROLE_LINES` moved to
  `i18n/data.ts`), `main2d.ts` (locale boot, font preload, error lines).

## Tests / gate

- `tests/i18n/coverage.test.ts`:
  - EN ⇄ TR key sets are equal, TR is non-empty, and each TR message uses the same `{params}` as EN.
  - Plurals carry `{n}`, and no TR sentence is a copy of the English.
  - `t()`, plurals, `upper`/`lower` for İ/ı, and `localeFromTag` behave as intended.
  - `DATA_TR` covers every data id (levels, towers, enemies, challenges, branches, upgrades with the same
    rank count, tiers, feats, every codex tag) and has no stale ids. The English fallback is checked.
  - **Hardcoded-English lint**: scans every `.ts` under `src/render2d/ui/` plus hud, buildRing, endPanel,
    codex2d, uiKit, uiLayout and main2d for string literals that read like English. Code literals (class
    lists, testids, CSS values, i18n keys, key names, console tags) are allowed. A line can opt out with
    `// i18n-ignore` (used 4 times: the QA mock island names, the HUD banner ids, a font-probe string).
- Gate: `npx tsc --noEmit` ✓ · `npm run lint` ✓ · `npm test`: **79 files passed (1 skipped), 1045 passed / 11
  skipped** · `npm run sim:balance`: **PASSED, 33 levels** · `npm run build` ✓.
- QA, against `vite preview`:
  - `node qa/l10nshots.mjs --base=<url>`: 35 screens × phone 844×390 (touch, DPR 2) + desktop 1600×900, in
    Turkish set the way a player sets it. It checks painted elements outside the viewport (map nodes against
    the sea), overflowing plank/tag/ribbon/caption text, overlapping top-bar captions and nodes, English words
    in visible DOM text / aria-label / title, English in the HUD wave banner and the end-panel note (canvas
    text, via the QA hooks), console errors, and a **language-switch flow** (6 checks: tr-TR browser starts
    in Turkish, `<html lang>`, switch to English, the field survives a settings save, survives a reload, and
    switches back). Result: **no problems, 6/6 flow checks**. `--lang=en` runs the same set in English.
  - `node qa/p3flow.mjs`: **all 34 checks pass** (the English flow is unchanged).
  - Every TR shot has been looked at by eye.
- Playwright is not in package.json: `npm install --no-save playwright`.

## Doubts / open questions for the owner

- **Turkish copy is mine and has not had a native-speaker review.** The glossary is in `tr.ts`. Choices you may
  want to change:
  - Codex → "Rehber"
  - Daily Squall → "Günün Fırtınası"
  - Mastered → "Taçlandı" (fits the crown glyph)
  - Campaign → "Sefer"
  - Boss → "Elebaşı"
  - Endless Run → "Sonsuz Akın"
  - World Map button → "Harita"
- **Place names are translated** (Meadow Crossing → Çayır Geçidi …). "Skyhold" stays a name. Say if island names
  should stay English as brand names; that is a one-line change in `data.ts` (`islandName`).
- **`storage.ts` should get a real `language` field.** The wrapper works, but the 3D settings modal will drop the
  field from the settings JSON when it saves. The sidecar key keeps the choice, so nothing is lost, but the
  clean fix is ~3 lines in `loadSettings()` (not my file).
- **3D-only text in TR codex lore**: "Press R to see the sky lane" and the ability names (Meteor, Aşırı Şarj)
  are translated as written in `codexData.ts`, but 2D has neither the R key nor ability buttons.
- **Dev/QA-only English is left on purpose**: the `?mockislands` stand-in names, console warnings in
  `modes2d.ts` and the `2d.html` static "Loading…" (replaced by JS on start).
- **Existing, not localisation**: on desktop the build ring around plot 3 covers the Codex button's caption. It
  was the same before this change.
- The Codex treats every entry as met (the old 2D codex did too: `isSeen: () => true`). A sighting log for 2D
  would plug into `CodexSheetOptions.isSeen`.
