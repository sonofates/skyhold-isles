import type { CapacitorConfig } from '@capacitor/cli';
import {
  MOBILE_APP_ID,
  MOBILE_APP_NAME,
  MOBILE_BG_COLOR,
  MOBILE_START_PATH,
} from './src/platform/mobileConfig.ts';

/**
 * Capacitor configuration wrapping `dist/` with `/2d.html` as the start page.
 *
 * Owner decisions (`MOBILE_APP_ID`, `MOBILE_APP_NAME`) live in `src/platform/mobileConfig.ts`
 * so the application identifier is defined in a single constant.
 */
const config: CapacitorConfig = {
  appId: MOBILE_APP_ID,
  appName: MOBILE_APP_NAME,
  webDir: 'dist',
  backgroundColor: MOBILE_BG_COLOR,
  zoomEnabled: false,
  server: {
    // Leading '/' is required so Android's `https://localhost` resolves to `https://localhost/2d.html`.
    appStartPath: MOBILE_START_PATH,
    androidScheme: 'https',
    iosScheme: 'capacitor',
  },
  android: {
    backgroundColor: MOBILE_BG_COLOR,
  },
  ios: {
    backgroundColor: MOBILE_BG_COLOR,
    contentInset: 'never',
    preferredContentMode: 'mobile',
    scrollEnabled: false,
  },
  plugins: {
    SystemBars: {
      hidden: true,
      insetsHandling: 'native',
      initialViewportFitValueHint: 'cover',
    },
    StatusBar: {
      overlaysWebView: true,
    },
  },
};

export default config;
