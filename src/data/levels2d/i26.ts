import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i26.json';

const layout2d = parseLevel2D(json);

// Opposing quarry mouths feed the first landing. The common road descends in two broad steps.
export const I26 = {
  id: 'i26',
  index: 25,
  name: 'Cinderlift Terraces',
  subtitle: 'The last bucket of furnace sand hangs over the drop. Guard the stepped haul road until the lift can turn.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1361,
  startingGold: 390,
  enemyHpScale: 2.31,
  waveHpGrowth: 0.095,
  waves: [
    { name: 'Morning Shift', clearBonus: 25, groups: [
      group('grunt', 9, 0.68), group('burrower', 6, 0.92, 1, 1),
    ] },
    { name: 'Haul Rope', clearBonus: 27, groups: [
      group('runner', 11, 0.52, 0, 1), group('brute', 5, 1.16),
      group('healer', 2, 1.55, 2),
    ] },
    { name: 'Loose Scree', clearBonus: 29, groups: [
      group('splitter', 6, 0.9), group('mite', 16, 0.26, 1, 1),
      group('flyer', 4, 0.96, 4),
    ] },
    { name: 'Sand in the Teeth', clearBonus: 31, groups: [
      group('warden', 3, 1.32, 0, 1), group('golem', 5, 1.25, 1, 1),
      group('runner', 11, 0.44, 3),
    ] },
    { name: 'At the Brake', clearBonus: 32, groups: [
      group('blinker', 7, 0.72), group('burrower', 8, 0.82, 0, 1),
      group('hexer', 3, 1.6, 2),
    ] },
    { name: 'Slack Cable', clearBonus: 34, groups: [
      { ...group('golem', 6, 1.05), elite: true }, group('brute', 6, 0.92, 0, 1),
      group('healer', 3, 1.3, 1),
    ] },
    { name: 'The Counterweight', clearBonus: 36, groups: [
      { ...group('warden', 5, 1.2, 0, 1), elite: true }, group('splitter', 8, 0.75),
      group('carrier', 2, 2.6, 2),
    ] },
    { name: 'Shaking Gantry', clearBonus: 37, groups: [
      group('mite', 22, 0.24), group('hexer', 4, 1.36, 0, 1),
      { ...group('burrower', 8, 0.77, 1, 1), elite: true }, group('flyer', 4, 1.1, 4),
    ] },
    { name: 'Amber Load', clearBonus: 39, groups: [
      group('golem', 8, 1.03), group('healer', 3, 1.33, 1),
      { ...group('brute', 8, 0.84, 2, 1), elite: true },
    ] },
    { name: 'The Ratchet Slips', clearBonus: 41, groups: [
      { ...group('blinker', 8, 0.65, 0, 1), elite: true }, { ...group('splitter', 7, 0.72), elite: true },
      group('warden', 5, 1.13, 2), group('carrier', 2, 2.75, 4),
    ] },
    { name: 'The Last Landing', clearBonus: 43, groups: [
      group('burrower', 10, 0.69), group('hexer', 4, 1.14, 0, 1),
      { ...group('golem', 7, 0.96, 1, 1), elite: true }, group('runner', 12, 0.42, 5),
    ] },
    { name: 'Heave Together', clearBonus: 46, groups: [
      { ...group('brute', 9, 0.82), elite: true }, group('healer', 4, 1.25, 0.45),
      { ...group('warden', 6, 1.1, 1, 1), elite: true }, group('flyer', 5, 0.8, 5),
    ] },
    { name: 'The Bucket Tips', clearBonus: 60, groups: [
      { ...group('golem', 9, 0.98), elite: true }, group('hexer', 4, 1.2, 0.6),
      { ...group('splitter', 9, 0.67, 1, 1), elite: true }, group('blinker', 10, 0.6, 4, 1),
      { ...group('burrower', 6, 0.77, 8), elite: true },
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 11, 'tesla'), build(0, 13, 'barracks'), build(0, 4, 'archer'),
    build(1, 10, 'frost'), build(1, 16, 'ballista'), upgrade(2, 11),
    build(2, 8, 'mortar'), upgrade(3, 4), build(3, 12, 'cannon'),
    upgrade(4, 16), build(4, 15, 'tesla'), upgrade(5, 13),
    build(5, 5, 'ballista'), upgrade(6, 12), build(6, 14, 'archer'),
    upgrade(7, 10), upgrade(7, 11), upgrade(7, 8),
    upgrade(7, 15), upgrade(8, 5), upgrade(8, 16),
    upgrade(8, 4), upgrade(9, 14), upgrade(9, 12),
    upgrade(9, 13), upgrade(10, 10), upgrade(10, 8),
    upgrade(10, 15), upgrade(11, 5), upgrade(11, 14),
  ],
  weakBuildOrder: [
    build(0, 6, 'archer'), build(0, 0, 'cannon'), build(0, 5, 'tesla'),
    build(1, 7, 'frost'), build(2, 1, 'archer'), build(3, 15, 'cannon'),
    build(4, 2, 'ballista'), upgrade(5, 6), upgrade(6, 0),
    upgrade(7, 5), upgrade(8, 7), upgrade(9, 1),
    upgrade(10, 15),
  ],
} satisfies ChapterIsland;
