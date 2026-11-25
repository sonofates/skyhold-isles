# Handoff — PC (Steam) release readiness (Task H)

Branch `hermes/sky-pc-ready` (base `art-2d` @ a4c2c8a8). Owner decision 2026-11-25: mobile is free,
the Electron/Steam build is the paid product. This pass makes the 2D client behave like a PC game
and hardens the shell. No island / level / chapter data, enemies, balance or store code touched
(store code only stays hidden — it already was, see §5).

## 1. Audit — what existed, what was missing

| Area | Before | Now |
|---|---|---|
| Hotkeys | Space pause, 1/2/3 speed, N wave, Q/W abilities, E/R hero skills, H hero, Z/X/C items, Esc, arrows + Enter pad cursor, Shift+arrows pan — all hard-coded | Same defaults, **13 battle actions rebindable** in Settings → Controls (click a cap, press a key; a used key swaps; Reset keys). Persisted (`skyhold_isles_keys_v1`). HUD key badges, tooltips and gamepad follow live |
| Right click | Cancelled ability / hero aim, ordered hero moves | Also **closes the build ring and the foe card** (PC "cancel") |
| Wheel / drag pan | Already on battle map and world map | unchanged |
| Hover tooltips | HUD canvas buttons, abilities, hero, belt (desktop) | unchanged (tip key names now show the bound key; Space reads "Space") |
| Touch-only affordances | Haptics row in Settings on PC | Haptics row only on touch devices; Mouse help says "Mouse wheel or two-finger scroll" |
| Pause on focus loss | Only when `!isTouchDevice()` (a touchscreen laptop never paused) | Always in the desktop shell (`src/render2d/pausePolicy.ts`) |
| Steam overlay pause | Wired to a `GameOverlayActivated` callback that steamworks.js 0.4 does not expose → never fired | Kept (fires once the lib exposes it) **plus** Shift+Tab with Steam running pauses the run |
| Settings | Language, UI scale 90–130 %, quality, render resolution, effects, FPS cap 30/60/∞, FPS counter, reduced motion, shake, browser fullscreen, master + music volume | **+ Effects (SFX) volume** (own bus, music unaffected), **FPS cap 120 / 144**, **Display mode Windowed / Fullscreen** and **VSync** (shell only; vsync applies after restart), PC default UI scale from display height (1200p → 110 %, 1440p+ → 130 %; first launch only) |
| Esc menu | Battle: Esc → pause menu (Resume / Restart / Settings / World Map) | + **Quit game** (shell only, asks first). World map: **Esc opens a Menu board** (Resume / Settings / Quit game). Title: **Quit game** plank (shell only) |
| Electron window | Fixed 1440x810, min 960x540, default menu (reload / DevTools / zoom accelerators), DevTools in production, no state memory | Window **size / position / maximised / fullscreen persisted** (`<userData>/window-state.json`, repaired against current monitors), first launch fullscreen (16:9 window behind it), min 960x540, **F11 and Alt+Enter** toggle fullscreen, **no menu** (Win/Linux; minimal app menu on macOS), **DevTools off when packaged** (`SKYHOLD_DEVTOOLS=1` for a dev checkout), reload / print / zoom / view-source shortcuts blocked, Ctrl+wheel zoom reset, `show` on `ready-to-show`, title pinned |
| Crash / console safety | none | Renderer crash → reload (≤3/min) then a message box; startup failure → message box; main-process errors and crashes logged to `<userData>/logs/shell.log` (256 KB cap) |
| Security | contextIsolation, sandbox, no nodeIntegration, offline protocol, origin-checked IPC | + `webviewTag:false`, `navigateOnDragDrop:false`, `will-attach-webview` denied, window.open denied app-wide, IPC channel **allow-list** (`desktop/shellCore.cjs` `IPC_CHANNELS`, test keeps preload/main in sync, every handler origin-checks) |
| Steam | 58 achievements 1:1 with json, cloud merge, overlay enable | **65** achievements (7 proposed for ch4/ch5, §4), **rich presence** `status` ("Charting the sky islands" / "Defending <island>" / "In the main menu"); all no-ops without Steam |

## 2. Files

- `desktop/shellCore.cjs` (new): pure shell policy — window state, shell prefs (vsync), key policy, DevTools gate, presence text, origin / path / ID sanitising, IPC allow-list. Added to `electron-builder.json` files.
- `desktop/main.cjs`: rewritten around shellCore (same protocol handler, Steam init, cloud IPC); new IPC `desktop:get-state`, `desktop:set-window-mode`, `desktop:set-vsync`, `desktop:quit`, `steam:set-presence`. Smoke probe now counts islands across chapter pages (`__map.chapters()`; the old `islands() >= 25` broke when the map became one page per chapter) and checks `window.skyholdDesktop`.
- `desktop/preload.cjs`: + `skyholdSteam.setPresence`, new `window.skyholdDesktop` bridge.
- `src/platform/desktopShell.ts` (new): renderer wrapper (`isDesktopShell`, `quitGame`, `setPresence`, window mode, vsync).
- `src/render2d/ui/keyBindings.ts` (new), `abilities2d.ts` / `heroKeys.ts` (live getters), `abilityBar2d.ts`, `heroHud2d.ts`, `itemBelt2d.ts`, `marketModel.ts` (`itemKeys()`), `padCursor.ts`, `padBadges.ts` (`keyName`), `game2d.ts` (bound actions, right-click cancel, blur / overlay pause).
- `src/render2d/pausePolicy.ts` (new), `src/render2d/ui/gameMenu2d.ts` (new: map Esc menu + `confirmQuit`), `runControls2d.ts` (Quit plank), `titleScreen.ts` (Quit plank), `worldMap.ts` (Esc menu, presence), `main2d.ts` (Quit wiring, presence).
- `src/render2d/ui/metaScreens.ts` (Settings rows), `graphicsSettings.ts` (FPS caps, `autoUiScale`), `paintedUi.css` (rebind caps), `src/audio/musicPrefs.ts` + `soundManager.ts` (SFX bus), `src/render2d/renderResolution.ts` (`isDesktopClient` true in the shell), `src/i18n/en.ts` + `tr.ts` (21 new keys, 2 reworded).
- `src/platform/achievements.ts`, `desktop/achievements.json` (regenerated), `scripts/exportAchievements.ts` + `npm run steam:achievements`; `npm run desktop:smoke` (existing `scripts/qaDesktopSmoke.ts`).
- Tests: `tests/render/pcControls.test.ts`, `tests/platform/desktopShell.test.ts` (new); `steamAdapter.test.ts` (count 58 → 65), `n2Ui.test.ts` (pad X now sends the bound `N`).
- QA: `qa/pcshots.mjs`, shots in `docs/pc-shots/`.

## 3. Verification

- Unit: settings persistence (FPS caps, UI scale, reduced motion, SFX volume, broken storage), key bindings (normalise, swap, persist, repair, live HUD constants, belt / pad), pause-on-blur + overlay hotkey, shell policy (window state incl. unplugged monitor, vsync switches, F11/Alt+Enter/DevTools/blocked keys, App ID, sanitisers, presence, IPC allow-list ↔ preload ↔ main, hardening strings, owner-gated identity unchanged), ch4/ch5 achievements by island id.
- Browser QA, ONE Chromium, `python3 qa/withPreview.py --port=4417 node qa/pcshots.mjs --sizes=…` at **1920x1080, 1280x720, 2560x1440, 1680x1050 (16:10)**, shell simulated by a fake `window.skyholdDesktop`: title menu (+Quit → confirm → shell quit), world map, Esc menu, Settings × 4 tabs (no haptics, no store text, SFX slider, Display mode + VSync reach the shell, 144 cap, rebind Meteor→B persisted then Reset, Esc closes), battle HUD, ring open → right click closes, Esc → pause menu with Quit, Resume, blur pauses, Space resumes, a rebound P pauses. **0 problems** at all four sizes. Smallest Settings text: 14 px at 720p, ~20 px at 1080p, ~26 px at 1440p (auto 130 %).
- Electron / AppImage: see §6 (filled in after the run).
- Gate: see §6.

## 4. Achievements proposed for Chapters 4 / 5 (owner-gated IDs)

Appended after the existing 58 (no index or ID moved), same pattern as Chapter 3:

| ID | Name | Description |
|---|---|---|
| `CHAPTER_FOUR_LANDING` | First Thaw | Clear your first Chapter 4 island |
| `CHAPTER_FOUR_CLEARED` | Frostveil Charted | Clear all 9 Chapter 4 islands |
| `CHAPTER_FOUR_THREE_STARS` | Rime and Radiance | Earn 3 stars on every Chapter 4 island |
| `BOSS_I36_CLEARED` | Warden of the Ice Gate | Defeat the Glacier Warden and clear the last Frostveil island |
| `CHAPTER_FIVE_LANDING` | Into the Dusk | Clear your first Chapter 5 island |
| `CHAPTER_FIVE_CLEARED` | Eclipse Skies Charted | Clear all 9 Chapter 5 islands |
| `CHAPTER_FIVE_THREE_STARS` | Light Beyond the Eclipse | Earn 3 stars on every Chapter 5 island |

Chapter 5 "cleared / three stars" need every island `CHAPTERS.ch5.islands` lists (i37–i45) to exist, so they cannot unlock while i40–i45 are being authored. Not added (proposal only): `BOSS_I45_CLEARED` (Eclipse Sovereign, once i45 exists), `HARD_BOSS_I36`. If the owner renames or drops any of the 7 before publishing in Steamworks, edit `lateChapterAchievements` and run `npm run steam:achievements`. Achievement icons (256² colour + grey) still needed for all 65.

## 5. Mobile / free leftovers on desktop and web

Store, "full adventure" ribbons, crystal packs and Restore purchases are all behind `storeEnabled()` / `crystalStoreEnabled()` (mobile native + `MOBILE_STORE_LIVE`), so none render on desktop or web. QA scans the map and Settings text for store wording at every size: none found. No store code changed.

## 6. Packaging, smoke and gate results

(see below)

## 7. Open — needs the owner

- **Steam App ID**: still the public test ID 480 (`DEFAULT_STEAM_APP_ID` in `desktop/shellCore.cjs`, or `STEAM_APP_ID`); store page, capsules, screenshots, trailer, content survey (AI disclosure draft in `docs/p4-steam.md`), **pricing** (~$9.99 suggested there), achievement upload + icons, Steam Cloud quota, depots.
- **Signing**: Windows code signing (else SmartScreen warns) and macOS signing + notarisation (`identity: null`, hardened runtime off today). Windows/macOS builds were not built here (Linux host).
- **Live Steam client test** (not possible here): overlay over WebGL, Shift+Tab pause, achievement toasts, cloud sync across two PCs, rich presence line. steamworks.js 0.4 has no overlay callback; a newer steamworks.js (or a native addon) would make overlay pause exact instead of the Shift+Tab heuristic (fails if the player rebinds the Steam overlay key).
- Rich presence uses the plain `status` key; a localized `steam_display` token file would be needed for the friends-list line.
- Brand / bundle id (`com.skyholdisles.game`, "Skyhold Isles") untouched — owner-gated.
- The DOM board unit (`--s`) still stops growing at 1080p; the PC build compensates with the 1440p+ default UI scale (130 % = the cap of the existing slider). A 4K screen therefore shows boards at 1440p proportions; raising the cap would touch the JS HUD mirrors (`hudDock.ts`, `uiLayout.ts`) and their QA, so it was left.
- Replay viewer keys (Space / 1 / 2 / 4 / Esc), menu navigation and the pad cursor keys stay fixed (not rebindable).
- Exclusive fullscreen does not exist in Electron: "Fullscreen" is borderless fullscreen (alt-tab friendly), which is what most players want.
