import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i28.json';

const layout2d = parseLevel2D(json);

// The caves join at the capstan bend before the uphill sweep around the quay.
export const I28 = {
  id: 'i28',
  index: 27,
  name: 'Rimeharbor',
  subtitle: 'The pilot can hear the tide beneath the hull. Hold the quays until the ice gives way.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1471,
  startingGold: 405,
  enemyHpScale: 1.98,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'Sounding the Ice', clearBonus: 25, groups: [
      group('grunt', 10, 0.59), group('runner', 7, 0.51, 1.8, 1),
    ] },
    { name: 'White Moorings', clearBonus: 27, groups: [
      group('brute', 4, 1.08, 0, 1), group('mite', 10, 0.29, 0.75),
      group('bellrunner', 5, 0.54, 2.8, 1),
    ] },
    { name: 'Under the Keel', clearBonus: 29, groups: [
      group('flyer', 4, 0.91), group('warden', 3, 1.22, 0.75, 1),
      group('runner', 10, 0.5, 2.8),
    ] },
    { name: 'The Harbour Chain', clearBonus: 31, groups: [
      group('kilnback', 4, 1.06, 0, 1), group('reedpiper', 2, 1.4, 0.75),
      group('burrower', 6, 0.82, 2.8, 1),
    ] },
    { name: 'Black Soundings', clearBonus: 32, groups: [
      group('splitter', 6, 0.78), group('bellrunner', 9, 0.53, 0.75, 1),
      group('healer', 2, 1.36, 2.8),
    ] },
    { name: 'Piled Floes', clearBonus: 34, groups: [
      group('golem', 4, 1.17, 0, 1), group('hexer', 3, 1.31, 0.75),
      group('blinker', 6, 0.68, 2.8, 1),
    ] },
    { name: 'The Rope Takes Hold', clearBonus: 36, groups: [
      { ...group('brute', 6, 1.02), elite: true }, group('reedpiper', 3, 1.35, 0.75, 1),
      group('carrier', 2, 2.38, 2.8),
    ] },
    { name: 'Thin Water', clearBonus: 38, groups: [
      { ...group('warden', 5, 1.15, 0, 1), elite: true }, group('burrower', 8, 0.78, 0.75),
      group('flyer', 5, 0.86, 2.8, 1),
    ] },
    { name: 'A Spar Goes Over', clearBonus: 39, groups: [
      { ...group('kilnback', 6, 1.0), elite: true }, group('healer', 3, 1.3, 0.75, 1),
      group('runner', 13, 0.47, 2.8),
    ] },
    { name: 'Draw the Hawser', clearBonus: 41, groups: [
      { ...group('splitter', 7, 0.74, 0, 1), elite: true }, group('mite', 18, 0.26, 0.75),
      group('golem', 5, 1.12, 2.8, 1), group('bellrunner', 7, 0.5, 5),
    ] },
    { name: 'Three Knocks', clearBonus: 43, groups: [
      { ...group('burrower', 8, 0.76), elite: true }, group('hexer', 4, 1.24, 0.75, 1),
      group('warden', 5, 1.11, 2.8),
    ] },
    { name: 'Swing the Stern', clearBonus: 46, groups: [
      { ...group('golem', 6, 1.09, 0, 1), elite: true }, group('reedpiper', 4, 1.27, 0.75),
      group('kilnback', 6, 0.97, 2.8, 1), group('blinker', 7, 0.63, 5),
    ] },
    { name: 'An Open Channel', clearBonus: 60, groups: [
      { ...group('kilnback', 8, 0.95), elite: true }, group('healer', 3, 1.23, 0.75, 1),
      { ...group('golem', 3, 1.08, 2.8), elite: true }, { ...group('bellrunner', 10, 0.48, 5, 1), elite: true },
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 10, 'tesla'), build(0, 8, 'barracks'), build(0, 13, 'archer'),
    build(1, 12, 'frost'), build(1, 14, 'ballista'), upgrade(2, 10),
    build(2, 7, 'mortar'), upgrade(3, 13), build(3, 6, 'cannon'),
    upgrade(4, 14), build(4, 2, 'tesla'), upgrade(5, 8),
    build(5, 15, 'ballista'), upgrade(6, 6), build(6, 11, 'archer'),
    upgrade(7, 12), upgrade(7, 10), upgrade(7, 7),
    upgrade(7, 2), upgrade(8, 15), upgrade(8, 14),
    upgrade(8, 13), upgrade(9, 11), upgrade(9, 6),
    upgrade(9, 8), upgrade(10, 12), upgrade(10, 7),
    upgrade(10, 2), upgrade(11, 15), upgrade(11, 11),
  ],
  weakBuildOrder: [
    build(0, 10, 'tesla'), build(0, 8, 'barracks'), build(0, 13, 'archer'),
    build(1, 14, 'ballista'), upgrade(2, 10), build(2, 7, 'mortar'),
    upgrade(3, 13), build(3, 6, 'cannon'), upgrade(4, 14),
    upgrade(5, 8), build(5, 15, 'ballista'), upgrade(6, 6),
    upgrade(7, 10), upgrade(7, 7), upgrade(8, 15),
    upgrade(8, 14), upgrade(8, 13), upgrade(9, 6),
    upgrade(9, 8), upgrade(10, 7), upgrade(11, 15),
  ],
} satisfies ChapterIsland;
