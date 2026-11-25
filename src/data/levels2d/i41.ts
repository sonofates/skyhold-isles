import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i41.json';

const layout2d = parseLevel2D(json);

export const I41 = {
  id: 'i41',
  index: 40,
  name: 'Sundial Ruins',
  subtitle: 'Twin processions circle the broken dial. Hold the west arcade where the hour roads meet.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1706,
  startingGold: 425,
  enemyHpScale: 1.7,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'First Reading', clearBonus: 25, groups: [
      group('warden', 3, 1.3), group('duskhound', 5, 0.5, 2, 1),
    ] },
    { name: 'East Niches', clearBonus: 27, groups: [
      group('veilcaster', 2, 1.8, 0, 1), group('bellrunner', 8, 0.54), group('grunt', 6, 0.77, 4, 1),
    ] },
    { name: 'Brass Sights', clearBonus: 29, groups: [
      group('splitter', 5, 1.1), group('draftwing', 4, 1, 3), group('reedpiper', 3, 1.43, 3, 1),
    ] },
    { name: 'Short Hour', clearBonus: 30, groups: [
      group('burrower', 6, 0.84, 0, 1), group('kilnback', 4, 1.23), group('healer', 2, 1.45, 4),
    ] },
    { name: 'Moss on the Scale', clearBonus: 32, groups: [
      group('duskhound', 5, 0.41), group('duskhound', 5, 0.41, 4, 1), group('veilcaster', 3, 1.51, 2),
    ] },
    { name: 'Twilight Measure', clearBonus: 34, groups: [
      group('sledguard', 4, 1.39, 0, 1), group('blinker', 8, 0.75), group('mite', 10, 0.36, 5, 1),
    ] },
    { name: 'Missing Marker', clearBonus: 36, groups: [
      group('brute', 5, 1.12), group('hexer', 3, 1.4, 1, 1), group('carrier', 2, 2.35, 5),
    ] },
    { name: 'Shadow at Noon', clearBonus: 38, groups: [
      group('splitter', 7, 0.88, 0, 1), group('burrower', 7, 0.83, 2), group('healer', 3, 1.39, 5, 1),
    ] },
    { name: 'Half a Turn', clearBonus: 39, groups: [
      group('kilnback', 5, 1.22), group('reedpiper', 4, 1.29, 2, 1), group('draftwing', 5, 0.96, 5),
    ] },
    { name: 'A Blind Minute', clearBonus: 41, groups: [
      group('duskhound', 6, 0.39, 0, 1), group('veilcaster', 4, 1.35, 1), group('duskhound', 6, 0.39, 5),
    ] },
    // The elite warden pair holds back until the last third (chapter-5 final balance).
    { name: 'Broken Graduation', clearBonus: 43, groups: [
      { ...group('warden', 2, 1.21, 0, 1), elite: true, hpScale: 2 }, group('veilcaster', 3, 1.33), group('runner', 9, 0.54, 3, 1),
    ] },
    { name: 'Counterweight Stones', clearBonus: 45, groups: [
      { ...group('kilnback', 3, 1.19, 0, 1), elite: true, hpScale: 3.1 }, group('sledguard', 4, 1.32), group('bellrunner', 9, 0.51, 5),
    ] },
    { name: 'Low Sun', clearBonus: 47, groups: [
      group('blinker', 8, 0.72), group('veilcaster', 4, 1.34, 0, 1), group('warden', 5, 1.13, 4),
    ] },
    { name: 'Twin Shadows', clearBonus: 49, groups: [
      group('duskhound', 6, 0.37), group('duskhound', 6, 0.39, 1, 1), group('brute', 6, 1.08, 3, 1), group('healer', 3, 1.44, 5),
    ] },
    { name: 'The Fifteenth Hour', clearBonus: 60, groups: [
      { ...group('golem', 3, 1.17, 0, 1), elite: true, hpScale: 2.9 }, group('veilcaster', 3, 1.28, 1), group('splitter', 6, 0.82, 5),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 14, 'tesla'), build(0, 3, 'barracks'), build(0, 13, 'archer'),
    build(1, 12, 'frost'), build(1, 1, 'ballista'), upgrade(2, 14),
    build(2, 15, 'mortar'), upgrade(3, 13), build(3, 8, 'cannon'),
    upgrade(4, 1), build(4, 2, 'tesla'), upgrade(5, 3),
    build(5, 16, 'ballista'), upgrade(6, 8), build(6, 4, 'archer'),
    upgrade(7, 12), upgrade(7, 14), upgrade(7, 15),
    upgrade(7, 2), upgrade(8, 16), upgrade(8, 1),
    upgrade(8, 13), upgrade(9, 4), upgrade(9, 8),
    upgrade(9, 3), upgrade(10, 12), upgrade(10, 15),
    upgrade(10, 2), upgrade(11, 16), upgrade(11, 4),
  ],
  weakBuildOrder: [
    build(0, 0, 'tesla'), build(0, 5, 'barracks'), build(0, 7, 'archer'),
    build(1, 6, 'frost'), build(1, 1, 'ballista'), upgrade(2, 0),
    upgrade(3, 7), upgrade(4, 1), build(4, 4, 'tesla'),
    upgrade(5, 5), build(5, 8, 'ballista'), upgrade(7, 6),
    upgrade(7, 0), upgrade(7, 4), upgrade(8, 8),
    upgrade(8, 1), upgrade(8, 7), upgrade(9, 5),
    upgrade(10, 6), upgrade(10, 4), upgrade(11, 8),
  ],
} satisfies ChapterIsland;
