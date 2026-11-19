import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i20.json';

const layout2d = parseLevel2D(json);

// The south road is the shortest approach. Ground reinforcements from the east take the long hook inland.
export const I20 = {
  id: 'i20',
  index: 19,
  name: 'Three Pennants Head',
  subtitle: 'Three storm flags have torn loose. Hold the headland until the boats clear the reef.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1069,
  startingGold: 380,
  enemyHpScale: 1.36,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'The First Pennant', clearBonus: 24, groups: [
      group('grunt', 10, 0.62),
      group('bellrunner', 5, 0.81, 1.4, 1),
    ] },
    { name: 'A Flag to Leeward', clearBonus: 25, groups: [
      group('kilnback', 3, 1.8, 0, 1),
      group('runner', 8, 0.48, 2.1, 2),
      group('brute', 4, 1.42),
    ] },
    { name: 'Reef Birds', clearBonus: 27, groups: [
      group('draftwing', 6, 0.61),
      group('reedpiper', 2, 2.4, 0.5, 2),
      group('grunt', 12, 0.48, 1.5, 2),
    ] },
    { name: 'Three Lookouts', clearBonus: 29, groups: [
      group('warden', 2, 1.9),
      group('brute', 4, 0.93, 0.7),
      group('splitter', 4, 0.79, 1.6, 1),
      group('bellrunner', 6, 0.54, 3.2, 2),
    ] },
    { name: 'Sounding Line', clearBonus: 31, groups: [
      group('burrower', 8, 0.78, 0, 2),
      group('kilnback', 6, 1.02, 0.8, 1),
      group('healer', 2, 1.57, 1.4, 1),
    ] },
    { name: 'Crosswind', clearBonus: 34, groups: [
      group('carrier', 2, 2.7),
      group('draftwing', 7, 0.51, 1),
      group('reedpiper', 3, 1.7, 0.4),
      group('bellrunner', 11, 0.37, 3.1),
    ] },
    { name: 'The Outer Shoal', clearBonus: 36, groups: [
      group('golem', 5, 1.43, 0, 1),
      group('warden', 3, 1.4, 0.6, 1),
      group('hexer', 3, 1.15, 2, 2),
      group('runner', 14, 0.36, 2.9, 2),
    ] },
    { name: 'The Middle Shoal', clearBonus: 38, groups: [
      { ...group('kilnback', 6, 1.17), elite: true },
      group('blinker', 8, 0.64, 0.8, 1),
      group('reedpiper', 3, 1.5, 1.2),
      group('draftwing', 5, 0.55, 4.1),
    ] },
    { name: 'The Inner Shoal', clearBonus: 40, groups: [
      { ...group('brute', 7, 1.17, 0, 2), elite: true },
      group('healer', 3, 1.24, 1, 2),
      group('splitter', 10, 0.62, 1.3),
      group('bellrunner', 12, 0.42, 4.7, 1),
    ] },
    { name: 'The Mast Gives Way', clearBonus: 42, groups: [
      { ...group('golem', 5, 1.3, 0, 1), elite: true },
      group('reedpiper', 4, 1.32, 1.1, 1),
      group('carrier', 2, 1.9),
      group('draftwing', 8, 0.47, 3.2),
    ] },
    { name: 'Boats on the Bar', clearBonus: 45, groups: [
      group('warden', 3, 1.58, 0, 2),
      { ...group('kilnback', 8, 0.94, 0.6, 2), elite: true },
      { ...group('bellrunner', 12, 0.45, 2), elite: true },
      group('burrower', 8, 0.72, 4, 1),
    ] },
    { name: 'The Last Pennant', clearBonus: 60, groups: [
      group('boss', 1, 1, 0, 1),
      { ...group('kilnback', 8, 1.29, 0.6, 2), elite: true },
      group('reedpiper', 4, 1.37, 1.3, 2),
      { ...group('splitter', 7, 0.81, 2.6), elite: true },
      group('draftwing', 6, 0.5, 6.2),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 17, 'tesla'), build(0, 18, 'barracks'), build(0, 14, 'archer'),
    build(1, 3, 'cannon'), build(1, 19, 'frost'), upgrade(2, 17),
    build(2, 6, 'archer'), build(3, 15, 'ballista', 'strongest'), upgrade(3, 3),
    build(4, 1, 'mortar'), upgrade(4, 14), build(5, 13, 'tesla'),
    upgrade(5, 15), upgrade(6, 17), build(6, 7, 'ballista'),
    upgrade(7, 19), upgrade(7, 18), upgrade(8, 3), upgrade(8, 13),
    upgrade(9, 7), upgrade(9, 15), upgrade(10, 6), upgrade(10, 1), upgrade(10, 14),
    upgrade(11, 13), upgrade(11, 19), upgrade(11, 7), upgrade(11, 1),
  ],
  weakBuildOrder: [
    build(0, 1, 'archer'), build(0, 17, 'cannon'), build(0, 14, 'archer'),
    build(1, 5, 'frost'), build(2, 0, 'cannon'), build(3, 11, 'archer'),
    build(4, 10, 'ballista'), upgrade(4, 1), upgrade(5, 17), upgrade(6, 14),
    upgrade(7, 5), upgrade(8, 0),
  ],
} satisfies ChapterIsland;
