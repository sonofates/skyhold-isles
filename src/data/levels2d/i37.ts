import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i37.json';

const layout2d = parseLevel2D(json);

export const I37 = {
  id: 'i37',
  index: 36,
  name: 'Duskfall Landing',
  subtitle: 'The quay has lost its mooring. Hold the curl of the landing road until the last ferry catches a line.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1542,
  startingGold: 415,
  enemyHpScale: 2.563,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'Last Ferry', clearBonus: 25, groups: [
      group('runner', 8, 0.60), group('sledguard', 2, 1.4, 3),
    ] },
    { name: 'Slack Water', clearBonus: 27, groups: [
      group('grunt', 10, 0.72), group('bellrunner', 6, 0.53, 2),
    ] },
    { name: 'Hook and Eye', clearBonus: 29, groups: [
      group('warden', 4, 1.18), group('healer', 2, 1.6, 3), group('runner', 8, 0.48, 5),
    ] },
    { name: 'Under the Jib', clearBonus: 30, groups: [
      group('splitter', 6, 0.9), group('draftwing', 4, 1.05, 2),
    ] },
    { name: 'Counterweight', clearBonus: 32, groups: [
      group('burrower', 7, 0.80), group('reedpiper', 3, 1.42, 2), group('mite', 11, 0.32, 5),
    ] },
    { name: 'Empty Berth', clearBonus: 34, groups: [
      group('kilnback', 5, 1.12), group('sledguard', 4, 1.48, 3),
    ] },
    { name: 'Cargo Lamps', clearBonus: 36, groups: [
      group('bellrunner', 12, 0.51), group('hexer', 3, 1.30, 2), group('carrier', 2, 2.15, 4),
    ] },
    { name: 'Swing Shift', clearBonus: 38, groups: [
      { ...group('brute', 6, 1.05), elite: true }, group('blinker', 8, 0.70, 2),
      group('healer', 3, 1.42, 4),
    ] },
    { name: 'Chain Locker', clearBonus: 39, groups: [
      group('sledguard', 5, 1.38), group('kilnback', 5, 1.1, 2), group('draftwing', 4, 0.95, 6),
    ] },
    { name: 'Hawse Hole', clearBonus: 41, groups: [
      group('golem', 4, 1.22), group('burrower', 8, 0.74, 3), group('healer', 3, 1.34, 5),
    ] },
    { name: 'Crosswind', clearBonus: 43, groups: [
      group('runner', 14, 0.46), group('hexer', 4, 1.25, 2), group('carrier', 2, 2.2, 4),
    ] },
    { name: 'Broken Shackle', clearBonus: 45, groups: [
      { ...group('sledguard', 4, 1.36), elite: true, hpScale: 2.26 }, group('reedpiper', 3, 1.39, 2),
      group('splitter', 6, 0.8, 5),
    ] },
    { name: 'Make Fast', clearBonus: 47, groups: [
      group('kilnback', 7, 1.06), { ...group('brute', 5, 1.0, 1), elite: true, hpScale: 1.6 },
      group('blinker', 9, 0.65, 4),
    ] },
    { name: 'All Lines In', clearBonus: 60, groups: [
      { ...group('golem', 3, 1.22), elite: true, hpScale: 2.81 }, group('bellrunner', 12, 0.5, 3),
      { ...group('sledguard', 5, 1.4, 7), hpScale: 1.3 },
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 16, 'tesla'), build(0, 2, 'barracks'), build(0, 5, 'archer'),
    build(1, 13, 'frost'), build(1, 7, 'ballista'), upgrade(2, 16),
    build(2, 11, 'mortar'), upgrade(3, 5), build(3, 0, 'cannon'),
    upgrade(4, 7), build(4, 9, 'tesla'), upgrade(5, 2),
    build(5, 15, 'ballista'), upgrade(6, 0), build(6, 12, 'archer'),
    upgrade(7, 13), upgrade(7, 16), upgrade(7, 11),
    upgrade(7, 9), upgrade(8, 15), upgrade(8, 7),
    upgrade(8, 5), upgrade(9, 12), upgrade(9, 0),
    upgrade(9, 2), upgrade(10, 13), upgrade(10, 11),
    upgrade(10, 9), upgrade(11, 15), upgrade(11, 12),
  ],
  // The smaller defence commits to the outbound quay and leaves the inner turn exposed.
  weakBuildOrder: [
    build(0, 1, 'tesla'), build(0, 6, 'barracks'), build(0, 3, 'archer'),
    build(1, 9, 'frost'), build(1, 4, 'ballista'), upgrade(2, 1),
    upgrade(3, 3), upgrade(4, 4), build(4, 12, 'tesla'),
    upgrade(5, 6), build(5, 10, 'ballista'), upgrade(7, 9),
    upgrade(7, 1), upgrade(7, 12), upgrade(8, 10),
    upgrade(8, 4), upgrade(8, 3), upgrade(9, 6),
    upgrade(10, 9), upgrade(10, 12), upgrade(11, 10),
  ],
} satisfies ChapterIsland;
