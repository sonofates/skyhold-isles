# P4 Steam Desktop Build & Steamworks Guide

Skyhold Isles ships on desktop (Windows, macOS, Linux) as an Electron shell wrapping the built 2D PixiJS client (`dist/2d.html`), talking to Steamworks through a narrow IPC bridge (`desktop/main.cjs` + `desktop/preload.cjs`) behind `src/platform/platform.ts`.

---

## 1. Architecture Overview

| Layer | File(s) | Responsibility |
|---|---|---|
| Platform adapter | `src/platform/platform.ts`, `src/platform/index.ts` | Single interface (`isSteam`, `overlayActive`, `achievements.unlock(id)`, `cloudSave.read/write(slot, json)`). Falls back to no-ops + `localStorage` on web or when Steam is not running. |
| Achievement catalog | `src/platform/achievements.ts`, `desktop/achievements.json` | 28 Steam achievements derived from `FEATS`, `STAR_RULES`, and `CHALLENGES`. |
| Cloud save sync | `src/platform/cloudSync.ts`, `src/platform/storage.ts` | Syncs the existing `ProgressData` v2 JSON blob (`skyhold_progress.json` in Steam Remote Storage), merging record-by-record on startup so neither local nor cloud progress is ever lost. |
| Electron shell | `desktop/main.cjs`, `desktop/preload.cjs` | `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`. Loads built `dist/2d.html` directly from disk (`app.asar`) via an isolated `persist:skyhold` session protocol handler (`http://skyhold.local/2d.html`, no TCP server/port, compatible with PixiJS v8 Web Worker `ImageBitmap` decoding) and initialises `steamworks.js`. |
| Packager | `desktop/electron-builder.json` | Builds Windows (`nsis` + `zip`), macOS (`dmg`, unsigned), and Linux (`AppImage`). Unpacks `node_modules/steamworks.js/**/*` outside `app.asar` for native `.node` / Steamworks dynamic libraries. |

`src/sim`, `src/data`, and `src/core` remain 100% pure and never import `src/platform`.

---

## 2. How to Run Locally

Make sure Node 22+ is on `PATH`.

### Run in Electron (without or with Steam running)
```bash
npm run desktop:dev
```
- Builds `dist/` (`tsc && vite build`) and opens the Electron window on `dist/2d.html`.
- Defaults to `STEAM_APP_ID=480` (Valve's public *Spacewar* test App ID).
- **If the Steam client is running and logged in:** `steamworks.js` connects to Steam (`getPlatform().isSteam === true`), enables the Shift+Tab overlay, and routes achievement unlocks + cloud saves to Steam.
- **If the Steam client is NOT running:** `steamworks.init` fails gracefully, logs `[steam] Steam unavailable ... Running standalone.`, and starts the game normally (`getPlatform().isSteam === false`, `localStorage` save fallback).
- Force standalone mode even while Steam is open: `SKYHOLD_DISABLE_STEAM=1 npm run desktop:dev`.

### Build Desktop Installers
```bash
# Linux x64 AppImage -> release/*.AppImage
npm run desktop:build:linux

# Windows x64 NSIS installer + portable zip -> release/*.exe, release/*.zip (run on Windows or CI)
npm run desktop:build:win

# macOS universal/arch DMG (unsigned) -> release/*.dmg (run on macOS)
npm run desktop:build:mac
```

---

## 3. Setting the Real Steam App ID

Once the real App ID (e.g. `3XXXXXX`) is assigned in Steamworks Partner Portal:

1. **Environment variable (development & CI):**
   ```bash
   STEAM_APP_ID=3XXXXXX npm run desktop:dev
   ```
2. **Production default before shipping:**
   Update `DEFAULT_STEAM_APP_ID` in `desktop/main.cjs` from `480` to your real integer App ID so players launching the executable directly from a folder or shortcut also pass `restartAppIfNecessary` / `steamworks.init(REAL_APP_ID)`.
   *(Do **not** ship `steam_appid.txt` inside final Steam depot builds — Steam injects the App ID automatically when launched from the Steam client; `.gitignore` ignores `steam_appid.txt` so local test files are never committed.)*

---

## 4. Steamworks Partner Portal Checklist (Owner Steps)

### A. App & Store Page Setup
1. Create the application under **Steamworks → App Admin** and note the permanent **App ID**.
2. Complete **Store Page → Basic Info**, **Description**, **Graphical Assets** (header capsule `920×430`, small capsule `462×174`, main capsule `1232×706`, vertical capsule `748×896`, library capsule `600×900`, library hero `3840×1240`, library logo `1280×720`, at least 5 real 16:9 gameplay screenshots), and **Trailers**.
3. Complete the **Content Survey** (cartoon fantasy violence; no user-generated network chat; offline single-player supported) and **Regional Pricing** (~$9.99 USD base tier per `docs/2d-transition-plan.md`).

### B. Achievements Upload (`desktop/achievements.json`)
1. Go to **App Admin → Stats & Achievements → Achievements**.
2. Create an achievement for each of the 28 entries in `desktop/achievements.json`:
   - **API Name (`id`)**: copy verbatim (e.g. `FEAT_FIRST_LANDING`, `STARS_MASTER_SWEEP`, `CHALLENGE_BOWLESS`, `CROWN_ALL_ISLANDS`).
   - **Display Name (`name`)** and **Description (`description`)**: copy from `desktop/achievements.json`.
   - Upload `256×256` colour (unlocked) and greyscale (locked) achievement icons.
3. Click **Publish** under **Prepare for Publishing** so `steamClient.achievement.activate(id)` resolves against live schemas.

### C. Steam Auto-Cloud / Remote Storage
The game uses the **Steamworks Remote Storage API** (`steamClient.cloud.writeFile('skyhold_progress.json', json)` / `readFile`), so no OS-path Auto-Cloud patterns are required:
1. Go to **App Admin → Steam Cloud**.
2. Set **Byte quota per user** to `10485760` (10 MB — a save blob is < 8 KB) and **Number of files allowed per user** to `16`.
3. Enable **Steam Cloud** for the app and publish changes.

### D. Depots & SteamPipe Upload
1. Under **SteamPipe → Depots**, create three OS depots:
   - Windows 64-bit (`OS: Windows`, `64-bit`) — upload contents of `release/win-unpacked/`
   - macOS (`OS: macOS`, `x64` / `arm64`) — upload `Skyhold Isles.app`
   - Linux 64-bit (`OS: Linux`, `64-bit`) — upload contents of `release/linux-unpacked/` (or the `.AppImage`)
2. Under **Installation → General Installation**, configure three Launch Options matching each OS depot:
   - Windows: `Skyhold Isles.exe`
   - macOS: `Skyhold Isles.app`
   - Linux: `skyhold-isles-td` (inside `linux-unpacked`)
3. Upload builds with `steamcmd +login <builder_account> +run_app_build app_build.vdf +quit` and set the `beta` branch live for verification before `default`.

### E. AI-Generated Content Disclosure Draft (Steam Content Survey)
Valve requires disclosing pre-generated AI assets in the **AI Generated Content** section of the Content Survey (**Pre-Generated**, *not* Live-Generated — the shipped game makes zero runtime AI calls). Draft text for the owner to review and paste:

> **Pre-Generated AI Content Disclosure (Draft):**
> Skyhold Isles uses AI-assisted image and animation generation tools during development as part of its 2D art pipeline for island backgrounds, tower/unit sprites, and UI ornaments. Every generated asset is curated, keyed, composited, animated, and balanced by the developer around hand-authored level layouts, deterministic simulation code, and original game design. No AI generation occurs at runtime on the player's device, and all characters, settings, and UI designs are original to Skyhold Isles.

---

## 5. What Was Verified vs What Remains Untested

### Verified on Hermes (Linux x64)
- `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run sim:balance` (17/17 PASS), `npm run build`.
- Unit tests (`tests/platform/steamAdapter.test.ts`): web fallback, Steam-offline Electron fallback, mocked Steamworks IPC bridge (achievement unlock + deduplication + retry, cloud save read/write + offline fallback, overlay listener), 28-achievement catalog parity with `desktop/achievements.json`, and `src/sim` isolation.
- `npm run desktop:build:linux`: full Electron x64 Linux `AppImage` + `linux-unpacked` build (`app.asar` + `app.asar.unpacked/node_modules/steamworks.js`).
- Headless Electron launch on Xvfb (`SKYHOLD_DISABLE_STEAM=0`): graceful standalone startup when Steam client is absent (`isSteam=false`), `dist/2d.html` loaded from packaged files, `contextBridge` API exposed on `window.skyholdSteam`.

### Untested (Requires Owner Machine with Live Steam Client / Target OS)
1. **Live Steam Client handshake (`isSteam=true`):** Running `npm run desktop:dev` alongside an open, logged-in Steam desktop client (with App ID `480` or the real App ID) to confirm the Shift+Tab overlay renders over WebGL, `achievement.activate` pops the Steam toast, and `cloud.writeFile('skyhold_progress.json', ...)` syncs across two machines.
2. **Overlay callback in `steamworks.js@0.4.0`:** `steamworks.js` v0.4.0 exposes `SteamCallback` values `0..9` and does not yet bind `GameOverlayActivated` in its Rust enum; `desktop/main.cjs` guards for `SteamCallback.GameOverlayActivated` automatically once `steamworks.js` adds it, while `electronEnableSteamOverlay()` handles rendering the overlay itself.
3. **Windows (`nsis` + `zip`) and macOS (`dmg`, unsigned) builds:** Configured in `desktop/electron-builder.json` (`npm run desktop:build:win`, `npm run desktop:build:mac`), but must be built and smoke-tested on Windows 10/11 and macOS Apple Silicon / Intel respectively (and signed/notarised on macOS if Gatekeeper prompts are undesired).
4. **2D Main-Menu Progress Wiring:** `src/render2d/main2d.ts` (owned by the P3 UI track) currently runs standalone single-island sessions; once the P3 campaign progression screen calls `saveProgress` / `GameSession` in the 2D entry, `storage.ts` will automatically push saves to Steam Cloud and unlock achievements with no further platform changes.
