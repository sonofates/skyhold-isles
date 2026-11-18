# Handoff: UI round 4, hooking up the painted art. Branch `hermes/skyhold-ui4-art`

Base: `art-2d` at `be7001d` (the Codex painted-UI merge). This round changed the UI only. Nothing changed in
`game2d.ts`, the render layers, `src/sim/**`, `src/data/**`, `src/platform/**`, `public/art2d/**` or the manifest,
or `tools/**`.

## What was done (task list from `handoff-codex-art-ui.md`)

1. **Voyage route** (`ui/worldMap.ts`, `ui/mapLayout.ts`)
   - The SVG dotted strokes are gone. The route is now built from `route-dash` images placed along the same
     Catmull-Rom curve as before, plus one `route-anchor` halfway along each leg that has room for one.
   - New pure function `routeMarks(pts, step, clear, anchorClear)`. It samples the curve by arc length, keeps
     marks clear of the island medallions and spaces the dashes evenly on each leg.
   - The route covers all 17 islands. It sits inside the scrolling sea, so it pans with phone touch, the mouse
     drag, the wheel and the edge arrows.
   - Legs already sailed (up to the frontier) are full colour with a soft shadow. The legs ahead are faded to 55 %.
   - Both pieces are 32 px paintings, so they are capped at 28 css px.
2. **Story** (`ui/storyBeats.ts`, `ui/storyPanels.ts`, `i18n/en.ts`, `i18n/tr.ts`)
   - `StoryBeat` gains an optional `portrait`, which level data can also supply.
   - The caption shows `portrait-pell` to the left of the speaker's name and line. All of Meadow Crossing's
     beats use it.
   - Islands i01–i16 now have one intro beat and one outro beat each, using `story-<id>-intro-1` /
     `story-<id>-outro-1`, narrated by Warden Pell.
   - The captions are neutral and built from the island's own localised name and subtitle:
     - intro: "Next stop: {name}. {subtitle}." / "Sıradaki durak: {name}. {subtitle}."
     - outro: "{name} is safe again. I will mark it on the chart, and we sail on." / TR equivalent.
     - Keys: `story.generic.intro|introShort|outro`, plus `story.pell` (this replaces `story.l1c.speaker`).
   - **Where real copy goes:** a `story` on the island's level data, or an entry in `PLACEHOLDER_STORY`. Either
     one overrides the generic beat. The list of islands is `GENERIC_STORY_ISLANDS`. Both are in `storyBeats.ts`,
     and the docblock there explains this.
   - A single-beat story is laid out as a book spread: the painting on the left page, Pell and the caption on
     the right. The earlier version had a single stacked card, and it overflowed the phone book (the buttons
     were clipped).
   - Side effect: the first play and the first win of i01–i16 now show the storybook, which follows the
     existing "story once" rule.
3. **Workshop / Settings / Briefing** (`ui/dom.ts`, `ui/metaScreens.ts`, `ui/briefing.ts`, CSS)
   - Rank pips are `<img>` `pip-empty` / `pip-filled`. The `aria-label` stays on `.pu-pips`.
   - The difficulty is shown as `gem-<difficulty>` in front of its name. The CSS diamond and the `GEM` colour
     table are gone.
   - `toggle()` now holds both `toggle-off` and `toggle-on`, cross-faded by `aria-checked`. Both images are in
     the DOM, so a switch never flashes while an image loads.
   - Role, `aria-checked`, `aria-label`, test ids and behaviour are unchanged (QA checks the name and state).
4. **Logbook / Daily / Briefing seals**
   - `seal()` (feats and Logbook totals) and `ruleSeal()` (challenges, used by the Logbook, Daily and briefing)
     now use `seal-<feat icon>` / `seal-<challenge ID>` through the new `sealBadge()`.
   - The briefing's Endless switch uses `seal-endless`.
   - `.pu-round.pu-seal` drops the wooden button backing, since each seal is painted with its own.
5. **End panel** (`endPanel.ts`, `uiKit.ts`)
   - Next Isle and World Map are now texture-backed `Sprite`s using `icon-play` / `icon-map`. They are loaded
     with mipmaps through the new `paintedUiTexture()`, at 56 % of the medallion like the DOM buttons.
   - The Graphics glyph stays as a fallback until the texture loads, or if it fails to load.
   - **Retry keeps its Graphics glyph:** the kit has no painted retry icon.
   - `debug()` now reports `painted: EndAction[]` (QA).
6. **Store card**
   - The price uses the kit's painted `price-tag.webp`. It is 9-sliced (26/30/26/92), so the gold socket stays
     round and nothing stretches vertically. The socket holds the kit coin.
   - Product seals (`seal-islands`, `seal-medal`) drop the wooden button.
   - **The chest and the red "Full adventure" ribbon are still SVG/CSS.** Nothing in the kit fits (see below).
7. **Other placeholders that had a painted equivalent**
   - Inline glyphs `crown`, `medal`, `trophy`, `islands`, `endless` → their wax seals. These cover the briefing
     records, the mastered crown on the map, the Codex notes, the store and the Logbook's Endless column.
   - `heart` → `icon-heart.webp`.
   - Map pan arrows → `icon-play` (mirrored for west).
   - Build-ring tooltip stat pips (Pixi `Graphics`) → `pip-empty` / `pip-filled` sprites. The next tier's gain is
     the filled pip tinted green. The Graphics dots remain as a fallback until the textures load.
   - The unused `mute` SVG glyph was removed.
8. **Screenshots:** `docs/ui4-shots/`, 108 JPEGs = 18 screens × EN/TR × 844x390 (DPR 2, touch), 1600x900 and
   2560x1080. I looked at them. These were fixed after looking:
   - The route was too sparse and its anchors were hidden under the shores. I tightened the spacing and the
     clearance.
   - The single-beat story overflowed on the phone. It is now the spread layout.
   - The main store card wrapped price/Buy onto two rows on the phone. The tag and the button are smaller on
     short screens.
   - The Pixi loaders found no `paintedUi` because the parsed manifest drops it (see doubts). They now fall back
     to `ui/<key>.webp`.

## Files

- New:
  - `qa/ui4shots.mjs` (screenshots plus checks)
  - `tests/render/ui4Art.test.ts` (10 tests)
  - `docs/ui4-shots/*.jpg`
  - this file
- Changed:
  - Map and story: `src/render2d/ui/worldMap.ts`, `mapLayout.ts`, `storyBeats.ts`, `storyPanels.ts`
  - Meta screens and store: `dom.ts`, `paintedIcons.ts`, `metaScreens.ts`, `briefing.ts`, `codexSheet.ts`,
    `store2d.ts`, `paintedUi.css`
  - Pixi UI: `src/render2d/endPanel.ts`, `buildRing.ts`, `uiKit.ts`
  - Copy: `src/i18n/en.ts`, `src/i18n/tr.ts`

## Gate (Node 22.23)

| Check | Result |
| --- | --- |
| `npx tsc --noEmit` | passed |
| `npm run lint` | passed |
| `npm test` | **84 files passed (1 skipped); 1090 passed / 11 skipped** |
| `npm run sim:balance` | **PASSED, 33 levels** (Greedy and Weak) |
| `npm run build` | passed (only Vite's usual chunk-size advisory) |

## QA against `vite preview` (Chromium, swiftshader)

- `node qa/ui4shots.mjs`: **no problems**. Its checks:
  - Nothing off-screen and no text overflow.
  - Every `<img>` loaded, and none is drawn more than 1.35× its pixels.
  - No CSS pip left; every toggle has both paintings; every seal is painted.
  - The route has at least 30 dashes and at least one anchor.
  - Story panels show their painting and Pell's portrait.
  - The end panel's Map and Next buttons use their painted textures.
  - No English left on TR screens.
  - No page errors and no HTTP ≥ 400.
- `node qa/ui3shots.mjs flow`: **no problems** (store and settings flows, prices unchanged as `MOCK`).
- `node qa/ringprobe.mjs`: 240 checks, no ring / HUD overlaps.
- `node qa/p3flow.mjs`: all checks pass **except "painted Codex button is shown in game"**.
  - That check waits a fixed 2.5 s after the replay URL changes. On this shared server the game boots in
    2.0–3.2 s, so the check races the boot.
  - I measured the boot with and without this round's texture loading and got the same times (2032–3219 ms vs
    2037–3138 ms). This is a timing flake in the script, not a regression.
  - The Codex button does show, and `ui4shots` clicks it.
- Playwright is not in `package.json`: `npm install --no-save playwright`. The preview server was stopped.

## Missing art (exact needs)

| Need | Size | Replaces | Plugs in |
| --- | --- | --- | --- |
| Treasure-chest seal for the "full adventure" lock and store item (same wax-seal family as `seal-*`) | 192×192 | `ICONS.chest` (SVG) | `.pu-node-chest`, `PRODUCT_ICON.full_unlock` in `store2d.ts` |
| Red cloth ribbon with forked tails at both ends, 9-sliceable (the `tab-*` ribbons have a pole and are teal) | ~320×80 | CSS gradient + clip-path `.pu-node-ribbon` | map paid nodes |
| Retry icon (circular arrow) in the painted icon style | 224×224 | Graphics glyph in `EndPanel.drawGlyph` | end panel Retry |
| Pause and speed (1×/2×/3×) icons | 224×224 | Graphics glyphs in `hud.ts` | in-game HUD buttons |
| Endless-wave glyph (the brief's "N waves" record) | 96×96 | `ICONS.wave` (SVG) | briefing |
| `route-dash` / `route-anchor` at 2× | 64×32 / 64×64 | the 32 px pieces | route at DPR 2+ (now up to ~1.75× upscaled on the phone, still soft but readable) |

## Doubts / open questions for the owner

- **Pell narrates every placeholder island beat.** The Codex art handoff asked whether Pell stays the narrator
  or local speakers take over. The generic beats follow the first option, and the content owner can switch
  per island in data.
- **The generic captions show on first play and first win of every island.** If the stories should stay
  quiet until real copy exists, empty `GENERIC_STORY_ISLANDS`.
- **The parsed art manifest drops `paintedUi`.** `manifest.ts` (not mine) keeps only known keys. The DOM reads
  the raw JSON, and the Pixi loaders fall back to `ui/<key>.webp`. Adding `paintedUi` to `ArtManifest` would
  let `paintedUiTexture()` use the index; the fallback then stays harmless.
- **Ring-tooltip "gain" pips** (upgrade preview) use a green tint over the gold pip. The build tooltip
  (no gains) was screenshotted; the upgrade tooltip with gains was not.
- **The coin in the price-tag socket** is the in-game gold pouch next to a real-money price. A chest or a crown
  could go there instead once a chest seal exists.
- **The Turkish generic lines have not had a native-speaker review** (`story.generic.*`).
- `routePath()` is no longer used by the map. It is kept, and tested, for anything that still wants an SVG
  stroke.
