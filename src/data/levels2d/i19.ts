import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i19.json';

const layout2d = parseLevel2D(json);

// Moths cross the crown above the root roads and rejoin the ground convoy near the eastern bend.
export const I19 = {
  id: 'i19',
  index: 18,
  name: 'Lanternseed Fig',
  subtitle: 'The seed baskets are falling. Follow the two root roads around the old fig tree.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1019,
  startingGold: 365,
  enemyHpScale: 1.18,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'A Torn Basket', clearBonus: 24, groups: [
      group('bellrunner', 5, 0.77),
      group('mite', 14, 0.32, 1.8, 1),
    ] },
    { name: 'Under the Roots', clearBonus: 25, groups: [
      group('burrower', 4, 0.95, 0, 1),
      group('grunt', 12, 0.55, 1.8),
      group('bellrunner', 5, 0.56, 4, 1),
    ] },
    { name: 'Wings in the Crown', clearBonus: 27, groups: [
      group('draftwing', 6, 0.65),
      group('reedpiper', 2, 2.4, 0.6, 1),
      group('brute', 6, 0.86, 1.2, 1),
    ] },
    { name: 'Bark and Clay', clearBonus: 29, groups: [
      group('kilnback', 4, 1.15),
      group('healer', 2, 1.6, 0.8),
      group('splitter', 5, 0.86, 2, 1),
    ] },
    { name: 'The High Bough', clearBonus: 31, groups: [
      group('runner', 15, 0.35, 0, 1),
      group('draftwing', 8, 0.54, 1.8),
      group('blinker', 5, 0.7, 4),
    ] },
    { name: 'The Low Bough', clearBonus: 34, groups: [
      group('warden', 3, 1.35, 0, 1),
      { ...group('kilnback', 6, 0.94, 0.8, 1), elite: true },
      group('reedpiper', 3, 1.6, 1.4, 1),
      group('bellrunner', 11, 0.42, 3.5),
    ] },
    { name: 'Rope Ladder', clearBonus: 36, groups: [
      group('carrier', 2, 2.8),
      group('golem', 5, 1.27, 0.9),
      group('mite', 22, 0.2, 2.5, 1),
      group('draftwing', 5, 0.46, 5.8),
    ] },
    { name: 'A Hollow Branch', clearBonus: 38, groups: [
      { ...group('burrower', 8, 0.75), elite: true },
      group('splitter', 9, 0.62, 0.8, 1),
      group('hexer', 4, 1.18, 2, 1),
    ] },
    { name: 'Windfall', clearBonus: 40, groups: [
      { ...group('bellrunner', 12, 0.42, 0, 1), elite: true },
      group('warden', 3, 1.46),
      group('kilnback', 8, 0.78, 1.6),
      group('draftwing', 6, 0.5, 4.8),
    ] },
    { name: 'Thick Roots', clearBonus: 43, groups: [
      { ...group('golem', 5, 1.28, 0, 1), elite: true },
      group('healer', 3, 1.1, 1, 1),
      group('reedpiper', 3, 1.4, 2.1, 1),
      group('blinker', 9, 0.62, 3.7),
    ] },
    { name: 'Last Light in the Figs', clearBonus: 60, groups: [
      { ...group('kilnback', 6, 0.91), elite: true },
      group('bellrunner', 14, 0.39, 1, 1),
      group('reedpiper', 4, 1.29, 1.2),
      { ...group('splitter', 7, 0.82, 3.1, 1), elite: true },
      group('draftwing', 7, 0.49, 5.4),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 9, 'tesla'), build(0, 15, 'barracks'), build(0, 8, 'archer'),
    build(1, 16, 'cannon'), build(1, 0, 'frost'), upgrade(2, 9),
    build(2, 11, 'archer'), build(3, 7, 'ballista', 'strongest'), upgrade(3, 16),
    build(4, 10, 'mortar'), upgrade(4, 8), build(5, 6, 'tesla'),
    upgrade(5, 7), upgrade(6, 9), build(6, 14, 'ballista'),
    upgrade(7, 0), upgrade(7, 15), upgrade(8, 16), upgrade(8, 6),
    upgrade(9, 14), upgrade(9, 7), upgrade(10, 11), upgrade(10, 10), upgrade(10, 8), upgrade(10, 6),
  ],
  weakBuildOrder: [
    build(0, 2, 'archer'), build(0, 12, 'cannon'), build(0, 6, 'archer'),
    build(1, 5, 'frost'), build(2, 13, 'cannon'), build(3, 3, 'archer'),
    build(4, 10, 'ballista'), upgrade(4, 2), upgrade(5, 12), upgrade(6, 6),
    upgrade(7, 5), upgrade(8, 13),
  ],
} satisfies ChapterIsland;
