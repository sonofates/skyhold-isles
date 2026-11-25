import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i34.json';

const layout2d = parseLevel2D(json);

export const I34 = {
  id: 'i34',
  index: 33,
  name: 'Steamvent Springs',
  subtitle: 'Hold the switchbacks above the baths while the keeper bleeds the trapped steam from the hillside.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1609,
  startingGold: 440,
  enemyHpScale: 3.45,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'First Bath', clearBonus: 25, groups: [
      group('rimebeetle', 6, 0.86), group('runner', 10, 0.48, 1.7),
    ] },
    { name: 'Copper Spout', clearBonus: 27, groups: [
      group('sledguard', 4, 1.43), group('reedpiper', 2, 1.4, 1.7),
    ] },
    { name: 'Scale in the Pipe', clearBonus: 29, groups: [
      group('blinker', 8, 0.72), group('rimebeetle', 6, 0.86, 1.7),
      group('draftwing', 4, 0.93, 3.9),
    ] },
    { name: 'Scald Line', clearBonus: 30, groups: [
      group('kilnback', 5, 1.08), group('sledguard', 4, 1.43, 1.7),
      group('healer', 2, 1.36, 3.9),
    ] },
    { name: 'Empty Tubs', clearBonus: 32, groups: [
      group('bellrunner', 12, 0.51), group('burrower', 7, 0.8, 1.7),
      group('rimebeetle', 6, 0.86, 3.9),
    ] },
    { name: 'Lower Terrace', clearBonus: 34, groups: [
      { ...group('brute', 6, 1.03), elite: true }, group('hexer', 3, 1.34, 1.7),
      group('mite', 14, 0.28, 3.9),
    ] },
    { name: 'Towel Rack', clearBonus: 36, groups: [
      group('sledguard', 5, 1.43), group('rimebeetle', 8, 0.86, 1.7),
      group('reedpiper', 3, 1.4, 3.9),
    ] },
    { name: 'Rust in the Valve', clearBonus: 38, groups: [
      { ...group('splitter', 7, 0.77), elite: true }, group('draftwing', 5, 0.93, 1.7),
      group('golem', 5, 1.21, 3.9),
    ] },
    { name: 'Boiling Over', clearBonus: 39, groups: [
      { ...group('rimebeetle', 8, 0.86), elite: true }, group('blinker', 9, 0.72, 1.7),
      group('healer', 3, 1.36, 3.9),
    ] },
    { name: 'The Long Coil', clearBonus: 41, groups: [
      { ...group('sledguard', 6, 1.43), elite: true }, group('bellrunner', 11, 0.51, 1.7),
      group('carrier', 2, 2.3, 3.9),
    ] },
    { name: 'Hot Footing', clearBonus: 43, groups: [
      group('kilnback', 8, 1.08), group('hexer', 3, 1.34, 1.7),
      group('rimebeetle', 8, 0.86, 3.9),
    ] },
    { name: 'Strainer Teeth', clearBonus: 45, groups: [
      { ...group('burrower', 9, 0.8), elite: true }, group('sledguard', 6, 1.43, 1.7),
      group('warden', 5, 1.15, 3.9),
    ] },
    { name: 'Bleed the Main', clearBonus: 47, groups: [
      { ...group('sledguard', 7, 1.43), elite: true }, group('rimebeetle', 9, 0.86, 1.7),
      group('reedpiper', 4, 1.4, 3.9),
    ] },
    { name: 'The Blue Stone', clearBonus: 60, groups: [
      { ...group('golem', 10, 1.21), elite: true, hpScale: 1.5 }, group('bellrunner', 12, 0.51, 4),
      group('rimebeetle', 8, 0.86, 6.5), group('sledguard', 5, 1.43, 10),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 4, 'tesla'), build(0, 9, 'barracks'), build(0, 10, 'archer'),
    build(1, 5, 'frost'), build(1, 11, 'ballista'), upgrade(2, 4),
    build(2, 12, 'mortar'), upgrade(3, 10), build(3, 1, 'cannon'),
    upgrade(4, 11), build(4, 15, 'tesla'), upgrade(5, 9),
    build(5, 8, 'ballista'), upgrade(6, 1), build(6, 0, 'archer'),
    upgrade(7, 5), upgrade(7, 4), upgrade(7, 12),
    upgrade(7, 15), upgrade(8, 8), upgrade(8, 11),
    upgrade(8, 10), upgrade(9, 0), upgrade(9, 1),
    upgrade(9, 9), upgrade(10, 5), upgrade(10, 12),
    upgrade(10, 15), upgrade(11, 8), upgrade(11, 0),
  ],
  weakBuildOrder: [
    build(0, 3, 'tesla'), build(0, 9, 'barracks'), build(0, 10, 'archer'),
    build(1, 5, 'frost'), build(1, 11, 'ballista'), upgrade(2, 3),
    upgrade(3, 10), upgrade(4, 11), build(4, 15, 'tesla'),
    upgrade(5, 9), build(5, 8, 'ballista'), upgrade(7, 5),
    upgrade(7, 3), upgrade(7, 15), upgrade(8, 8),
    upgrade(8, 11), upgrade(8, 10), upgrade(9, 9),
    upgrade(10, 5), upgrade(10, 15), upgrade(11, 8),
  ],
} satisfies ChapterIsland;
