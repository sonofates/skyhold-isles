import { existsSync } from 'node:fs';
import manifest from '../../public/art2d/manifest.json';
import { afterEach, expect, it } from 'vitest';
import { chapterOf } from '../../src/data/chapters.ts';
import { CHAPTER_ENEMY_TYPES } from '../../src/data/enemies.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { CHAPTER4_ISLANDS } from '../../src/data/levels2d/chapter4.ts';
import { CHAPTER5_ISLANDS } from '../../src/data/levels2d/chapter5.ts';
import { NEW_ISLANDS } from '../../src/data/levels2d/newIslands.ts';
import { islandName, islandSubtitle, islandWaveTitle } from '../../src/i18n/data.ts';
import { setLocale } from '../../src/i18n/index.ts';
import { seenFromCleared, waveTypes } from '../../src/render2d/ui/newFoes2d.ts';
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

// i28 opens the chapter with the older roster only; the Rime Beetle joins from i29
// (docs/handoff-ch4-waves-1.md) and the Sledge Warden from i31 (docs/handoff-ch4-isles-2.md).
it.each(CHAPTER4_ISLANDS)('$id uses its shipping chapter roster, wave count and ground lanes', level => {
  const roster = new Set<string>(LEVELS_2D.filter(l => ['ch1', 'ch2', 'ch3'].includes(chapterOf(l.id)?.id ?? ''))
    .flatMap(l => l.waves.flatMap(w => w.groups.map(g => g.enemyType))));
  if (level.id !== 'i28') roster.add('rimebeetle');
  expect(LEVELS_2D.filter(l => l.id === level.id)).toEqual([level]);
  expect(level.difficulty).toBe('Master');
  const thirteenWaves = ['i28', 'i29', 'i30'].includes(level.id);
  if (!thirteenWaves) roster.add('sledguard');
  if (level.id === 'i36') roster.add('glacier_warden');
  const fifteenWaves = ['i35', 'i36'].includes(level.id);
  expect(level.waves).toHaveLength(thirteenWaves ? 13 : fifteenWaves ? 15 : 14);
  const groups = level.waves.flatMap(w => w.groups);
  for (const g of groups) expect(roster.has(g.enemyType), g.enemyType).toBe(true);
  expect(new Set(groups.map(g => g.lane))).toEqual(new Set(level.layout2d.entrances.map((_, lane) => lane)));
});

// i37 opens the chapter with the older roster only; the Dusk Hound joins from i38 (docs/handoff-ch5-waves-1.md).
it.each(CHAPTER5_ISLANDS)('$id uses established foes across all its ground lanes', level => {
  const roster = new Set<string>(LEVELS_2D.filter(l => chapterOf(l.id)?.id !== 'ch5')
    .flatMap(l => l.waves.flatMap(w => w.groups.map(g => g.enemyType))));
  if (level.id !== 'i37') roster.add('duskhound');
  const groups = level.waves.flatMap(w => w.groups);
  expect(level.difficulty).toBe('Master');
  const secondBatch = ['i40', 'i41', 'i42'].includes(level.id);
  if (level.id !== 'i37') roster.add('duskhound');
  if (secondBatch) {
    roster.add('veilcaster');
    expect(groups.some(g => g.enemyType === 'veilcaster')).toBe(true);
  }
  expect(level.waves).toHaveLength(secondBatch ? 15 : 14);
  const chart: Record<string, string> = manifest.paintedUi;
  expect(chart[`island-${level.id}`]).toBe(`ui/island-${level.id}.webp`);
  expect(existsSync('public/art2d/' + chart[`island-${level.id}`])).toBe(true);
  for (const g of groups) expect(roster.has(g.enemyType), g.enemyType).toBe(true);
  expect(new Set(groups.map(g => g.lane))).toEqual(new Set(level.layout2d.paths.map((_, i) => i)));
});

it('shows the Veilcaster as the sole new foe on the opening crater card', () => {
  const crater = LEVELS_2D.find(l => l.id === 'i40')!;
  const seen = seenFromCleared(LEVELS_2D.slice(0, LEVELS_2D.indexOf(crater)), () => true);
  expect(waveTypes(crater, 0).filter(type => !seen.has(type))).toEqual(['veilcaster']);
});

it.each([...NEW_ISLANDS, ...CHAPTER4_ISLANDS, ...CHAPTER5_ISLANDS])('$id has distinct localized wave names and both illustrated story beats', level => {
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
