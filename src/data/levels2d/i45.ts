import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i45.json';

const layout2d = parseLevel2D(json);

export const I45 = {
  id: 'i45',
  index: 44,
  name: 'Eclipse Throne',
  subtitle: 'Hold the three gates of the throne terrace. If the Sovereign or either Shadow Half reaches the keep, Skyhold falls.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1870,
  startingGold: 425,
  enemyHpScale: 1.8,
  waveHpGrowth: 0.1,
  defeatOnStoryLeak: ['eclipse_sovereign', 'eclipse_shade'],
  waves: [
    { name: 'Steps of Basalt', clearBonus: 25, groups: [
      group('warden', 4, 1.2), group('duskhound', 5, 0.41, 2, 1),
    ] },
    { name: 'Torn Standards', clearBonus: 27, groups: [
      group('veilcaster', 2, 1.44, 0, 2), group('grunt', 8, 0.67, 2), group('runner', 6, 0.52, 4, 1),
    ] },
    { name: 'The Low Postern', clearBonus: 29, groups: [
      group('duskhound', 5, 0.42, 0, 2), group('kilnback', 4, 1.16), group('duskhound', 5, 0.42, 5, 1),
    ] },
    { name: 'Copper Trumpets', clearBonus: 31, groups: [
      group('reedpiper', 3, 1.42, 0, 1), group('draftwing', 4, 0.94, 2), group('brute', 5, 1.1),
    ] },
    { name: 'The Empty Seat', clearBonus: 33, groups: [
      group('sledguard', 5, 1.42), group('burrower', 5, 0.83, 3, 1),
    ] },
    { name: 'Across the Terrace', clearBonus: 35, groups: [
      group('blinker', 7, 0.7, 0, 2), group('veilcaster', 3, 1.43, 2, 1), group('splitter', 5, 0.86),
    ] },
    { name: 'The Broken Ring', clearBonus: 37, groups: [
      group('carrier', 2, 2.21), group('duskhound', 5, 0.4, 2, 1), group('duskhound', 5, 0.4, 6, 2),
    ] },
    { name: 'A Silent Choir', clearBonus: 39, groups: [
      group('healer', 3, 1.41, 0, 1), group('kilnback', 6, 1.06), group('warden', 5, 1.16, 3, 2),
    ] },
    { name: 'The Inner Guard', clearBonus: 41, groups: [
      group('sledguard', 5, 1.4, 0, 1), group('veilcaster', 3, 1.42, 2, 2), group('draftwing', 5, 0.92, 4),
    ] },
    { name: 'Black Marble', clearBonus: 43, groups: [
      group('golem', 4, 1.28), group('burrower', 6, 0.8, 2, 2), group('hexer', 3, 1.4, 4, 1),
    ] },
    { name: 'The Long Procession', clearBonus: 45, groups: [
      { ...group('duskhound', 6, 0.41, 0, 2), elite: true, hpScale: 2.1 }, group('brute', 6, 1.1, 0, 1),
      group('duskhound', 6, 0.4, 6), group('veilcaster', 3, 1.4, 8),
    ] },
    { name: 'Cinders in the Bowl', clearBonus: 47, groups: [
      { ...group('golem', 3, 1.28, 0, 2), elite: true, hpScale: 6.4 }, group('duskhound', 6, 0.4, 4, 1),
      group('reedpiper', 3, 1.36, 5),
    ] },
    { name: 'The Split Seal', clearBonus: 49, groups: [
      group('splitter', 6, 0.84, 0, 1), group('draftwing', 5, 0.91, 2), group('veilcaster', 4, 1.38, 5, 2),
    ] },
    { name: 'Shadow of the Crown', clearBonus: 51, groups: [
      { ...group('sledguard', 3, 1.4, 0, 2), elite: true, hpScale: 6.5 }, group('kilnback', 5, 1.07),
      group('duskhound', 5, 0.39, 4, 1),
    ] },
    { name: 'Totality', clearBonus: 53, groups: [
      group('brute', 5, 1.09, 0, 1), group('blinker', 8, 0.66, 2, 2), group('veilcaster', 3, 1.33, 5),
    ] },
    // The side gates send the vanguard before the Sovereign takes the full procession.
    { name: 'The Eclipse Sovereign', clearBonus: 60, groups: [
      { ...group('eclipse_sovereign', 1, 1, 20), hpScale: 1.35 },
      { ...group('duskhound', 6, 0.4, 12, 2), elite: true, hpScale: 8 }, group('duskhound', 5, 0.4, 5, 1),
      group('veilcaster', 3, 1.34, 8, 1),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 12, 'tesla'), build(0, 14, 'barracks'), build(0, 11, 'archer'),
    build(1, 10, 'frost'), build(1, 3, 'ballista'), upgrade(2, 12),
    build(2, 9, 'mortar'), upgrade(3, 11), build(3, 5, 'cannon'),
    upgrade(4, 3), build(4, 1, 'tesla'), upgrade(5, 14),
    build(5, 13, 'ballista'), upgrade(6, 5), build(6, 6, 'archer'),
    upgrade(7, 10), upgrade(7, 12), upgrade(7, 9),
    upgrade(7, 1), upgrade(8, 13), upgrade(8, 3),
    upgrade(8, 11), upgrade(9, 6), upgrade(9, 5),
    upgrade(9, 14), upgrade(10, 10), upgrade(10, 9),
    upgrade(10, 1), upgrade(11, 13), upgrade(11, 6),
  ],
  weakBuildOrder: [
    build(0, 1, 'tesla'), build(0, 3, 'barracks'), build(0, 2, 'archer'),
    build(1, 5, 'frost'), build(1, 0, 'ballista'), upgrade(2, 1),
    upgrade(3, 2), upgrade(4, 0), build(4, 4, 'tesla'),
    upgrade(5, 3), build(5, 6, 'ballista'), upgrade(7, 5),
    upgrade(7, 1), upgrade(7, 4), upgrade(8, 6),
    upgrade(8, 0), upgrade(8, 2), upgrade(9, 3),
    upgrade(10, 5), upgrade(10, 4), upgrade(11, 6),
  ],
} satisfies ChapterIsland;
