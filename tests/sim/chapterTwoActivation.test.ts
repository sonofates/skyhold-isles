import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyWin } from '../../src/game/progression.ts';
import { CAMPAIGN_ORDER } from '../../src/data/chapters.ts';
import { CHAPTER_ENEMY_DEFS, CHAPTER_ENEMY_MELEE, CHAPTER_ENEMY_TYPES, ENEMY_DEFS, ENEMY_TYPES } from '../../src/data/enemies.ts';
import { getLevelById, LEVELS_2D, registeredChapterIslands } from '../../src/data/levels2d/index.ts';
import { ENEMY_MELEE } from '../../src/data/soldiers.ts';
import { DATA_TR } from '../../src/i18n/dataTr.ts';
import { enemyArtFor, parseManifest } from '../../src/render2d/manifest.ts';
import { GENERIC_STORY_ISLANDS } from '../../src/render2d/ui/storyBeats.ts';
import { ENEMY_LORE } from '../../src/ui/content/codexData.ts';
import { ENEMY_BADGE_META, ENEMY_ICON_SVGS } from '../../src/ui/icons.ts';
import { createDefaultProgress } from '../../src/platform/storage.ts';

const ROOT = resolve(import.meta.dirname, '../..');
const RAW = JSON.parse(readFileSync(resolve(ROOT, 'public/art2d/manifest.json'), 'utf8')) as Record<string, unknown>;
const M = parseManifest(RAW);
const onDisk = (p: string): boolean => existsSync(resolve(ROOT, 'public/art2d', p));
const CHAPTER = ['i17', 'i18', 'i19', 'i20', 'i21', 'i22', 'i23', 'i24'];

describe('chapter two is in the shipping campaign', () => {
  it('LEVELS_2D lists the islands in chapter order, chapter two (i17-i24 + slot i27) after i16', () => {
    const ids = LEVELS_2D.map((l) => l.id);
    // Chapter slots whose island is not registered yet (i25-i27, built separately) are skipped.
    expect(ids).toEqual(CAMPAIGN_ORDER.filter((id) => getLevelById(id) !== null));
    expect(ids.slice(0, 17)).toEqual(['l1c', ...Array.from({ length: 16 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)].filter((id) => ids.includes(id)));
    expect(registeredChapterIslands().map((l) => l.id)).toEqual(CHAPTER);
    for (const id of CHAPTER) expect(getLevelById(id)).toBe(LEVELS_2D[ids.indexOf(id)]);
    expect(ids.indexOf('i17')).toBe(ids.indexOf('i16') + 1);
  });

  it('clearing i16 unlocks i17 (and only i17)', () => {
    const p = createDefaultProgress(LEVELS_2D.length);
    const i16 = LEVELS_2D.findIndex((l) => l.id === 'i16');
    for (let i = 0; i <= i16; i++) applyWin(p, i, LEVELS_2D.length, 2, 10, []);
    expect(p.unlockedLevelIndex).toBe(i16 + 1);
    expect(LEVELS_2D[p.unlockedLevelIndex].id).toBe('i17');
  });

  it('every wave group on every island names a registered enemy with a melee profile', () => {
    for (const level of LEVELS_2D) {
      for (const wave of level.waves) {
        for (const g of wave.groups) {
          expect(Object.hasOwn(ENEMY_DEFS, g.enemyType), `${level.id} ${g.enemyType}`).toBe(true);
          expect(Object.hasOwn(ENEMY_MELEE, g.enemyType), `${level.id} ${g.enemyType}`).toBe(true);
        }
      }
    }
  });

  it('chapter islands have Turkish names, a painted story and their chart landmark', () => {
    const ui = (RAW.paintedUi ?? {}) as Record<string, string>;
    for (const id of CHAPTER) {
      expect(DATA_TR.islands[id]?.name, id).toBeTruthy();
      expect(DATA_TR.islands[id]?.subtitle, id).toBeTruthy();
      expect(GENERIC_STORY_ISLANDS).toContain(id);
      for (const part of ['intro', 'outro']) {
        expect(existsSync(resolve(ROOT, `public/art2d/ui/story-${id}-${part}-1.webp`)), `${id} ${part}`).toBe(true);
      }
      expect(ui[`island-${id}`], id).toBeTruthy();
    }
  });
});

describe('the four chapter enemies are fully registered', () => {
  it.each(CHAPTER_ENEMY_TYPES)('%s: defs, melee, roster order, codex, icons and translations', (type) => {
    expect(ENEMY_DEFS[type]).toBe(CHAPTER_ENEMY_DEFS[type]);
    expect(ENEMY_MELEE[type]).toBe(CHAPTER_ENEMY_MELEE[type]);
    // Before the two bosses: the bestiary lists them with the other regulars.
    const at = ENEMY_TYPES.indexOf(type);
    expect(at).toBeGreaterThan(-1);
    expect(at).toBeLessThan(ENEMY_TYPES.indexOf('tempest'));
    expect(ENEMY_TYPES.at(-1)).toBe('boss');
    expect(ENEMY_LORE[type].counter).toBeTruthy();
    expect(ENEMY_BADGE_META[type].label).toBeTruthy();
    expect(ENEMY_ICON_SVGS[type]).toContain('<svg');
    expect(DATA_TR.enemies[type]?.name).toBeTruthy();
    expect(DATA_TR.enemies[type]?.counter).toBeTruthy();
  });

  it.each(CHAPTER_ENEMY_TYPES)('%s: own 2D art with down/up/side walk, attack and death sheets on disk', (type) => {
    const key = enemyArtFor(M, type, ENEMY_DEFS[type].flying).art;
    expect(key).toBe(type);
    const art = M.enemies[key];
    expect(art.mode).toBe('sheet');
    const sheet = art.sheet!;
    expect(sheet.side, 'sheet.side').toBeTruthy();
    expect(art.death, 'death').toBeTruthy();
    expect(art.attack, 'attack').toBeTruthy();
    for (const p of [art.file, sheet.down, sheet.up, sheet.side!, art.death!, art.attack!]) {
      expect(onDisk(p), p).toBe(true);
    }
  });

  it('only the chapter enemies (the ones with painted clips) carry side/death sheets today', () => {
    const withDeath = Object.entries(M.enemies).filter(([, a]) => a.death).map(([k]) => k).sort();
    expect(withDeath).toEqual([...CHAPTER_ENEMY_TYPES].sort());
  });
});
