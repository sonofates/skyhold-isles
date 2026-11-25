import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i35.json';

const layout2d = parseLevel2D(json);

export const I35 = {
  id: 'i35',
  index: 34,
  name: 'Coldforge Delve',
  subtitle: 'Two haulage galleries feed the forge. Keep the rails clear long enough to cast a new tongue for the citadel bell.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1632,
  startingGold: 455,
  enemyHpScale: 2.285,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'Shift Lantern', clearBonus: 25, groups: [
      group('sledguard', 3, 1.43), group('rimebeetle', 5, 0.86, 1.7, 1),
    ] },
    { name: 'Blue Seam', clearBonus: 27, groups: [
      group('runner', 10, 0.48, 0, 1), group('burrower', 5, 0.8, 1.7),
    ] },
    { name: 'Loose Sleeper', clearBonus: 29, groups: [
      group('rimebeetle', 7, 0.86), group('reedpiper', 3, 1.4, 1.7, 1),
      group('draftwing', 3, 0.93, 3.9),
    ] },
    { name: 'Ore in the Hopper', clearBonus: 30, groups: [
      group('kilnback', 5, 1.08, 0, 1), group('sledguard', 4, 1.43, 1.7),
      group('mite', 11, 0.28, 3.9, 1),
    ] },
    { name: 'Double Haul', clearBonus: 32, groups: [
      { ...group('brute', 5, 1.03), elite: true }, group('blinker', 8, 0.72, 1.7, 1),
      group('healer', 2, 1.36, 3.9),
    ] },
    { name: 'Air Shaft', clearBonus: 34, groups: [
      group('golem', 4, 1.21, 0, 1), group('rimebeetle', 7, 0.86, 1.7),
      group('carrier', 2, 2.3, 3.9, 1),
    ] },
    { name: 'Broken Clapper', clearBonus: 36, groups: [
      { ...group('sledguard', 5, 1.43), elite: true }, group('bellrunner', 11, 0.51, 1.7, 1),
      group('hexer', 3, 1.34, 3.9),
    ] },
    { name: 'The Lower Siding', clearBonus: 38, groups: [
      { ...group('rimebeetle', 7, 0.86, 0, 1), elite: true }, group('burrower', 8, 0.8, 1.7),
      group('warden', 5, 1.15, 3.9, 1),
    ] },
    { name: 'Black Bellows', clearBonus: 39, groups: [
      group('sledguard', 6, 1.43), group('draftwing', 5, 0.93, 1.7, 1),
      group('splitter', 7, 0.77, 3.9),
    ] },
    { name: 'Draw the Crucible', clearBonus: 41, groups: [
      { ...group('kilnback', 7, 1.08, 0, 1), elite: true }, group('healer', 3, 1.36, 1.7),
      group('rimebeetle', 8, 0.86, 3.9, 1),
    ] },
    { name: 'White Heat', clearBonus: 43, groups: [
      // Spread the island's pressure over the last five waves (docs/handoff-ch4-final.md).
      { ...group('burrower', 9, 0.8), elite: true, hpScale: 1.25 }, group('blinker', 9, 0.72, 1.7, 1),
      group('sledguard', 5, 1.43, 3.9),
    ] },
    { name: 'Switch Lever', clearBonus: 45, groups: [
      { ...group('golem', 6, 1.21, 0, 1), hpScale: 1.4 }, group('rimebeetle', 8, 0.86, 1.7),
      group('reedpiper', 4, 1.4, 3.9, 1),
    ] },
    { name: 'Pouring Sand', clearBonus: 47, groups: [
      { ...group('sledguard', 6, 1.43), elite: true, hpScale: 1.3 }, group('hexer', 4, 1.34, 1.7, 1),
      group('draftwing', 5, 0.93, 3.9),
    ] },
    { name: 'Quench Water', clearBonus: 48, groups: [
      { ...group('splitter', 8, 0.77, 0, 1), elite: true }, { ...group('kilnback', 7, 1.08, 1.7), hpScale: 1.65 },
      group('rimebeetle', 8, 0.86, 3.9, 1),
    ] },
    { name: 'The Bell Cart', clearBonus: 60, groups: [
      { ...group('kilnback', 8, 1.08), elite: true, hpScale: 2.4 }, group('sledguard', 6, 1.43, 4, 1),
      group('bellrunner', 12, 0.51, 6.5), group('rimebeetle', 8, 0.86, 10, 1),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 9, 'tesla'), build(0, 10, 'barracks'), build(0, 11, 'archer'),
    build(1, 7, 'frost'), build(1, 14, 'ballista'), upgrade(2, 9),
    build(2, 6, 'mortar'), upgrade(3, 11), build(3, 12, 'cannon'),
    upgrade(4, 14), build(4, 3, 'tesla'), upgrade(5, 10),
    build(5, 13, 'ballista'), upgrade(6, 12), build(6, 1, 'archer'),
    upgrade(7, 7), upgrade(7, 9), upgrade(7, 6),
    upgrade(7, 3), upgrade(8, 13), upgrade(8, 14),
    upgrade(8, 11), upgrade(9, 1), upgrade(9, 12),
    upgrade(9, 10), upgrade(10, 7), upgrade(10, 6),
    upgrade(10, 3), upgrade(11, 13), upgrade(11, 1),
  ],
  weakBuildOrder: [
    build(0, 0, 'tesla'), build(0, 10, 'barracks'), build(0, 11, 'archer'),
    build(1, 7, 'frost'), build(1, 14, 'ballista'), upgrade(2, 0),
    upgrade(3, 11), upgrade(4, 14), build(4, 3, 'tesla'),
    upgrade(5, 10), build(5, 13, 'ballista'), upgrade(7, 7),
    upgrade(7, 0), upgrade(7, 3), upgrade(8, 13),
    upgrade(8, 14), upgrade(8, 11), upgrade(9, 10),
    upgrade(10, 7), upgrade(10, 3), upgrade(11, 13),
  ],
} satisfies ChapterIsland;
