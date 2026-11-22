# Phone UI Overhaul Report (Skyhold Isles)

## 1. Phone UI Token System (`html.pu-phone`)
- **Detection**: `src/render2d/main2d.ts` toggles `html.pu-phone` from `!desktop` (`!isDesktopClient(q)`), reusing the existing phone render policy (`desktop=1|0` query + client heuristics). Desktop/MacBook clients never receive `.pu-phone` and remain untouched.
- **Tokens** (`src/render2d/ui/paintedUi.css` under `html.pu-phone .pu`):
  - Typography (respecting Settings → Interface Size `--ui-scale`, with minimum CSS px floors):
    - `--ui-font-caption`: `max(12px, calc(12px * var(--ui-scale, 1)))`
    - `--ui-font-body`: `max(14px, calc(14.5px * var(--ui-scale, 1)))`
    - `--ui-font-label`: `max(14px, calc(15px * var(--ui-scale, 1)))`
    - `--ui-font-btn`: `max(15px, calc(15.5px * var(--ui-scale, 1)))`
    - `--ui-font-btn-sm`: `max(14px, calc(14.5px * var(--ui-scale, 1)))`
    - `--ui-font-heading`: `max(16px, calc(17px * var(--ui-scale, 1)))`
    - `--ui-font-title`: `max(18px, calc(19.5px * var(--ui-scale, 1)))`
  - Touch targets & spacing:
    - `--ui-tap`: `max(44px, calc(46px * var(--ui-scale, 1)))`
    - `--ui-gap`: `max(8px, calc(9px * var(--ui-scale, 1)))`
    - `--ui-gap-lg`: `max(12px, calc(13px * var(--ui-scale, 1)))`
    - `--ui-icon`: `max(24px, calc(26px * var(--ui-scale, 1)))`
    - `--ui-pad`: `max(10px, calc(12px * var(--ui-scale, 1)))`
- **Applied across**: `paintedUi.css`, `titleScreen.css`, `heroBits.css`, `heroScreens.css`, `market.css`, `difficulty2d.css`, `credits2d.css`, `specCard2d.css`, `coach2d.css`, `enemyCard2d.css`, `newFoes2d.css`, `wavePreview2d.css`, `runControls2d.css`, `heroHud2d.css`, `itemBelt2d.css`, `featToast2d.css`, `laneMarks2d.css`, plus JS layout hooks in `hudDock.ts`, `buildRing.ts`, `worldMap.ts`, `heroScreens.ts`, `enemyCard2d.ts`, `newFoes2d.ts`, `wavePreview2d.ts`, `runControls2d.ts`.

## 2. Screens Requiring Layout Changes (Instead of Shrinking)
- **Hero Skill Tree (`heroScreens.ts`, `heroScreens.css`)**: Locked `--tz: 1` on phones (no shrinking below 48px medals / 14px text), picks horizontal (`across`) layout at `>= 780px` or vertical (`down`) at `< 780px`, lets `.pu-sheet-body` scroll cleanly, and keeps hero tabs and Reset button clear of the close seal.
- **Hero Select (`heroScreens.css`)**: Uses a compact horizontal roster strip at the top, scrollable 2-column portrait + skills body, and a pinned bottom action bar (`Skill tree` / `Sail with`) so actions are never cut off.
- **Island Briefing (`paintedUi.css`, `difficulty2d.css`)**: Full-height sheet with scrollable body, pinned difficulty + Set Sail footer bar, 14px difficulty plank spacing (clearing active `scale(1.04)`), and 1-column stack at `<= 740px`.
- **Daily Squall (`paintedUi.css`)**: Scrollable info grid with pinned Set Sail footer; 1-column stack at `<= 740px`.
- **Workshop, Logbook, Settings (`paintedUi.css`)**: Full-viewport sheets; Workshop switches to 2 columns at `<= 740px`; Logbook rows and Settings controls wrap cleanly at `667x375` (EN & TR).
- **Market & Belt Picker (`market.css`)**: 2-column card grids on phone with 44px+ socket/equip targets and safe top-edge badge offsets.
- **Codex (`paintedUi.css`)**: Enlarged 48px medallions, `grid-auto-rows: max-content` so multi-row foe grids scroll without overlapping labels, 14px+ detail card.
- **In-Game HUD & Transient Cards (`hudDock.ts`, `buildRing.ts`, `enemyCard2d.*`, `newFoes2d.*`, `wavePreview2d.*`, `coach2d.css`, `runControls2d.*`)**:
  - Bottom hero/ability/item tray enforces `>= 44px` buttons and `>= 8px` item gaps on phone/compact docks while preserving exact desktop `hudDock` values.
  - Enemy info, Next Wave, and New Foe cards expand their phone `dockCard` slot (`minScale = 0.99`) so text renders at 1:1 readable 14px+ instead of scaled down to ~7.5px.
  - Build ring canvas tooltip raises phone font floors (`16px` title, `14px` body/desc).
  - Pause menu dynamically clamps above the visible bottom tray (`.pu-hero-port` / `.pu-ab`) so buttons keep `>= 12px` clearance at `667x375`.
  - Coach marks narrow and shift slightly left at `<= 740px` to clear the Codex/Settings buttons.
  - World map title banner shrinks `--bw` on phones to stay clear of the enlarged top-right button row.

## 3. Audit Results: Before vs After (`qa/phoneUiAudit.mjs`)
204 runs: 34 screens × 3 phone viewports (`932x430`, `844x390`, `667x375`, dpr 3, `isMobile: true`, `hasTouch: true`, iPhone UA) × 2 languages (`en`, `tr`).

- **Before**: **5,046 violations** (`textUnder12: 2766`, `tightGap: 1079`, `bodyUnder14: 639`, `smallTarget: 500`, `smallIcon: 60`, `layout:overflow: 1`, `layout:overlap: 1`)
- **After**: **0 violations** across all 204 runs.

| Screen | Before | After |
|---|---:|---:|
| title | 40 | 0 |
| map | 92 | 0 |
| brief | 258 | 0 |
| brief-modes | 270 | 0 |
| brief-locked | 30 | 0 |
| workshop | 203 | 0 |
| herosel | 198 | 0 |
| heroes | 333 | 0 |
| heroes-node | 352 | 0 |
| logbook | 258 | 0 |
| logbook-feats | 152 | 0 |
| daily | 66 | 0 |
| market | 241 | 0 |
| beltpick | 258 | 0 |
| store* | 92 | 0 |
| settings-general | 120 | 0 |
| settings-audio | 90 | 0 |
| settings-graphics | 196 | 0 |
| settings-controls | 258 | 0 |
| credits | 157 | 0 |
| story | 36 | 0 |
| hud | 60 | 0 |
| hud-ring | 54 | 0 |
| hud-tower | 54 | 0 |
| hud-spec-card | 60 | 0 |
| hud-spec-hint | 81 | 0 |
| hud-foe | 78 | 0 |
| hud-coach | 84 | 0 |
| hud-newfoe | 108 | 0 |
| hud-codex | 388 | 0 |
| hud-codex-spec | 253 | 0 |
| hud-pause | 126 | 0 |
| end-won | 0 | 0 |
| end-lost | 0 | 0 |
| **Total** | **5,046** | **0** |

*\*Note on `store`*: `storeEnabled()` in `src/render2d/ui/store2d.ts` only activates inside a native Capacitor iOS/Android shell (`getPlatform().isMobile`). In browser preview, `?screen=store&iapmock=1` renders the world map; phone CSS tokens for `.pu-store*` are still applied in `src/render2d/ui/paintedUi.css`.

## 4. Desktop Regression Check (`1440x900` & `2000x991`, `desktop=1`)
Compared untouched base `HEAD` (`d7fb9b04`) against this branch across `map`, `hud`, `heroes`, and `workshop`:
- Static UI regions (HUD top bar, lives/gold plaque, wave banner, world map top bar): **0.0000% pixel diff** (0 changed pixels).
- Full-frame pixel diffs (`0.29%–4.13%`) occur exclusively in time-dependent canvas/CSS animations (water ripples, idle hero sway, pulsing skill-node glow). Visual side-by-side comparison confirms desktop layouts are unchanged.
