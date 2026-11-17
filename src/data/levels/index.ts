import { LEVEL_1 } from './level1.ts';
import { LEVEL_2 } from './level2.ts';
import { LEVEL_3 } from './level3.ts';
import { LEVEL_4 } from './level4.ts';
import { LEVEL_5 } from './level5.ts';
import { LEVEL_6 } from './level6.ts';
import { LEVEL_7 } from './level7.ts';
import { LEVEL_8 } from './level8.ts';
import { LEVEL_9 } from './level9.ts';
import { LEVEL_10 } from './level10.ts';
import { LEVEL_11 } from './level11.ts';
import { LEVEL_12 } from './level12.ts';
import { LEVEL_13 } from './level13.ts';
import type { LevelDef } from './types.ts';

export const LEVELS: readonly LevelDef[] = [
  LEVEL_1,
  LEVEL_2,
  LEVEL_3,
  LEVEL_4,
  LEVEL_5,
  LEVEL_6,
  LEVEL_7,
  LEVEL_8,
  LEVEL_9,
  LEVEL_10,
  LEVEL_11,
  LEVEL_12,
  LEVEL_13,
];
export type { LevelDef, WaveDef, WaveGroupDef } from './types.ts';
export { parseLevelGrid } from './types.ts';
