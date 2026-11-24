import { existsSync } from 'node:fs';
import { afterEach, expect, it } from 'vitest';
import { CHAPTER_ENEMY_TYPES } from '../../src/data/enemies.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
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

it.each(NEW_ISLANDS)('$id has distinct localized wave names and both illustrated story beats', level => {
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
