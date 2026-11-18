export {
  createPlatformAdapter,
  getPlatform,
  sanitizeCloudSlot,
  setPlatformAdapter,
  type CloudStorageLike,
  type CreatePlatformOptions,
  type PlatformAchievements,
  type PlatformAdapter,
  type PlatformCloudSave,
  type SteamBridge,
} from './platform.ts';
export {
  earnedSteamAchievementIds,
  exportAchievementManifest,
  STEAM_ACHIEVEMENTS,
  syncAchievementsFromProgress,
  type SteamAchievementDef,
  type SteamAchievementMeta,
} from './achievements.ts';
export { hydrateProgressFromCloud, type CloudHydrateResult } from './cloudSync.ts';
