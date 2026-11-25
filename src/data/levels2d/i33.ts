import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i33.json';

const layout2d = parseLevel2D(json);

export const I33 = {
  id: 'i33',
  index: 32,
  name: 'Stillfall Cascade',
  subtitle: 'Water is backing up behind the ice curtain. Guard both cave shelves until the sluice tender can drain the basin.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1586,
  startingGold: 445,
  enemyHpScale: 1.96,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'Hollow Ice', clearBonus: 25, groups: [
      group('bellrunner', 8, 0.53), group('rimebeetle', 6, 0.91, 1.8, 1),
    ] },
    { name: 'Copper Bob', clearBonus: 27, groups: [
      group('brute', 5, 1.01, 0, 1), group('sledguard', 3, 1.47, 1),
    ] },
    { name: 'Beneath the Lip', clearBonus: 29, groups: [
      group('burrower', 7, 0.82), group('draftwing', 4, 0.92, 1, 1),
      group('healer', 2, 1.35, 3.2),
    ] },
    { name: 'Two Echoes', clearBonus: 31, groups: [
      group('sledguard', 4, 1.47, 0, 1), group('reedpiper', 3, 1.37, 1),
      group('mite', 12, 0.29, 3.2, 1),
    ] },
    { name: 'Blind Pool', clearBonus: 32, groups: [
      group('rimebeetle', 7, 0.91), group('blinker', 8, 0.71, 1, 1),
      group('kilnback', 5, 1.05, 3.2),
    ] },
    { name: 'Gauge Marks', clearBonus: 34, groups: [
      { ...group('warden', 5, 1.14, 0, 1), elite: true }, group('bellrunner', 10, 0.53, 1),
      group('hexer', 3, 1.31, 3.2, 1),
    ] },
    { name: 'Ice Teeth', clearBonus: 36, groups: [
      { ...group('rimebeetle', 8, 0.9), elite: true }, group('golem', 5, 1.16, 1, 1),
      group('runner', 12, 0.52, 3.2),
    ] },
    { name: 'Rippling Stone', clearBonus: 38, groups: [
      { ...group('sledguard', 5, 1.45, 0, 1), elite: true }, group('carrier', 2, 2.27, 1),
      group('burrower', 7, 0.81, 3.2, 1),
    ] },
    { name: 'Back Pressure', clearBonus: 39, groups: [
      { ...group('kilnback', 7, 1.02), elite: true }, group('reedpiper', 4, 1.34, 1, 1),
      group('rimebeetle', 8, 0.89, 3.2),
    ] },
    { name: 'Cave Breath', clearBonus: 41, groups: [
      group('sledguard', 6, 1.42, 0, 1), group('healer', 4, 1.31, 1),
      // Spread the island's pressure (docs/handoff-ch4-final.md): a heavy moth flight over the falls.
      { ...group('draftwing', 8, 0.89, 3.2, 1), hpScale: 2.5 },
    ] },
    { name: 'The Wheel Sticks', clearBonus: 43, groups: [
      { ...group('brute', 8, 0.97), elite: true, hpScale: 1.3 }, group('hexer', 4, 1.26, 1, 1),
      group('blinker', 9, 0.68, 3.2),
    ] },
    { name: 'First Seep', clearBonus: 45, groups: [
      { ...group('splitter', 8, 0.74, 0, 1), elite: true }, group('rimebeetle', 8, 0.52, 1),
      { ...group('golem', 6, 1.11, 3.2, 1), hpScale: 1.25 },
    ] },
    { name: 'Open the Sluice', clearBonus: 46, groups: [
      { ...group('sledguard', 6, 1.39), elite: true }, { ...group('kilnback', 7, 0.99, 1, 1), hpScale: 1.2 },
      group('bellrunner', 12, 0.5, 3.2),
    ] },
    { name: 'Water Below', clearBonus: 60, groups: [
      { ...group('kilnback', 8, 0.98, 0, 1), elite: true, hpScale: 3.5 }, group('golem', 5, 1.1, 8),
      group('rimebeetle', 8, 0.85, 6.2, 1), group('sledguard', 4, 1.38, 12.4),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 13, 'tesla'), build(0, 12, 'barracks'), build(0, 11, 'archer'),
    build(1, 7, 'frost'), build(1, 14, 'ballista'), upgrade(2, 13),
    build(2, 5, 'mortar'), upgrade(3, 11), build(3, 6, 'cannon'),
    upgrade(4, 14), build(4, 4, 'tesla'), upgrade(5, 12),
    build(5, 15, 'ballista'), upgrade(6, 6), build(6, 0, 'archer'),
    upgrade(7, 7), upgrade(7, 13), upgrade(7, 5),
    upgrade(7, 4), upgrade(8, 15), upgrade(8, 14),
    upgrade(8, 11), upgrade(9, 0), upgrade(9, 6),
    upgrade(9, 12), upgrade(10, 7), upgrade(10, 5),
    upgrade(10, 4), upgrade(11, 15), upgrade(11, 0),
  ],
  weakBuildOrder: [
    build(0, 0, 'tesla'), build(0, 12, 'barracks'), build(0, 11, 'archer'),
    build(1, 7, 'frost'), build(1, 14, 'ballista'), upgrade(2, 0),
    upgrade(3, 11), upgrade(4, 14), build(4, 4, 'tesla'),
    upgrade(5, 12), build(5, 15, 'ballista'), upgrade(7, 7),
    upgrade(7, 0), upgrade(7, 4), upgrade(8, 15),
    upgrade(8, 14), upgrade(8, 11), upgrade(9, 12),
    upgrade(10, 7), upgrade(10, 4), upgrade(11, 15),
  ],
} satisfies ChapterIsland;
