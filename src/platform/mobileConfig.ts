/**
 * Mobile wrapper & store configuration constants.
 *
 * Owner decisions are isolated here as single constants so nothing in code, Capacitor config,
 * or documentation invents a company name, store pricing, or live API keys.
 */

/**
 * TODO(owner): Final reverse-DNS application / bundle identifier for Google Play & Apple App Store.
 * Kept in ONE constant across TypeScript and `capacitor.config.ts`.
 * If changed before store submission, also update `android/app/build.gradle` (`namespace` /
 * `applicationId`) and `ios/App/App.xcodeproj` (`PRODUCT_BUNDLE_IDENTIFIER`) — see `docs/p5-mobile.md`.
 */
export const MOBILE_APP_ID = 'com.skyholdisles.game';

/**
 * TODO(owner): Final display title on mobile home screens (see `docs/2d-transition-plan.md`).
 */
export const MOBILE_APP_NAME = 'Skyhold Isles';

/** Start path inside the built `dist/` bundle served by Capacitor's local WebView server. */
export const MOBILE_START_PATH = '/2d.html';

/** WebView / splash background colour matching `2d.html` so boot never flashes white. */
export const MOBILE_BG_COLOR = '#3d5e27';

/**
 * TODO(owner): Public RevenueCat SDK keys from the RevenueCat project dashboard
 * (one Apple App Store public key `appl_...`, one Google Play public key `goog_...`).
 * Leave empty until store apps are created; when empty, native IAP calls degrade safely to
 * `'unavailable'` instead of throwing. Never place secret REST keys in client code.
 */
export const REVENUECAT_API_KEYS: {
  readonly ios: string;
  readonly android: string;
} = {
  ios: '',
  android: '',
};
