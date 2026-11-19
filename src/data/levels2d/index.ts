import { ENEMY_DEFS } from '../enemies.ts';
import { ENEMY_MELEE } from '../soldiers.ts';
import { LEVELS } from '../levels/index.ts';
import type { LevelDef } from '../levels/types.ts';
import { LEVEL_L1C } from './l1c.ts';

import { I01 } from './i01.ts';
import { I02 } from './i02.ts';
import { I03 } from './i03.ts';
import { I04 } from './i04.ts';
import { I05 } from './i05.ts';
import { I06 } from './i06.ts';
import { I07 } from './i07.ts';
import { I08 } from './i08.ts';
import { I09 } from './i09.ts';
import { I10 } from './i10.ts';
import { I11 } from './i11.ts';
import { I12 } from './i12.ts';
import { I13 } from './i13.ts';
import { I14 } from './i14.ts';
import { I15 } from './i15.ts';
import { I16 } from './i16.ts';
import { I17 } from './i17.ts';
import { I18 } from './i18.ts';
import { I19 } from './i19.ts';
import { I20 } from './i20.ts';
import { I21 } from './i21.ts';
import { I22 } from './i22.ts';
import type { ChapterIsland } from './chapterIsland.ts';

const chapterTwo: readonly ChapterIsland[] = [I17, I18, I19, I20, I21, I22];

/** A chapter island can enter the campaign once every enemy in its waves has joined the roster. */
export function registeredChapterIslands(): LevelDef[] {
  return chapterTwo.filter((level): level is LevelDef => level.waves.every(wave =>
    wave.groups.every(group => Object.hasOwn(ENEMY_DEFS, group.enemyType) && Object.hasOwn(ENEMY_MELEE, group.enemyType)),
  ));
}

/**
 * 2D plot-map islands. Kept apart from the 16-island campaign list (`LEVELS`), so campaign
 * progression, saves and every UI that iterates `LEVELS` stay untouched; load these by id.
 */
export const LEVELS_2D: readonly LevelDef[] = [
  LEVEL_L1C,
  I01, I02, I03, I04, I05, I06, I07, I08,
  I09, I10, I11, I12, I13, I14, I15, I16,
  ...registeredChapterIslands(),
];

/** Any island by id: campaign islands first, then the 2D side entries. */
export function getLevelById(id: string): LevelDef | null {
  return LEVELS.find((l) => l.id === id) ?? LEVELS_2D.find((l) => l.id === id) ?? null;
}

export { LEVEL_L1C };
