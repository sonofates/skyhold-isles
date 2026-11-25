import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i42.json';

const layout2d = parseLevel2D(json);

export const I42 = {
  id: 'i42',
  index: 41,
  name: 'Chainward Bastion',
  subtitle: 'Two posterns feed the anchor yard. Guard the turn uphill to the wheel before the last locking tooth slips.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1747,
  startingGold: 425,
  enemyHpScale: 2.16,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'Lift the Pawl', clearBonus: 25, groups: [
      group('veilcaster', 2, 1.85), group('grunt', 8, 0.74, 1, 1),
    ] },
    { name: 'Slack Chain', clearBonus: 27, groups: [
      group('duskhound', 5, 0.41, 0, 1), group('warden', 4, 1.18), group('duskhound', 5, 0.41, 5),
    ] },
    { name: 'Anchor Bed', clearBonus: 29, groups: [
      group('kilnback', 4, 1.21), group('draftwing', 4, 0.99, 2), group('bellrunner', 8, 0.55, 4, 1),
    ] },
    { name: 'Rivet Tongs', clearBonus: 30, groups: [
      group('splitter', 5, 0.93, 0, 1), group('veilcaster', 3, 1.48), group('healer', 2, 1.48, 3, 1),
    ] },
    { name: 'Across the Yard', clearBonus: 32, groups: [
      group('sledguard', 4, 1.37), group('burrower', 6, 0.83, 2, 1), group('reedpiper', 3, 1.37, 5),
    ] },
    { name: 'Load Test', clearBonus: 34, groups: [
      group('brute', 5, 1.12, 0, 1), group('hexer', 3, 1.36), group('mite', 10, 0.34, 5),
    ] },
    { name: 'Signal Hammer', clearBonus: 36, groups: [
      group('duskhound', 6, 0.41), { ...group('carrier', 3, 2.4, 2), elite: true, hpScale: 1.8 }, group('duskhound', 6, 0.41, 4, 1),
    ] },
    { name: 'One Tooth Gone', clearBonus: 38, groups: [
      group('sledguard', 5, 1.35), group('blinker', 8, 0.69, 2, 1), group('reedpiper', 4, 1.31, 4),
    ] },
    { name: 'Cooling Trough', clearBonus: 39, groups: [
      group('kilnback', 5, 1.17, 0, 1), group('reedpiper', 4, 1.26), { ...group('draftwing', 5, 0.93, 4), elite: true, hpScale: 1.4 },
    ] },
    { name: 'Swinging Link', clearBonus: 41, groups: [
      group('warden', 5, 1.13), group('duskhound', 6, 0.38, 1, 1), group('veilcaster', 4, 1.32, 4),
    ] },
    { name: 'Forge Scale', clearBonus: 43, groups: [
      group('splitter', 7, 0.83, 0, 1), group('burrower', 8, 0.8), group('healer', 3, 1.37, 5, 1),
    ] },
    { name: 'Dead Weight', clearBonus: 45, groups: [
      { ...group('golem', 3, 1.2), elite: true, hpScale: 3.5 }, group('bellrunner', 10, 0.51, 2, 1), group('veilcaster', 3, 1.36, 4),
    ] },
    // The elite Sledge Warden wall comes in the last third (chapter-5 final balance).
    { name: 'Draw the Pin', clearBonus: 47, groups: [
      { ...group('sledguard', 4, 1.34, 0, 1), elite: true, hpScale: 2.8 }, group('veilcaster', 3, 1.36), group('blinker', 7, 0.76, 4),
    ] },
    { name: 'Full Tension', clearBonus: 49, groups: [
      group('duskhound', 6, 0.37, 0, 1), group('brute', 6, 1.05), group('duskhound', 6, 0.38, 5), group('veilcaster', 3, 1.3, 6, 1),
    ] },
    { name: 'Last Locking Tooth', clearBonus: 60, groups: [
      { ...group('kilnback', 3, 1.08, 0, 1), elite: true, hpScale: 2.4 }, group('warden', 5, 1.12), group('burrower', 8, 0.79, 3),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 12, 'tesla'), build(0, 13, 'barracks'), build(0, 14, 'archer'),
    build(1, 11, 'frost'), build(1, 8, 'ballista'), upgrade(2, 12),
    build(2, 9, 'mortar'), upgrade(3, 14), build(3, 3, 'cannon'),
    upgrade(4, 8), build(4, 6, 'tesla'), upgrade(5, 13),
    build(5, 15, 'ballista'), upgrade(6, 3), build(6, 2, 'archer'),
    upgrade(7, 11), upgrade(7, 12), upgrade(7, 9),
    upgrade(7, 6), upgrade(8, 15), upgrade(8, 8),
    upgrade(8, 14), upgrade(9, 2), upgrade(9, 3),
    upgrade(9, 13), upgrade(10, 11), upgrade(10, 9),
    upgrade(10, 6), upgrade(11, 15), upgrade(11, 2),
  ],
  weakBuildOrder: [
    build(0, 0, 'tesla'), build(0, 1, 'barracks'), build(0, 7, 'archer'),
    build(1, 3, 'frost'), build(1, 10, 'ballista'), upgrade(2, 0),
    upgrade(3, 7), upgrade(4, 10), build(4, 6, 'tesla'),
    upgrade(5, 1), build(5, 5, 'ballista'), upgrade(7, 3),
    upgrade(7, 0), upgrade(7, 6), upgrade(8, 5),
    upgrade(8, 10), upgrade(8, 7), upgrade(9, 1),
    upgrade(10, 3), upgrade(10, 6), upgrade(11, 5),
  ],
} satisfies ChapterIsland;
