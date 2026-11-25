import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i30.json';

const layout2d = parseLevel2D(json);

// The switchback from the trestle meets the low logging road below the saddle.
// Rime Beetles are a regular threat here (waves 3-13, after i29 introduced them).
export const I30 = {
  id: 'i30',
  index: 29,
  name: 'Pinewhite Ridge',
  subtitle: 'The freight sledge has lost a brake shoe. Hold the saddle while the crew splices a new brake line.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1517,
  startingGold: 405,
  enemyHpScale: 2.395,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'Brake Shoe', clearBonus: 25, groups: [
      group('runner', 10, 0.51), group('bellrunner', 7, 0.55, 1.8, 1),
    ] },
    { name: 'Red Pennant', clearBonus: 27, groups: [
      group('warden', 4, 1.24, 0, 1), group('brute', 5, 1.08, 0.75),
      group('mite', 13, 0.29, 2.8, 1),
    ] },
    { name: 'Needles on the Wind', clearBonus: 29, groups: [
      group('draftwing', 4, 0.97), group('kilnback', 5, 1.08, 0.75, 1),
      group('reedpiper', 2, 1.42, 2.8), group('rimebeetle', 5, 0.9, 2.8),
    ] },
    { name: 'Two Ruts', clearBonus: 31, groups: [
      group('golem', 4, 1.2, 0, 1), group('healer', 3, 1.37, 0.75),
      group('burrower', 7, 0.82, 2.8, 1), group('rimebeetle', 5, 0.54, 4.4),
    ] },
    { name: 'The Trestle Sings', clearBonus: 32, groups: [
      group('splitter', 7, 0.78), group('hexer', 3, 1.33, 0.75, 1),
      group('blinker', 7, 0.69, 2.8),
    ] },
    { name: 'Spruce Shadows', clearBonus: 34, groups: [
      { ...group('brute', 7, 1.03, 0, 1), elite: true }, group('reedpiper', 3, 1.37, 2.8, 1),
      group('rimebeetle', 6, 0.9, 4.4),
    ] },
    { name: 'Load Shift', clearBonus: 36, groups: [
      { ...group('kilnback', 6, 1.03), elite: true }, group('carrier', 2, 2.38, 0.75, 1),
      group('burrower', 8, 0.79, 2.8),
    ] },
    { name: 'Across the Saddle', clearBonus: 38, groups: [
      { ...group('warden', 6, 1.15, 0, 1), elite: true }, group('runner', 13, 0.47, 0.75),
      group('golem', 5, 1.14, 2.8, 1), group('rimebeetle', 6, 0.9, 8),
    ] },
    { name: 'Cut the Lashings', clearBonus: 39, groups: [
      { ...group('golem', 6, 1.13), elite: true }, group('healer', 3, 1.3, 0.75, 1),
      group('blinker', 8, 0.66, 2.8),
    ] },
    { name: 'Blue Cornice', clearBonus: 41, groups: [
      { ...group('burrower', 8, 0.77, 0, 1), elite: true }, group('hexer', 4, 1.25, 0.75),
      group('draftwing', 5, 0.89, 2.8, 1), group('bellrunner', 12, 0.5, 5),
      group('rimebeetle', 6, 0.9, 6.2, 1),
    ] },
    { name: 'Cold Iron', clearBonus: 43, groups: [
      { ...group('splitter', 8, 0.73), elite: true }, group('kilnback', 7, 0.98, 0.75, 1),
      group('reedpiper', 4, 1.29, 2.8),
    ] },
    { name: 'Set the Brake', clearBonus: 46, groups: [
      { ...group('brute', 8, 0.96, 0, 1), elite: true }, group('warden', 5, 1.1, 0.75),
      { ...group('golem', 3, 1.09, 2.8, 1), elite: true }, group('mite', 17, 0.25, 5),
      group('rimebeetle', 6, 0.9, 6.2),
    ] },
    { name: 'Lamps Below the Ridge', clearBonus: 60, groups: [
      { ...group('kilnback', 9, 0.95), elite: true }, group('reedpiper', 4, 1.26, 0.75, 1),
      { ...group('golem', 7, 1.08, 2.8), elite: true }, { ...group('bellrunner', 11, 0.48, 5, 1), elite: true },
      { ...group('rimebeetle', 6, 0.54, 6.2), elite: true },
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 10, 'tesla'), build(0, 11, 'barracks'), build(0, 12, 'archer'),
    build(1, 13, 'frost'), build(1, 14, 'ballista'), upgrade(2, 10),
    build(2, 3, 'mortar'), upgrade(3, 12), build(3, 4, 'cannon'),
    upgrade(4, 14), build(4, 6, 'tesla'), upgrade(5, 11),
    build(5, 15, 'ballista'), upgrade(6, 4), build(6, 8, 'archer'),
    upgrade(7, 13), upgrade(7, 10), upgrade(7, 3),
    upgrade(7, 6), upgrade(8, 15), upgrade(8, 14),
    upgrade(8, 12), upgrade(9, 8), upgrade(9, 4),
    upgrade(9, 11), upgrade(10, 13), upgrade(10, 3),
    upgrade(10, 6), upgrade(11, 15), upgrade(11, 8),
  ],
  weakBuildOrder: [
    build(0, 10, 'tesla'), build(0, 11, 'barracks'), build(0, 12, 'archer'),
    build(1, 13, 'frost'), build(1, 14, 'ballista'), upgrade(2, 10),
    upgrade(3, 12), upgrade(4, 14), build(4, 6, 'tesla'),
    upgrade(5, 11), build(5, 15, 'ballista'), upgrade(7, 13),
    upgrade(7, 10), upgrade(7, 6), upgrade(8, 15),
    upgrade(8, 14), upgrade(8, 12), upgrade(9, 11),
    upgrade(10, 13), upgrade(10, 6), upgrade(11, 15),
  ],
} satisfies ChapterIsland;
