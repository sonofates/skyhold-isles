import { existsSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { chapterOf } from '../../src/data/chapters.ts';
import { CHAPTER_ENEMY_TYPES } from '../../src/data/enemies.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { CHAPTER4_ISLANDS } from '../../src/data/levels2d/chapter4.ts';
import { NEW_ISLANDS } from '../../src/data/levels2d/newIslands.ts';
import { islandName, islandSubtitle, islandWaveTitle } from '../../src/i18n/data.ts';
import { setLocale } from '../../src/i18n/index.ts';
import { storyBeats } from '../../src/render2d/ui/storyBeats.ts';

afterEach(() => setLocale('en'));

it.each(NEW_ISLANDS)('$id has a Master encounter using its chapter roster and both gates', level => {
  const { id, waves } = level;
  expect(LEVELS_2D.filter(l => l.id === id)).toEqual([level]);
  expect(level.difficulty).toBe('Master');
  expect(waves.length).toBeGreaterThanOrEqual(id === 'i27' ? 13 : 12);
  expect(waves.length).toBeLessThanOrEqual(id === 'i27' ? 14 : 13);
  const groupTypes = waves.flatMap(w => w.groups.map(g => g.enemyType));
  const chapter = LEVELS_2D.filter(l => id === 'i27' ? /^i(1[7-9]|2[0-4])$/.test(l.id) : /^i1[0-6]$/.test(l.id));
  const roster = new Set(chapter.flatMap(l => l.waves.flatMap(w => w.groups.map(g => g.enemyType))));
  for (const type of groupTypes) expect(roster.has(type)).toBe(true);
  for (const type of CHAPTER_ENEMY_TYPES) expect(groupTypes.includes(type)).toBe(id === 'i27');
  expect(new Set(waves.flatMap(w => w.groups.map(g => g.lane)))).toEqual(new Set([0, 1]));
});

it.each(CHAPTER4_ISLANDS)('$id uses its shipping chapter roster, wave count and ground lanes', level => {
  const roster = new Set(LEVELS_2D.filter(l => ['ch1', 'ch2', 'ch3'].includes(chapterOf(l.id)?.id ?? ''))
    .flatMap(l => l.waves.flatMap(w => w.groups.map(g => g.enemyType))));
  expect(LEVELS_2D.filter(l => l.id === level.id)).toEqual([level]);
  expect(level.difficulty).toBe('Master');
  const secondBatch = ['i31', 'i32', 'i33'].includes(level.id);
  if (secondBatch) {
    roster.add('rimebeetle');
    roster.add('sledguard');
  }
  expect(level.waves).toHaveLength(secondBatch ? 14 : 13);
  const groups = level.waves.flatMap(w => w.groups);
  for (const g of groups) expect(roster.has(g.enemyType), g.enemyType).toBe(true);
  expect(new Set(groups.map(g => g.lane))).toEqual(new Set(level.id === 'i32' ? [0] : [0, 1]));
});

it.each([...NEW_ISLANDS, ...CHAPTER4_ISLANDS])('$id has distinct localized wave names and both illustrated story beats', level => {
  const titles = () => level.waves.map((_, i) => islandWaveTitle(level, i));
  const english = titles();
  expect(english).toEqual(level.waves.map(w => w.name));
  const parts = ['intro', 'outro'] as const;
  const story = parts.map(part => storyBeats(level, part)[0]);
  setLocale('tr');
  expect(islandName(level)).not.toBe(level.name);
  expect(islandSubtitle(level)).not.toBe(level.subtitle);
  const turkish = titles();
  expect(new Set(turkish).size).toBe(level.waves.length);
  for (const [i, title] of turkish.entries()) {
    expect(title).toBeTruthy();
    expect(title).not.toBe(english[i]);
  }
  for (const [i, part] of parts.entries()) {
    const translated = storyBeats(level, part)[0];
    expect(translated.text).not.toBe(story[i].text);
    expect(translated.art).toBe(story[i].art);
    expect(existsSync('public' + translated.art)).toBe(true);
  }
});
