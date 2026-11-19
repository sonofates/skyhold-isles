import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i18.json';

const layout2d = parseLevel2D(json);

// The inner curve sees the quarry train twice. Flyers cut across the loop above the keep.
export const I18 = {
  id: 'i18',
  index: 17,
  name: 'Lantern Glassworks',
  subtitle: 'The kiln fires have gone dark. Follow the ore road around the crystal vault.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 929,
  startingGold: 325,
  enemyHpScale: 1.34,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'The Kiln Walks', clearBonus: 24, groups: [
      group('kilnback', 2, 4.5), group('grunt', 10, 0.7, 1),
    ] },
    { name: 'Hairline Cracks', clearBonus: 25, groups: [
      group('kilnback', 4, 1.2), group('bellrunner', 7, 0.55, 3),
    ] },
    { name: 'A Note Below', clearBonus: 28, groups: [
      group('reedpiper', 2, 3.8), group('runner', 10, 0.45, 0.7),
      group('brute', 4, 1.4, 2.6),
    ] },
    { name: 'Ore Train', clearBonus: 30, groups: [
      group('kilnback', 5, 0.9), group('healer', 2, 1.6, 1.2),
      group('burrower', 5, 0.75, 5.6),
    ] },
    { name: 'Cave Air', clearBonus: 32, groups: [
      group('draftwing', 8, 0.62), group('carrier', 2, 2.2, 1.4),
      group('mite', 16, 0.21, 2.2), group('reedpiper', 2, 2.2, 4.2),
    ] },
    { name: 'Furnace Doors', clearBonus: 35, groups: [
      group('warden', 3, 1.75), group('kilnback', 7, 0.9, 0.4),
      group('splitter', 6, 0.67, 5.4),
    ] },
    { name: 'A Chorus in Stone', clearBonus: 38, groups: [
      group('reedpiper', 4, 1.7), group('bellrunner', 14, 0.38, 0.8),
      group('golem', 4, 1.5, 2),
    ] },
    { name: 'Air Shaft', clearBonus: 40, groups: [
      group('carrier', 2, 1.7), group('draftwing', 6, 0.48, 1.8),
      group('hexer', 4, 1.15, 1), group('brute', 8, 0.8, 4.6),
    ] },
    { name: 'Ringing Clay', clearBonus: 42, groups: [
      { ...group('kilnback', 8, 1.1), elite: true }, group('reedpiper', 3, 1.3, 1.2),
      group('blinker', 7, 0.62, 3.7), group('warden', 3, 1.7, 4.4),
    ] },
    { name: 'Glass Cascade', clearBonus: 44, groups: [
      group('splitter', 10, 0.65), group('draftwing', 7, 0.46, 1.5),
      { ...group('bellrunner', 9, 0.46, 4.2), elite: true }, group('healer', 3, 1.3, 2.1),
    ] },
    { name: 'The Last Firing', clearBonus: 60, groups: [
      { ...group('kilnback', 13, 1.0), elite: true }, group('warden', 4, 1.2, 0.7),
      group('reedpiper', 4, 1.35, 2), { ...group('golem', 5, 1.2, 3.1), elite: true },
      group('bellrunner', 16, 0.36, 6.5),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 2, 'archer'), build(0, 4, 'tesla'), build(0, 19, 'barracks'),
    build(1, 7, 'cannon'), build(2, 3, 'frost'), upgrade(2, 4),
    build(3, 13, 'ballista', 'strongest'), build(3, 17, 'archer'), upgrade(4, 7),
    build(4, 11, 'mortar'), upgrade(5, 2), upgrade(5, 13), build(6, 21, 'tesla'),
    upgrade(6, 4), upgrade(7, 19), build(7, 5, 'ballista'),
    upgrade(8, 11), upgrade(8, 7), upgrade(9, 21), upgrade(9, 13),
    upgrade(10, 17), upgrade(10, 5), upgrade(10, 11), upgrade(10, 2),
  ],
  weakBuildOrder: [
    build(0, 1, 'archer'), build(0, 8, 'cannon'), build(0, 17, 'archer'),
    build(1, 12, 'frost'), build(2, 21, 'cannon'), build(3, 15, 'archer'),
    build(4, 18, 'ballista'), upgrade(4, 1), upgrade(5, 8), upgrade(6, 17),
    upgrade(7, 12), upgrade(8, 21),
  ],
} satisfies ChapterIsland;
