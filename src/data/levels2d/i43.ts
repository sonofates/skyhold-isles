import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i43.json';

const layout2d = parseLevel2D(json);

export const I43 = {
  id: 'i43',
  index: 42,
  name: 'The First Forge',
  subtitle: 'Follow the cooling channels around the first anvil. Hold the casting floor until the sky-nail takes its shape.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1788,
  startingGold: 425,
  enemyHpScale: 3.22,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'Hammer Scale', clearBonus: 25, groups: [
      group('duskhound', 5, 0.42), group('warden', 3, 1.3, 3),
    ] },
    { name: 'First Heat', clearBonus: 27, groups: [
      group('kilnback', 4, 1.2), group('veilcaster', 2, 1.65, 2),
    ] },
    { name: 'The Swage Block', clearBonus: 29, groups: [
      group('brute', 5, 1.1), group('draftwing', 4, 0.95, 4),
    ] },
    { name: 'Charcoal Dogs', clearBonus: 31, groups: [
      group('duskhound', 5, 0.38), group('duskhound', 5, 0.39, 5), group('reedpiper', 2, 1.4, 3),
    ] },
    { name: 'Under the Tongs', clearBonus: 33, groups: [
      group('splitter', 6, 0.84), group('burrower', 5, 0.81, 3),
    ] },
    { name: 'Drawing Out', clearBonus: 35, groups: [
      group('sledguard', 5, 1.38), group('veilcaster', 3, 1.42, 2), group('grunt', 8, 0.68, 5),
    ] },
    { name: 'Hot Rivets', clearBonus: 37, groups: [
      group('carrier', 2, 2.2), group('bellrunner', 9, 0.5, 2), group('kilnback', 5, 1.1, 4),
    ] },
    { name: 'Copper Ladles', clearBonus: 39, groups: [
      group('golem', 3, 1.35), group('healer', 3, 1.48, 1), group('duskhound', 6, 0.39, 4),
    ] },
    { name: 'Cherry Red', clearBonus: 41, groups: [
      group('blinker', 8, 0.68), group('veilcaster', 4, 1.34, 2), group('brute', 6, 1.1, 4),
    ] },
    { name: 'The Long Horn', clearBonus: 43, groups: [
      group('kilnback', 7, 1.06), group('draftwing', 5, 0.92, 3), group('hexer', 3, 1.35, 4),
    ] },
    { name: 'A Bent Nail', clearBonus: 45, groups: [
      group('duskhound', 5, 0.38), group('sledguard', 5, 1.44, 2), group('duskhound', 6, 0.38, 6),
    ] },
    { name: 'Founders at the Fire', clearBonus: 47, groups: [
      { ...group('golem', 2, 1.4), elite: true, hpScale: 3.6 }, { ...group('veilcaster', 3, 1.3, 2), hpScale: 1.5 },
      group('bellrunner', 9, 0.51, 5),
    ] },
    { name: 'Cold Shut', clearBonus: 49, groups: [
      group('splitter', 7, 0.82), group('burrower', 8, 0.77, 2), group('healer', 3, 1.4, 4),
    ] },
    { name: 'White Heat', clearBonus: 51, groups: [
      { ...group('kilnback', 4, 1.12), elite: true, hpScale: 2.7 }, group('reedpiper', 3, 1.36, 2),
      group('duskhound', 6, 0.41, 4),
    ] },
    { name: 'Strike the Sky-Nail', clearBonus: 60, groups: [
      { ...group('sledguard', 5, 1.39), elite: true, hpScale: 3.4 }, group('veilcaster', 4, 1.42, 3),
      group('duskhound', 6, 0.38, 5),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 9, 'tesla'), build(0, 10, 'barracks'), build(0, 5, 'archer'),
    build(1, 13, 'frost'), build(1, 3, 'ballista'), upgrade(2, 9),
    build(2, 16, 'mortar'), upgrade(3, 5), build(3, 0, 'cannon'),
    upgrade(4, 3), build(4, 7, 'tesla'), upgrade(5, 10),
    build(5, 14, 'ballista'), upgrade(6, 0), build(6, 2, 'archer'),
    upgrade(7, 13), upgrade(7, 9), upgrade(7, 16),
    upgrade(7, 7), upgrade(8, 14), upgrade(8, 3),
    upgrade(8, 5), upgrade(9, 2), upgrade(9, 0),
    upgrade(9, 10), upgrade(10, 13), upgrade(10, 16),
    upgrade(10, 7), upgrade(11, 14), upgrade(11, 2),
  ],
  weakBuildOrder: [
    build(0, 8, 'tesla'), build(0, 11, 'barracks'), build(0, 1, 'archer'),
    build(1, 13, 'frost'), build(1, 3, 'ballista'), upgrade(2, 8),
    upgrade(3, 1), upgrade(4, 3), build(4, 7, 'tesla'),
    upgrade(5, 11), build(5, 14, 'ballista'), upgrade(7, 13),
    upgrade(7, 8), upgrade(7, 7), upgrade(8, 14),
    upgrade(8, 3), upgrade(8, 1), upgrade(9, 11),
    upgrade(10, 13), upgrade(10, 7), upgrade(11, 14),
  ],
} satisfies ChapterIsland;
