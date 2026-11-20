# P5 Mobile Builds (Capacitor) & In-App Purchases Guide

Skyhold Isles ships on iOS and Android from the same codebase as Steam/web using **Capacitor 8** wrapping the built `dist/` bundle with `/2d.html` as the start page, landscape orientation locked, sticky immersive fullscreen enabled, and hardware safe-area cutouts exposed through `env(safe-area-inset-*)`.

All native capabilities and billing calls sit strictly behind `src/platform/` (`getPlatform()` and `getIap()`), leaving `src/sim`, `src/data`, and `src/core` 100% pure and deterministic.

---

## 1. Architecture Overview

| Layer | File(s) | Responsibility |
|---|---|---|
| Owner constants | `src/platform/mobileConfig.ts` | Single source of truth for `MOBILE_APP_ID` (`com.skyholdisles.game`), `MOBILE_APP_NAME`, `MOBILE_START_PATH` (`/2d.html`), `MOBILE_BG_COLOR` (`#3d5e27`), and `REVENUECAT_API_KEYS` (`TODO(owner)`). |
| Capacitor config | `capacitor.config.ts` | Imports `MOBILE_APP_ID` & `MOBILE_START_PATH` from `mobileConfig.ts`, wraps `dist/` (`server.appStartPath = '/2d.html'`), configures `SystemBars` (`hidden: true`, `insetsHandling: 'native'`, `initialViewportFitValueHint: 'cover'`) and iOS `contentInset: 'never'`. |
| Android project | `android/` (`AndroidManifest.xml`, `MainActivity.java`) | `sensorLandscape` orientation lock; `MainActivity` enables edge-to-edge layout (`LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES`) so `env(safe-area-inset-*)` receives cutout insets and hides system bars with `BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE` (re-applied on window focus). |
| iOS project | `ios/` (`ios/App/App/Info.plist`, `Package.swift`) | Landscape-only (`UIInterfaceOrientationLandscapeLeft` + `LandscapeRight` on iPhone & iPad), `UIRequiresFullScreen = true`, `UIStatusBarHidden = true`, Swift Package Manager plugin wiring. |
| Platform adapter | `src/platform/platform.ts`, `src/platform/haptics.ts` | Adds `isMobile`, `mobilePlatform`, `triggerHaptic(...)`, `onPause(cb)`, and `onResume(cb)` to `PlatformAdapter`; routes shared `haptics` (`Haptics.pulse`) through `@capacitor/haptics` when native while keeping Settings gating intact. |
| IAP product catalogue | `src/platform/iapProducts.ts` | Single data file defining placeholder entitlement and crystal-pack IDs with `TODO(owner)` markers and **zero** hardcoded prices, bundle contents, or ad SDKs. |
| IAP store & scope gate | `src/platform/iap.ts` | `products()`, `purchase(id)`, `restore()`, `owned(id)`, `entitlements()`, save-backed entitlement cache (`skyhold_isles_entitlements_v1`), injected mobile test store, native RevenueCat bridge, and pure scope gate `isUnlocked(levelId, entitlements)` + `FREE_ISLANDS`. |

---

## 2. Why `@revenuecat/purchases-capacitor` Was Chosen

`docs/2d-transition-plan.md` listed **RevenueCat** or **cordova-plugin-purchase** as candidates for the mobile IAP layer. We selected **`@revenuecat/purchases-capacitor` (`^14.1.1`)** behind `src/platform/iap.ts` for four technical reasons:

1. **First-class Capacitor 8 + SPM support:** `@revenuecat/purchases-capacitor@14.x` declares `@capacitor/core >= 8.0.0` as its peer dependency and ships a native `Package.swift` for Capacitor 8's Swift Package Manager iOS project — no legacy Cordova bridge shim or CocoaPods Ruby toolchain required.
2. **StoreKit 2 + Google Play Billing v7+ maintenance:** Apple and Google deprecate billing client versions roughly every 12–18 months. RevenueCat maintains the native iOS/Android billing SDKs actively under an **MIT** license.
3. **Server-side receipt validation & cross-store entitlement mapping:** Non-consumables (`full_unlock`, `remove_ads`, `starter_pack`) map cleanly to server-verified `CustomerInfo.entitlements.active` without standing up custom receipt-verification servers.
4. **Zero compile-time credentials & strict adapter isolation:** Building the APK/IPA requires no `google-services.json` or compile-time keys; public SDK keys are passed at runtime in `Purchases.configure({ apiKey })`. When `REVENUECAT_API_KEYS` are still empty (`TODO(owner)`), `iap.ts` degrades cleanly to `status: 'unavailable'` without throwing. If the owner ever swaps billing providers, only `createRevenueCatBridge` inside `src/platform/iap.ts` changes.

---

## 3. Integration Guide for `render2d` & UI Agents

*(Per task boundaries, `src/render2d/**` was not modified in P5. Below are the exact drop-in hookups for the `render2d` / UI owner.)*

### A. App Pause -> Pause `Game2D` (One-Line Hookup)
*(Note: 3D `GameSession` in `src/platform/gameSession.ts` is already wired to `platform.onPause`.)*

In `src/render2d/main2d.ts`, right after `const game = new Game2D(app, art, level, hooks);` (around line 285):

```ts
import { getPlatform } from '../platform/index.ts';

// Freeze active 2D simulation when the phone locks, switches apps, or receives a call:
getPlatform().onPause(() => { game.stepper.paused = true; });
```

*(Setting `game.stepper.paused = true` automatically freezes `simDt` to `0`, switches the HUD pause button to the resume glyph, and displays the `'Paused'` banner — the player resumes deliberately when ready.)*

### B. Haptics
**No changes needed in `src/render2d/**`!** `Game2D` already calls `haptics.setEnabled(shouldVibrate2D(this.currentSettings(), isTouchDevice()))` and `haptics.pulse(...)` via `src/platform/haptics.ts` and `src/platform/storage.ts`. When `getPlatform().isMobile` is `true`:
- `isTouchDevice()` returns `true`.
- `haptics.pulse(kind)` routes automatically through `@capacitor/haptics` (`ImpactStyle.Light` / `Medium` / `Heavy` and `NotificationType.Success` / `Error`), including on iOS where `navigator.vibrate` does not exist.
- Turning **Vibration** off in 2D Settings (`settings.haptics = false`) disables native Capacitor haptics identically.

### C. Free-Version Scope Gate (`isUnlocked` + `FREE_ISLANDS`) & IAP Calls
In `src/render2d/ui/worldMap.ts` (or `briefing.ts` / `inGame.ts`), gate islands beyond `FREE_ISLANDS` on native mobile builds:

```ts
import { FREE_ISLANDS, getIap, getPlatform, isUnlocked } from '../../platform/index.ts';

const iap = getIap();
// Steam & regular web builds do not gate campaign islands (`iap.mode === 'noop'`).
const enforceMobileScope = getPlatform().isMobile && iap.mode !== 'noop';

function canPlayIslandOnCurrentTier(levelId: string): boolean {
  if (!enforceMobileScope) return true;
  return isUnlocked(levelId, iap.entitlements());
}
```

Store UI actions (e.g. a "Unlock Full Game" / "Restore Purchases" sheet in the briefing or Settings screen):

```ts
// 1. Fetch localized prices & titles from App Store / Play Billing:
const catalog = await iap.products(); // -> IapStoreProduct[]

// 2. Buy full campaign unlock:
const res = await iap.purchase('full_unlock');
if (res.ok) {
  // `iap.owned('full_unlock')` is now true and persisted in save storage (`skyhold_isles_entitlements_v1`).
  refreshWorldMap();
}

// 3. Restore purchases (mandatory button on iOS App Store for non-consumables!):
const restored = await iap.restore();
if (restored.ok) {
  refreshWorldMap();
}
```

### D. Testing mobile purchases

Use `createIapStore({ platform: mobileAdapter, mode: 'mock' })` in unit tests. Web and desktop builds always use the no-op store, including with `?iapmock=1`. For crystal packs, receipt redelivery and Market UI integration, see [the Market contract](market.md).

---

## 4. Build Steps

Ensure **Node 22+** is on `PATH`.

### NPM Scripts (`package.json`)
```bash
# Build web bundle (`tsc && vite build`) and sync into both `android/` and `ios/`:
npm run mobile:sync

# Fast web-asset copy only (when no Capacitor plugins changed):
npm run mobile:copy

# Build Android debug APK (`android/app/build/outputs/apk/debug/app-debug.apk`):
npm run mobile:build:android:debug

# Open native IDEs (on developer workstation):
npm run mobile:open:android
npm run mobile:open:ios
```

### A. Android Build Steps (CLI / Headless Linux or Developer Machine)

1. **Prerequisites:**
   - **JDK 21** (Eclipse Temurin 21 recommended; set `JAVA_HOME`).
   - **Android SDK** with `platform-tools`, `platforms;android-36`, and `build-tools;35.0.0` (set `ANDROID_HOME` and `ANDROID_SDK_ROOT`).
2. **Checkout-local SDK setup (no root / system install needed, verified on `hermes`):**
   ```bash
   # JDK 21 -> ./.jdk
   mkdir -p .jdk
   curl -fsSL "https://api.adoptium.net/v3/binary/latest/21/ga/linux/x64/jdk/hotspot/normal/eclipse" -o /tmp/jdk21.tar.gz
   tar -xzf /tmp/jdk21.tar.gz -C .jdk --strip-components=1 && rm /tmp/jdk21.tar.gz

   # Android command-line tools -> ./.android-sdk
   mkdir -p .android-sdk/cmdline-tools /tmp/cmdline
   curl -fsSL "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip" -o /tmp/cmdline.zip
   unzip -q /tmp/cmdline.zip -d /tmp/cmdline
   mv /tmp/cmdline/cmdline-tools .android-sdk/cmdline-tools/latest
   rm -rf /tmp/cmdline.zip /tmp/cmdline

   export JAVA_HOME="$PWD/.jdk"
   export ANDROID_HOME="$PWD/.android-sdk"
   export ANDROID_SDK_ROOT="$PWD/.android-sdk"
   export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$PATH"

   yes | sdkmanager --licenses
   sdkmanager "platform-tools" "platforms;android-36" "build-tools;35.0.0"
   printf "sdk.dir=%s\n" "$ANDROID_HOME" > android/local.properties
   ```
3. **Build Debug APK:**
   ```bash
   npm run mobile:build:android:debug
   # Output: android/app/build/outputs/apk/debug/app-debug.apk
   # Install on connected USB / Wi-Fi debugging device:
   adb install -r android/app/build/outputs/apk/debug/app-debug.apk
   ```
4. **Signed Release App Bundle (`.aab`) for Google Play Console:**
   - Generate an upload keystore once (keep outside git!):
     ```bash
     keytool -genkeypair -v -keystore ~/skyhold-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
     ```
   - Build & sign `.aab` in Android Studio (**Build → Generate Signed App Bundle / APK → Android App Bundle**) or via `./gradlew bundleRelease` (`android/app/build/outputs/bundle/release/app-release.aab`), with **Play App Signing** enabled in Google Play Console.

### B. iOS Build Steps (macOS + Xcode 16+)

*(Generated & configured on Linux; building & signing requires macOS with Xcode.)*

1. **Sync built web bundle & SPM plugins:**
   ```bash
   npm ci
   npm run mobile:sync
   ```
2. **Open in Xcode:**
   ```bash
   npm run mobile:open:ios
   # Opens ios/App/App.xcodeproj (uses Swift Package Manager via ios/App/CapApp-SPM/Package.swift)
   ```
3. **Wait for Swift Package Resolution:**
   - Xcode automatically resolves `@capacitor/app`, `@capacitor/haptics`, `@capacitor/status-bar`, and `@revenuecat/purchases-capacitor` (`purchases-hybrid-common` / `RevenueCat`).
4. **Signing & Capabilities (`App` target):**
   - Select the **App** target → **Signing & Capabilities**.
   - Check **Automatically manage signing**, choose your **Apple Developer Team**, and verify **Bundle Identifier** matches `MOBILE_APP_ID` (`com.skyholdisles.game` or final owner choice).
   - Click **+ Capability** → add **In-App Purchase** (required for StoreKit 2 transactions and Sandbox / StoreKit Configuration testing).
5. **Verify Deployment Info:**
   - Orientation is pre-locked in `ios/App/App/Info.plist` to **Landscape Left** and **Landscape Right** (both iPhone and iPad) with **Requires full screen** enabled and status bar hidden.
   - Replace placeholder icons in `ios/App/App/Assets.xcassets/AppIcon.appiconset` (`1024×1024` painted icon) and `Splash.imageset` before App Store submission.
6. **Run on Device & Archive for TestFlight / App Store:**
   - Plug in an iPhone/iPad, select it in Xcode's destination bar, and press **Run (`⌘R`)** (also use this for the real-device 150-enemy FPS check noted in `docs/p0-gate.md`).
   - For TestFlight / App Store Connect: select **Any iOS Device (arm64)** → **Product → Archive** → **Distribute App → App Store Connect**.

---

## 5. What Was Verified on Hermes

- **Full repo gate:** `npx tsc --noEmit`, `npm run lint`, `npm test`, `npm run sim:balance` (33/33 levels PASS), and `npm run build` all pass cleanly.
- **Platform & IAP unit suite (`tests/platform/mobileAdapter.test.ts`, `tests/platform/iap.test.ts`):**
  - `isMobile` / `mobilePlatform` detection and mutual exclusion with `isSteam`.
  - Native Capacitor Haptics routing per `HapticKind` (`LIGHT` / `MEDIUM` / `HEAVY` impacts + `SUCCESS` / `ERROR` notifications), rate limiting, and Settings `haptics` toggle gating.
  - `platform.onPause` / `platform.onResume` subscriber notification, deduplication, unsubscribe, and listener error isolation.
  - IAP no-op on web & Steam; `?iapmock=1` query detection; mock store `products()`, `purchase()`, user cancellation, error handling, `owned()`, entitlement cache surviving reload offline, `restore()` recovering remote purchases after local cache wipe, and survival across Settings → Reset Progress.
  - Native RevenueCat bridge mapping (`StoreProduct`, `CustomerInfo`, `userCancelled`, `restorePurchases`) and safe `'unavailable'` fallback while `REVENUECAT_API_KEYS` are blank.
  - `FREE_ISLANDS` (`['l1c', 'i01', 'i02', 'i03', 'i04', 'i05']`) and `isUnlocked(levelId, entitlements)` scope gate.
  - Capacitor Android & iOS project config invariants (single `MOBILE_APP_ID` source, `sensorLandscape`, immersive cutout mode, iOS landscape-only `Info.plist`, zero ad SDKs).
- **Real Android Debug APK Build on Hermes:**
  - Installed Temurin JDK 21 into `./.jdk` and Android SDK (`platform-tools`, `platforms;android-36`, `build-tools;35.0.0`) into `./.android-sdk` (checkout-local, gitignored).
  - Ran `npm run mobile:build:android:debug` (`tsc && vite build && cap sync && ./gradlew assembleDebug`) and verified the packaged `android/app/build/outputs/apk/debug/app-debug.apk` contains `assets/public/2d.html`, `assets/capacitor.config.json` (`"appStartPath": "/2d.html"`), `assets/public/art2d/manifest.json`, and `com.android.vending.BILLING`.

### What Remains Unverified on Linux (Requires Owner Hardware / Accounts)
1. **iOS compilation & TestFlight archive** (requires macOS + Xcode 16+ + Apple Developer signing certificate).
2. **Real physical phone WebGL + Taptic / Haptic + notch cutout run** (iPhone & mid-range Android phone).
3. **Live StoreKit 2 Sandbox / Google Play License Testing round-trip** (requires store accounts, product SKUs created in consoles, and RevenueCat public SDK keys).

---

## 6. Owner Decisions Checklist (Before Store Submission)

1. **Final App / Bundle Identifier (`MOBILE_APP_ID`):**
   - Currently placeholder `com.skyholdisles.game` in `src/platform/mobileConfig.ts` (and generated into `android/app/build.gradle`, `MainActivity.java` package path, and `ios/App/App.xcodeproj`).
   - **Decision:** Confirm `com.skyholdisles.game` (or choose final reverse-DNS ID once the final post-P1 game title/domain is locked — bundle IDs are permanent once published on App Store / Google Play).
2. **Store Developer Accounts & RevenueCat Project Keys:**
   - **Apple Developer Program** ($99/yr) + **App Store Connect** app record + Paid Applications Agreement + tax/banking forms.
   - **Google Play Console** ($25 one-time) + Merchant/Payments profile + internal/closed testing track.
   - **RevenueCat account** (free tier covers up to $2.5k MTR): link App Store Connect shared secret / In-App Purchase key & Google Play service account, then paste the two public SDK keys (`appl_...` and `goog_...`) into `REVENUECAT_API_KEYS` in `src/platform/mobileConfig.ts`.
3. **IAP Product List, Regional Prices & Contents (`src/platform/iapProducts.ts`):**
   - Legacy entitlement placeholders (`TODO(owner)`): `remove_ads`, `starter_pack`, `full_unlock` — **no prices or bundle contents are set**.
   - **Decisions needed:**
     - Does the free mobile version include ads at all? *(Currently zero ad SDKs are installed; if the game stays ad-free with a "try 6 islands free → buy `full_unlock`" model, drop `remove_ads`.)*
     - Keep or drop `starter_pack`? If kept, what non-pay-to-win content does it grant (cosmetics / early Workshop stars / extra challenge pack)?
     - Regional price tiers for `full_unlock` (e.g. $4.99–$6.99 USD vs Steam's ~$9.99 USD).
     - Ensure a visible **"Restore Purchases"** button is placed in Settings / Store sheet (mandatory for Apple App Store review of non-consumables).
4. **Free-Version Scope Cut (`FREE_ISLANDS` in `src/platform/iap.ts`):**
   - Currently placeholder first 6 entries of `LEVELS_2D`: `['l1c', 'i01', 'i02', 'i03', 'i04', 'i05']`.
   - **Decision:** Which exact islands (and whether Endless / Daily Squall / Logbook feats are open on free islands or gated behind `full_unlock`) ship in the free download?
5. **Privacy Policy URL, App Store Nutrition Label & Google Play Data Safety Form:**
   - Both stores require a public HTTPS **Privacy Policy URL** before review.
   - **Data disclosure summary for the current build:**
     - Game saves, settings, and cached entitlements are stored locally on-device (`localStorage`).
     - Zero analytics SDKs, zero ad/tracking SDKs, zero third-party login, and zero IDFA / `NSUserTrackingUsageDescription` prompts.
     - `@revenuecat/purchases-capacitor` transmits **Purchase History** (anonymous RevenueCat App User ID + store transaction receipts, not linked to real-world identity) solely for **App Functionality** (validating and restoring IAP entitlements). Declare **Purchases → Purchase History (Anonymous / Not linked to user, Not used for tracking)** on both Apple's App Privacy Nutrition Label and Google Play's Data Safety form.
6. **App Icons, Splash Screens & Store Screenshots:**
   - Replace Capacitor's default launcher icons in `android/app/src/main/res/mipmap-*` and `ios/App/App/Assets.xcassets/AppIcon.appiconset` with painted Skyhold Isles icon art (`1024×1024` master + adaptive foreground/background layers on Android).
