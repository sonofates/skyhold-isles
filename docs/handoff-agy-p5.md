# Handoff — P5 Mobile Builds (Capacitor) + IAP Plumbing (`agy-p5`)

- **Branch:** `hermes/skyhold-p5-mobile` (base: `art-2d` @ `854d34a`)
- **Date:** 2026-11-18

---

## 1. Summary of Changes

### A. Mobile Platform Adapter Extensions (`91b3158`)
- **Single Owner Config (`src/platform/mobileConfig.ts`):**
  - Defined `MOBILE_APP_ID = 'com.skyholdisles.game'` in **one** constant (clearly marked `TODO(owner)`, no invented company name anywhere), along with `MOBILE_APP_NAME = 'Skyhold Isles'`, `MOBILE_START_PATH = '/2d.html'`, `MOBILE_BG_COLOR = '#3d5e27'`, and `REVENUECAT_API_KEYS` placeholders (`{ ios: '', android: '' }`, `TODO(owner)`).
- **Platform Adapter (`src/platform/platform.ts`, `src/platform/haptics.ts`, `src/platform/storage.ts`, `src/platform/gameSession.ts`):**
  - Extended `PlatformAdapter` (`getPlatform()`) with `isMobile`, `mobilePlatform` (`'ios' | 'android' | 'web'`), `triggerHaptic(feedback)`, `onPause(cb)`, and `onResume(cb)`.
  - Uses lazy dynamic imports (`@capacitor/haptics`, `@capacitor/app`, `@capacitor/status-bar`) only when `Capacitor.isNativePlatform()` is true, keeping web/Steam bundles lean and Node/Vitest execution clean.
  - Routed shared `haptics` (`Haptics.pulse`) through `PlatformAdapter.triggerHaptic` (`ImpactStyle.Light` / `Medium` / `Heavy` + `NotificationType.Success` / `Error`) when `isMobile === true`, so `Game2D` gets native Taptic Engine / Android actuator feedback automatically while continuing to respect the 2D Settings `haptics` toggle and rate limits without touching `src/render2d/**`.
  - Subscribed 3D `GameSession` to `platform.onPause(() => this.enterBackground())` and documented the one-line hookup for `Game2D` (`getPlatform().onPause(() => { game.stepper.paused = true; });`) in `docs/p5-mobile.md`.

### B. IAP Store Plumbing, Catalogue & Free-Version Scope Gate (`b01af2b`)
- **Product Catalogue (`src/platform/iapProducts.ts`):**
  - Single data file holding placeholder product IDs (`remove_ads`, `starter_pack`, `full_unlock`) marked `TODO(owner)`, deriving SKUs from `MOBILE_APP_ID` with **no** hardcoded prices, **no** decided bundle contents, and **zero** ad SDKs.
- **Store Adapter (`src/platform/iap.ts`):**
  - Implemented `createIapStore` / `getIap()` exposing `products()`, `purchase(id)`, `restore()`, `owned(id)`, `entitlements()`, and `mode` (`'noop' | 'mock' | 'native'`).
  - **Web & Steam (`mode = 'noop'`):** complete no-op (`owned() === false`, `products() === []`, `purchase() -> unavailable`; Steam ignores `?iapmock=1` since Steam is a paid full game).
  - **Mock Store (`mode = 'mock'`):** active in unit tests and when `?iapmock=1` is present in browser URLs; supports `products()`, `purchase(id)`, `restore()`, user-cancellation/error simulation, and persists a simulated store receipt ledger (`skyhold_isles_iap_mock_ledger_v1`) alongside the local entitlement save cache.
  - **Native Store (`mode = 'native'`):** backed by `@revenuecat/purchases-capacitor` (`^14.1.1`, MIT, Capacitor 8 + Swift Package Manager native) behind `NativePurchasesBridge`; passes `PRODUCT_CATEGORY.NON_SUBSCRIPTION` for Android Play Billing queries, maps `CustomerInfo` entitlements + user cancellation cleanly, and degrades safely to `'unavailable'` until the owner fills in `REVENUECAT_API_KEYS`.
  - **Persistent Save Cache:** stores entitlements under `skyhold_isles_entitlements_v1` in `localStorage`, hydrated synchronously on startup so offline launches and page reloads retain `owned(...) === true` immediately, and isolated from `resetProgressSave` so resetting campaign progress never erases paid unlocks.
- **Free-Version Scope Gate (`src/platform/iap.ts`):**
  - Exported `FREE_ISLANDS` (`['l1c', 'i01', 'i02', 'i03', 'i04', 'i05']` — first 6 islands of `LEVELS_2D`, marked `TODO(owner)`) and pure `isUnlocked(levelId, entitlements)` without touching `src/render2d/**`.

### C. Capacitor Android & iOS Projects + Debug APK Verification (`11db073`)
- **Capacitor Configuration (`capacitor.config.ts`, `package.json`):**
  - Wraps `dist/` with `server.appStartPath = '/2d.html'`, `SystemBars` (`hidden: true`, `insetsHandling: 'native'`, `initialViewportFitValueHint: 'cover'`), `StatusBar.overlaysWebView = true`, and iOS `contentInset = 'never'` so `env(safe-area-inset-*)` works edge-to-edge.
  - Added scripts: `mobile:sync`, `mobile:copy`, `mobile:open:android`, `mobile:open:ios`, `mobile:build:android:debug`.
- **Android (`android/`):**
  - Locked `.MainActivity` to `android:screenOrientation="sensorLandscape"`.
  - Updated `MainActivity.java` to enable `LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES` + sticky immersive bar hiding (`BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE`, re-applied on `onWindowFocusChanged`).
  - Installed Temurin JDK 21 (`21.0.13`) into `./.jdk` and Android SDK (`platform-tools`, `platforms;android-36`, `build-tools;35.0.0`) into `./.android-sdk` (checkout-local, gitignored), built `android/app/build/outputs/apk/debug/app-debug.apk` (**54 MB**, 214 Gradle tasks, `BUILD SUCCESSFUL`), verified manifest/assets via `aapt2 dump badging` & `unzip`, and stopped the Gradle daemon.
- **iOS (`ios/`):**
  - Generated Capacitor 8 Swift Package Manager Xcode project (`ios/App/App.xcodeproj` + `ios/App/CapApp-SPM/Package.swift`).
  - Locked `ios/App/App/Info.plist` to `UIInterfaceOrientationLandscapeLeft` + `UIInterfaceOrientationLandscapeRight` on both iPhone and iPad, with `UIRequiresFullScreen = true` and `UIStatusBarHidden = true`.

---

## 2. Files Touched

| Category | Files |
|---|---|
| Platform & IAP (`src/platform/`) | `src/platform/mobileConfig.ts`, `src/platform/platform.ts`, `src/platform/haptics.ts`, `src/platform/storage.ts`, `src/platform/gameSession.ts`, `src/platform/iapProducts.ts`, `src/platform/iap.ts`, `src/platform/index.ts` |
| Tests (`tests/platform/`) | `tests/platform/mobileAdapter.test.ts`, `tests/platform/iap.test.ts` |
| Capacitor & Build Config | `capacitor.config.ts`, `package.json`, `package-lock.json`, `.gitignore`, `eslint.config.mjs` |
| Native Projects | `android/**` (`AndroidManifest.xml`, `MainActivity.java`, Gradle wrapper & project files), `ios/**` (`Info.plist`, `App.xcodeproj`, `CapApp-SPM/Package.swift`) |
| Documentation | `docs/p5-mobile.md`, `docs/handoff-agy-p5.md` |

*(Forbidden paths — `src/render2d/**`, `src/i18n/**`, `src/audio/**`, `src/data/**`, `tools/**`, `src/sim/**`, `src/core/**` — were 100% untouched.)*

---

## 3. Gate Numbers

| Check | Baseline (`854d34a`) | Final (`hermes/skyhold-p5-mobile`) |
|---|---|---|
| `npx tsc --noEmit` | PASS (0 errors) | **PASS (0 errors)** |
| `npm run lint` | PASS (0 errors, 0 warnings) | **PASS (0 errors, 0 warnings)** |
| `npm test` | 78 files / **1032 passed** (11 skipped) | **80 files / 1048 passed** (11 skipped) |
| `npm run sim:balance` | **33 / 33 PASS** (Greedy + Weak + Workshop) | **33 / 33 PASS** (Greedy + Weak + Workshop) |
| `npm run build` | PASS | **PASS** |
| `npm run mobile:build:android:debug` | — | **PASS** (`app-debug.apk`, 54 MB, `package='com.skyholdisles.game'`, `compileSdk=36`, `minSdk=24`, `appStartPath='/2d.html'`, `VIBRATE` + `BILLING` merged) |

---

## 4. Anything Left Undone / Doubtful

1. **UI / `render2d` Wiring Deferred by Ownership Rule:**
   - `getPlatform().onPause(() => { game.stepper.paused = true; });` in `src/render2d/main2d.ts` and calling `isUnlocked(levelId, getIap().entitlements())` + store purchase/restore buttons in `src/render2d/ui/worldMap.ts` / `briefing.ts` / `metaScreens.ts` are documented with copy-paste snippets in `docs/p5-mobile.md` for the `render2d` owner.
2. **iOS Native Compilation & Signing:**
   - Project config (`ios/App/App.xcodeproj`, `Info.plist`, SPM `Package.swift`) is generated and verified by static invariant tests, but compiling/archiving requires macOS + Xcode 16+ + an Apple Developer signing team (`docs/p5-mobile.md` §4.B).
3. **Physical Device & Live Store Sandbox Smoke Test:**
   - Needs one real Android phone (`adb install app-debug.apk`) and one real iPhone via Xcode to verify physical camera-cutout safe areas, Taptic Engine feel, 150-enemy frame pacing, and live RevenueCat Sandbox purchases once keys are configured.
4. **Bundle Size Optimization Opportunity (Future Polish):**
   - `dist/` currently contains both the legacy 3D assets and the 2D `art2d/` WebP assets (yielding a 54 MB debug APK). Once `main` retires the 3D client after full 2D cutover, stripping 3D public assets from mobile builds will cut APK/IPA size roughly in half.

---

## 5. Open Questions & Decisions for the Owner

1. **Final Bundle / Application ID (`MOBILE_APP_ID`):** Keep `com.skyholdisles.game` or update before first App Store / Google Play upload?
2. **Store Accounts & RevenueCat Public SDK Keys:** Create App Store Connect & Google Play Console app records + RevenueCat project, then populate `REVENUECAT_API_KEYS` (`ios` / `android`) in `src/platform/mobileConfig.ts`.
3. **Final IAP Catalogue, Prices & Contents (`src/platform/iapProducts.ts`):**
   - Keep or drop `remove_ads` (given zero ad SDKs are currently planned/installed)?
   - Keep or drop `starter_pack`, and if kept, what non-pay-to-win items does it grant?
   - Regional pricing for `full_unlock` (and ensure a "Restore Purchases" button is exposed in UI for Apple App Store review).
4. **Free-Version Island Scope (`FREE_ISLANDS` in `src/platform/iap.ts`):** Confirm whether the first 6 entries of `LEVELS_2D` (`l1c`, `i01`–`i05`) are the final free-tier cut, and how Daily Squall / Endless interact with free vs locked islands.
5. **Privacy Policy URL & Store Data Forms:** Host a public HTTPS privacy policy and declare anonymous **Purchases → Purchase History (App Functionality, Not linked to identity, No tracking)** on Apple's Nutrition Label and Google Play's Data Safety form (`docs/p5-mobile.md` §6.5).
6. **Custom Painted App Icons & Splash Art:** Replace Capacitor's placeholder icons in `android/app/src/main/res/mipmap-*` and `ios/App/App/Assets.xcassets/AppIcon.appiconset`.
