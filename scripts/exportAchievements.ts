/**
 * Writes desktop/achievements.json from the catalog (src/platform/achievements.ts), so the two stay
 * 1-to-1 (tests/platform/steamAdapter.test.ts checks it). Run: `npm run steam:achievements`.
 */
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { exportAchievementManifest } from '../src/platform/achievements.ts';

const out = resolve(import.meta.dirname, '../desktop/achievements.json');
const list = exportAchievementManifest();
writeFileSync(out, `${JSON.stringify(list, null, 2)}\n`);
console.log(`[achievements] wrote ${list.length} entries to desktop/achievements.json`);
