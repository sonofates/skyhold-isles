import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i36.json';

const layout2d = parseLevel2D(json);

export const I36 = {
  id: 'i36',
  index: 35,
  name: 'Frostveil Citadel',
  subtitle: 'The bell crew is crossing the parade court. Guard all three approaches and break the Glacier Warden’s hold on the ice gate.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1655,
  startingGold: 460,
  enemyHpScale: 2.22,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'Parade Ground', clearBonus: 25, groups: [
      group('sledguard', 3, 1.43), group('bellrunner', 8, 0.51, 1.7, 1),
    ] },
    { name: 'Sally Port', clearBonus: 27, groups: [
      group('rimebeetle', 6, 0.86, 0, 1), group('runner', 10, 0.48, 1.7, 2),
    ] },
    { name: 'The First Standard', clearBonus: 29, groups: [
      group('warden', 4, 1.15, 0, 2), group('sledguard', 3, 1.43, 1.7),
      group('draftwing', 4, 0.93, 3.9, 1),
    ] },
    { name: 'Crossing Orders', clearBonus: 30, groups: [
      group('rimebeetle', 7, 0.86), group('burrower', 6, 0.8, 1.7, 1),
      group('healer', 2, 1.36, 3.9, 2),
    ] },
    { name: 'Red Pennons', clearBonus: 32, groups: [
      { ...group('brute', 5, 1.03, 0, 1), elite: true }, group('blinker', 8, 0.72, 1.7, 2),
      group('reedpiper', 3, 1.4, 3.9),
    ] },
    { name: 'Iron Hinge', clearBonus: 34, groups: [
      group('sledguard', 5, 1.43, 0, 2), group('rimebeetle', 7, 0.86, 1.7),
      group('mite', 14, 0.28, 3.9, 1),
    ] },
    { name: 'Gate Watch', clearBonus: 36, groups: [
      { ...group('kilnback', 6, 1.08), elite: true }, group('draftwing', 5, 0.93, 1.7, 1),
      group('hexer', 3, 1.34, 3.9, 2),
    ] },
    { name: 'Western Salute', clearBonus: 38, groups: [
      { ...group('rimebeetle', 8, 0.86, 0, 1), elite: true }, group('golem', 5, 1.21, 1.7, 2),
      group('runner', 12, 0.48, 3.9),
    ] },
    { name: 'Icebound Chain', clearBonus: 39, groups: [
      { ...group('sledguard', 6, 1.43, 0, 2), elite: true }, group('burrower', 8, 0.8, 1.7),
      group('carrier', 2, 2.3, 3.9, 1),
    ] },
    { name: 'Three Signals', clearBonus: 41, groups: [
      { ...group('splitter', 7, 0.77), elite: true }, group('rimebeetle', 7, 0.86, 1.7, 1),
      group('warden', 4, 1.15, 3.9, 2),
    ] },
    { name: 'Under the Arch', clearBonus: 43, groups: [
      { ...group('golem', 6, 1.21, 0, 1), elite: true }, group('reedpiper', 4, 1.4, 1.7, 2),
      group('bellrunner', 12, 0.51, 3.9),
    ] },
    { name: 'The Silent Bell', clearBonus: 45, groups: [
      // Spread the finale's pressure over the last four waves (docs/handoff-ch4-final.md).
      { ...group('sledguard', 7, 1.43, 0, 2), hpScale: 1.3 }, group('rimebeetle', 9, 0.86, 1.7),
      group('blinker', 9, 0.72, 3.9, 1),
    ] },
    { name: 'Raise the Sledge', clearBonus: 47, groups: [
      { ...group('kilnback', 8, 1.08), elite: true, hpScale: 1.55 }, group('draftwing', 5, 0.93, 1.7, 1),
      group('hexer', 4, 1.34, 3.9, 2),
    ] },
    { name: 'The Last Pennant', clearBonus: 48, groups: [
      { ...group('sledguard', 7, 1.43, 0, 1), elite: true, hpScale: 1.9 }, group('rimebeetle', 8, 0.86, 1.7, 2),
      group('bellrunner', 13, 0.51, 3.9),
    ] },
    { name: 'The Glacier Warden', clearBonus: 60, groups: [
      // The vanguard takes the side gates before the Warden opens the long central approach.
      { ...group('glacier_warden', 1, 1, 30), hpScale: 1.15 },
      { ...group('sledguard', 10, 1.43, 2, 2), hpScale: 3 },
      group('rimebeetle', 8, 0.86, 7.5), group('bellrunner', 11, 0.51, 13, 1),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 10, 'tesla'), build(0, 13, 'barracks'), build(0, 7, 'archer'),
    build(1, 9, 'frost'), build(1, 15, 'ballista'), upgrade(2, 10),
    build(2, 11, 'mortar'), upgrade(3, 7), build(3, 0, 'cannon'),
    upgrade(4, 15), build(4, 12, 'tesla'), upgrade(5, 13),
    build(5, 5, 'ballista'), upgrade(6, 0), build(6, 4, 'archer'),
    upgrade(7, 9), upgrade(7, 10), upgrade(7, 11),
    upgrade(7, 12), upgrade(8, 5), upgrade(8, 15),
    upgrade(8, 7), upgrade(9, 4), upgrade(9, 0),
    upgrade(9, 13), upgrade(10, 9), upgrade(10, 11),
    upgrade(10, 12), upgrade(11, 5), upgrade(11, 4),
  ],
  weakBuildOrder: [
    build(0, 4, 'tesla'), build(0, 13, 'barracks'), build(0, 7, 'archer'),
    build(1, 9, 'frost'), build(1, 15, 'ballista'), upgrade(2, 4),
    upgrade(3, 7), upgrade(4, 15), build(4, 12, 'tesla'),
    upgrade(5, 13), build(5, 5, 'ballista'), upgrade(7, 9),
    upgrade(7, 4), upgrade(7, 12), upgrade(8, 5),
    upgrade(8, 15), upgrade(8, 7), upgrade(9, 13),
    upgrade(10, 9), upgrade(10, 12), upgrade(11, 5),
  ],
} satisfies ChapterIsland;
