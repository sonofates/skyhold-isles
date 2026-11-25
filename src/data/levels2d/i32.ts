import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i32.json';

const layout2d = parseLevel2D(json);

export const I32 = {
  id: 'i32',
  index: 31,
  name: 'Auroral Orrery',
  subtitle: 'The great lens has slipped off its meridian. Guard the winding instrument road while the lens grinder brings it back into focus.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1563,
  startingGold: 415,
  enemyHpScale: 2.95,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'Parallax', clearBonus: 25, groups: [
      group('rimebeetle', 7, 0.91), group('runner', 11, 0.52, 1.8),
    ] },
    { name: 'Bronze Limb', clearBonus: 27, groups: [
      group('sledguard', 4, 1.47), group('bellrunner', 8, 0.53, 1),
    ] },
    { name: 'Green Glass', clearBonus: 29, groups: [
      group('blinker', 8, 0.71), group('draftwing', 4, 0.92, 1),
      group('healer', 2, 1.35, 3.2),
    ] },
    { name: 'The Outer Ring', clearBonus: 31, groups: [
      group('kilnback', 6, 1.05), group('rimebeetle', 6, 0.91, 1),
      group('hexer', 3, 1.31, 3.2),
    ] },
    { name: 'Night Watch', clearBonus: 32, groups: [
      group('carrier', 2, 2.31), group('sledguard', 4, 1.47, 1),
      group('mite', 14, 0.29, 3.2),
    ] },
    { name: 'Transit Mark', clearBonus: 34, groups: [
      { ...group('golem', 5, 1.17), elite: true }, group('bellrunner', 11, 0.53, 1),
      group('reedpiper', 3, 1.37, 3.2),
    ] },
    { name: 'Shutter Teeth', clearBonus: 36, groups: [
      { ...group('rimebeetle', 7, 0.9), elite: true }, group('burrower', 8, 0.81, 1),
      group('warden', 5, 1.13, 3.2),
    ] },
    { name: 'Slow Orbit', clearBonus: 38, groups: [
      { ...group('brute', 7, 0.99), elite: true }, group('draftwing', 5, 0.91, 1),
      group('healer', 3, 1.33, 3.2),
    ] },
    { name: 'Smoked Filter', clearBonus: 39, groups: [
      group('sledguard', 7, 1.43), group('kilnback', 7, 1.02, 1),
      group('blinker', 9, 0.69, 3.2),
    ] },
    { name: 'Counterturn', clearBonus: 41, groups: [
      { ...group('splitter', 8, 0.76), elite: true }, group('hexer', 4, 1.27, 1),
      group('runner', 15, 0.5, 3.2),
    ] },
    { name: 'First Refraction', clearBonus: 43, groups: [
      { ...group('sledguard', 6, 1.41), elite: true }, group('rimebeetle', 8, 0.87, 1),
      group('reedpiper', 4, 1.32, 3.2),
    ] },
    { name: 'Fine Adjustment', clearBonus: 45, groups: [
      { ...group('kilnback', 8, 1.0), elite: true }, group('golem', 6, 1.11, 1),
      group('draftwing', 5, 0.88, 3.2),
    ] },
    { name: 'Two Images', clearBonus: 46, groups: [
      { ...group('burrower', 10, 0.77), elite: true }, group('sledguard', 6, 1.39, 1),
      group('bellrunner', 13, 0.5, 3.2),
    ] },
    { name: 'True Meridian', clearBonus: 60, groups: [
      group('golem', 6, 1.1), { ...group('sledguard', 7, 1.38, 1), elite: true, hpScale: 2.8 },
      group('rimebeetle', 8, 0.85, 10.2), group('blinker', 8, 0.66, 12.4),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 3, 'tesla'), build(0, 16, 'barracks'), build(0, 14, 'archer'),
    build(1, 7, 'frost'), build(1, 11, 'ballista'), upgrade(2, 3),
    build(2, 4, 'mortar'), upgrade(3, 14), build(3, 15, 'cannon'),
    upgrade(4, 11), build(4, 6, 'tesla'), upgrade(5, 16),
    build(5, 2, 'ballista'), upgrade(6, 15), build(6, 10, 'archer'),
    upgrade(7, 7), upgrade(7, 3), upgrade(7, 4),
    upgrade(7, 6), upgrade(8, 2), upgrade(8, 11),
    upgrade(8, 14), upgrade(9, 10), upgrade(9, 15),
    upgrade(9, 16), upgrade(10, 7), upgrade(10, 4),
    upgrade(10, 6), upgrade(11, 2), upgrade(11, 10),
  ],
  weakBuildOrder: [
    build(0, 3, 'tesla'), build(0, 16, 'barracks'), build(0, 14, 'archer'),
    build(1, 7, 'frost'), build(1, 11, 'ballista'), upgrade(2, 3),
    upgrade(3, 14), upgrade(4, 11), build(4, 6, 'tesla'),
    upgrade(5, 16), build(5, 2, 'ballista'), upgrade(7, 7),
    upgrade(7, 3), upgrade(7, 6), upgrade(8, 2),
    upgrade(8, 11), upgrade(8, 14), upgrade(9, 16),
    upgrade(10, 7), upgrade(10, 6), upgrade(11, 2),
  ],
} satisfies ChapterIsland;
