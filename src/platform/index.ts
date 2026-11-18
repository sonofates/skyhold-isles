export {
  createPlatformAdapter,
  getPlatform,
  sanitizeCloudSlot,
  setPlatformAdapter,
  type CloudStorageLike,
  type CreatePlatformOptions,
  type MobileBridge,
  type MobilePlatformName,
  type NativeHapticFeedback,
  type PlatformAchievements,
  type PlatformAdapter,
  type PlatformCloudSave,
  type SteamBridge,
} from './platform.ts';
export {
  MOBILE_APP_ID,
  MOBILE_APP_NAME,
  MOBILE_BG_COLOR,
  MOBILE_START_PATH,
  REVENUECAT_API_KEYS,
} from './mobileConfig.ts';
export {
  earnedSteamAchievementIds,
  exportAchievementManifest,
  STEAM_ACHIEVEMENTS,
  syncAchievementsFromProgress,
  type SteamAchievementDef,
  type SteamAchievementMeta,
} from './achievements.ts';
export { hydrateProgressFromCloud, type CloudHydrateResult } from './cloudSync.ts';
