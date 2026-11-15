import { LEVEL_1 } from './level1.ts';
import { LEVEL_2 } from './level2.ts';
import { LEVEL_3 } from './level3.ts';
import type { LevelDef } from './types.ts';

export const LEVELS: readonly LevelDef[] = [LEVEL_1, LEVEL_2, LEVEL_3];
export type { LevelDef, WaveDef, WaveGroupDef } from './types.ts';
export { parseLevelGrid } from './types.ts';
