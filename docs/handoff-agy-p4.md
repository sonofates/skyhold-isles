# Handoff — P4 Steam Desktop Plumbing + Barracks Spread + Mortar Aim (`agy-p4`)

- **Branch:** `hermes/skyhold-p4-steam` (base: `art-2d` @ `50e9019`)
- **Date:** 2026-11-18

---

## 1. Summary of Changes (3 Separate Commits + Handoff)

### A. Steam Desktop Build (Electron + `steamworks.js`) Behind Platform Adapter (`e24e84e`)
- **Platform Adapter (`src/platform/platform.ts`, `src/platform/index.ts`):**
  - Unified interface: `isSteam`, `overlayActive`, `onOverlayChange(listener)`, `achievements.unlock(id)`, and `cloudSave.read/write(slot, json)` with slot-name sanitisation.
  - Web build and Electron-without-Steam fallback cleanly (`isSteam=false`, `overlayActive=false`, no-op achievements, `localStorage` cloud-save fallback).
  - Pure simulation modules (`src/sim`, `src/data`, `src/core`) remain 100% isolated from `src/platform` (verified by ESLint + unit test).
- **Achievement Map & Cloud Save Sync (`src/platform/achievements.ts`, `src/platform/cloudSync.ts`, `desktop/achievements.json`, `src/platform/storage.ts`, `src/platform/gameSession.ts`):**
  - Derived 28 Steam achievements (`{ id, name, description }`) from existing game data (`FEATS`, `STAR_RULES`, `CHALLENGES` — read-only, untouched).
  - `saveProgress` mirrors the existing `ProgressData` v2 JSON blob (`skyhold_progress.json`) to Steam Cloud and triggers achievement unlocks when `isSteam=true`.
  - `hydrateProgressFromCloud` merges remote and local saves record-by-record via `mergeProgress` on startup so neither side ever loses earned stars, clears, or challenge badges.
  - `GameSession` pauses an active wave when the Steam overlay opens.
- **Electron Shell & Builder (`desktop/main.cjs`, `desktop/preload.cjs`, `desktop/electron-builder.json`):**
  - `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, narrow `contextBridge` API (`window.skyholdSteam`), external navigation and popups blocked.
  - Serves the built `dist/2d.html` directly from local packaged files (`app.asar`) via an isolated `persist:skyhold` session protocol handler (`http://skyhold.local/2d.html` — zero TCP port/server, full compatibility with PixiJS v8 `blob:` Web Worker `ImageBitmap` decoding).
  - Initialises `steamworks.js` with `STEAM_APP_ID` (default `480`); starts gracefully in standalone mode (`isSteam=false`) if Steam is not running.
  - Configured `electron-builder` for Windows (`nsis` + `zip`), macOS (`dmg`, unsigned), and Linux (`AppImage`), unpacking `node_modules/steamworks.js/**/*` outside `app.asar`.
  - Built `release/Skyhold Isles-1.0.0.AppImage` (153 MB) on hermes and verified packaged execution under Xvfb (`filesPresent: 85, filesMissing: 0, isSteam: false`).
  - Documented full workflow, partner-portal steps, and AI-content disclosure draft in `docs/p4-steam.md`.

### B. Barracks Blocked Enemy Queue Spread (`de53136`)
- **`src/sim/soldierSystem.ts` & `tests/sim/barracks.test.ts`:**
  - Added deterministic lateral spread across the road width (`blockedLateralOffset(uid)` via golden-ratio conjugate in `[-0.36, +0.36]` world units, `±18 px` at `50 px/u`, stable for each enemy's lifetime, zero RNG) and along-path spacing behind the front blocked foe (`BLOCK_QUEUE_SPACING = 0.30` world units = `15 px` per queue slot within `BLOCK_CLUSTER_GAP = 1.8` u clusters), smoothly eased in and out (`BLOCK_EASE_RATE = 14 / s`) and synced back into `SpatialHashGrid`.
  - Engagement, holding capacity, melee swing timing, and damage rules are completely unchanged.
  - Added unit tests proving 6 enemies blocked by one soldier (and 6 enemies blocked at a standard barracks choke) settle into distinct positions `>= 12 px` apart across all 15 pairs with deterministic, `uid`-stable lateral slots.

### C. Mortar Barrel Direction (`579d6dc`)
- **`src/render2d/turret.ts`, `src/render2d/towerLayer.ts`, `tests/render/turret.test.ts`:**
  - Because `public/art2d/manifest.json` currently has no 5-direction `turret` entries for `mortar`, implemented `bodyAimPose` and `aimedSpriteMuzzle` in `turret.ts` and wired `BODY_AIM_TOWERS` (`mortar`) in `towerLayer.ts`.
  - Uses the same 8-sector `pickSector(yawToScreenAngle(targetYaw), ...)` hysteresis as archer/cannon/ballista, mirrors `scale.x` horizontally for west sectors (`SW`, `W`, `NW`, plus deadband hysteresis across due `N`/`S`), applies a subtle symmetric vertical pitch tilt (`[-0.10, +0.11]` rad, negated when mirrored so `E`/`W`, `SE`/`SW`, and `NE`/`NW` barrel heights match), and transforms `muzzlePx` so projectiles and smoke puffs leave the aimed barrel mouth.
  - **Art Need:** **5-direction mortar turret art (`S, SE, E, NE, N` turret strip + body sprite per tier: `turrets/mortar-{1,2,3}-turret.json`) is still needed.** Once added to `public/art2d/manifest.json` under `towers.mortar.turret`, `TowerLayer` will automatically use the 5-direction turret path instead of the `BODY_AIM_TOWERS` mirror+tilt fallback with zero code changes.

---

## 2. Files Touched

| Category | Files |
|---|---|
| Desktop / Steam (`A`) | `desktop/main.cjs`, `desktop/preload.cjs`, `desktop/electron-builder.json`, `desktop/achievements.json`, `docs/p4-steam.md` |
| Platform Adapter (`A`) | `src/platform/platform.ts`, `src/platform/achievements.ts`, `src/platform/cloudSync.ts`, `src/platform/index.ts`, `src/platform/storage.ts`, `src/platform/gameSession.ts`, `tests/platform/steamAdapter.test.ts` |
| Build / Config (`A`) | `package.json`, `package-lock.json`, `.gitignore`, `eslint.config.mjs` |
| Sim Queue Spread (`B`) | `src/sim/soldierSystem.ts`, `tests/sim/barracks.test.ts` |
| Mortar Aim (`C`) | `src/render2d/turret.ts`, `src/render2d/towerLayer.ts`, `tests/render/turret.test.ts` |
| Handoff | `docs/handoff-agy-p4.md` |

*(No forbidden files — `src/data/levels2d/**`, `tools/map-compose/**`, `src/ui/**`, `hud.ts`, `buildRing.ts`, `endPanel.ts`, `codex2d.ts`, `main2d.ts` — were touched.)*

---

## 3. Gate Numbers

| Check | Baseline (`50e9019`) | Final (`hermes/skyhold-p4-steam`) |
|---|---|---|
| `npx tsc --noEmit` | PASS (0 errors) | **PASS (0 errors)** |
| `npm run lint` | PASS (0 errors, 0 warnings) | **PASS (0 errors, 0 warnings)** |
| `npm test` | 73 files / **873 passed** (11 skipped) | **74 files / 889 passed** (11 skipped) |
| `npm run sim:balance` | **17 / 17 PASS** (Greedy + Weak + Workshop) | **17 / 17 PASS** (Greedy + Weak + Workshop) |
| `npm run build` | PASS | **PASS** |
| `npm run desktop:build:linux` | — | **PASS** (`release/Skyhold Isles-1.0.0.AppImage`, 153 MB; Xvfb smoke test: `85/85` art files loaded, `0` missing, `isSteam: false`) |

---

## 4. Anything Left Undone / Doubtful

1. **5-direction mortar art pending:** Shipped mortar uses the whole-sprite mirror + slight pitch tilt fallback (`BODY_AIM_TOWERS` in `src/render2d/towerLayer.ts`). Dedicated 5-direction mortar turret strips (`S, SE, E, NE, N` + static stone ring body for T1–T3) should be generated in the art pipeline to match archer/cannon/ballista.
2. **Live Steam Client test pending:** Hermes has no running Steam desktop client, so live `isSteam=true` round-trips (Shift+Tab overlay rendering over WebGL, Steam toast popups, live Steam Remote Storage upload) need a quick smoke run on the owner's machine with Steam open (`npm run desktop:dev`).
3. **Windows & macOS installer builds:** Configured in `desktop/electron-builder.json` (`npm run desktop:build:win`, `npm run desktop:build:mac`), unverified on Linux host.
4. **2D campaign persistence hookup:** `src/render2d/main2d.ts` (owned by the P3 UI agent) currently boots direct island runs without calling `saveProgress`; once P3 meta screens call `saveProgress` / `hydrateProgressFromCloud`, Steam Cloud and achievement unlocks fire automatically through `src/platform/storage.ts`.

---

## 5. Open Questions for the Owner

1. **Final Steam App ID & Product Title:** Once the Steamworks app entry is created (and if the post-P1 title changes from *Skyhold Isles*), what App ID and `productName` / `appId` reverse-DNS identifier should be locked into `desktop/main.cjs` and `desktop/electron-builder.json`?
2. **macOS Signing / Notarisation:** `desktop/electron-builder.json` currently sets `"identity": null` (unsigned DMG as specified). Before public macOS Steam depot release, will builds be signed and notarised with an Apple Developer ID certificate?
3. **Achievement Icon Art:** Should the 28 achievement icons (`256×256` colour + locked greyscale for Steamworks upload) be batch-generated in the painted UI-kit style alongside P3/P4 store capsules?
