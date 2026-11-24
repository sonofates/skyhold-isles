import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i25.json';

const layout2d = parseLevel2D(json);

// The upper and lower survey roads wrap around the instrument before sharing the last hooked approach.
export const I25 = {
  id: 'i25',
  index: 24,
  name: 'Galeglass Orrery',
  subtitle: 'The glass plumb bob has slipped its rings. Hold the two survey roads while the keeper sights the storm.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1301,
  startingGold: 375,
  enemyHpScale: 2.1,
  waveHpGrowth: 0.09,
  waves: [
    { name: 'First Reading', clearBonus: 25, groups: [
      group('grunt', 10, 0.64), group('runner', 8, 0.55, 2, 1),
    ] },
    { name: 'Split Needle', clearBonus: 27, groups: [
      group('brute', 5, 1.1, 0, 1), group('burrower', 6, 0.85, 1),
      group('mite', 10, 0.3, 4, 1),
    ] },
    { name: 'Silver Draft', clearBonus: 29, groups: [
      group('flyer', 5, 0.95), group('warden', 3, 1.3, 0, 1),
      group('runner', 10, 0.49, 3),
    ] },
    { name: 'The Plumb Line', clearBonus: 31, groups: [
      group('golem', 4, 1.5), group('healer', 2, 1.65, 0.7),
      group('blinker', 6, 0.69, 3, 1),
    ] },
    { name: 'Mica Shower', clearBonus: 32, groups: [
      group('splitter', 8, 0.8, 0, 1), group('hexer', 3, 1.5, 0.6),
      group('mite', 19, 0.23, 4),
    ] },
    { name: 'Dead Reckoning', clearBonus: 34, groups: [
      { ...group('brute', 7, 0.87), elite: true }, group('warden', 4, 1.2, 0.5),
      group('burrower', 9, 0.69, 2, 1),
    ] },
    { name: 'Counterturn', clearBonus: 36, groups: [
      group('carrier', 2, 2.75), { ...group('blinker', 7, 0.76, 1, 1), elite: true },
      group('splitter', 8, 0.77, 3),
    ] },
    { name: 'The Lens Clouds', clearBonus: 37, groups: [
      { ...group('golem', 6, 1.3, 0, 1), elite: true }, group('hexer', 4, 1.3, 0.5, 1),
      group('runner', 14, 0.43, 3), group('flyer', 4, 0.95, 6),
    ] },
    { name: 'Off the Scale', clearBonus: 39, groups: [
      { ...group('burrower', 8, 0.73), elite: true }, group('healer', 3, 1.34, 0.5),
      group('warden', 5, 1.1, 1, 1), group('mite', 20, 0.25, 5, 1),
    ] },
    { name: 'In the Crosshairs', clearBonus: 41, groups: [
      group('blinker', 9, 0.63, 0, 1), { ...group('splitter', 7, 0.74), elite: true },
      group('golem', 6, 1.04, 2), group('carrier', 2, 2.3, 5),
    ] },
    { name: 'Blue Hour', clearBonus: 43, groups: [
      { ...group('warden', 6, 1.06), elite: true }, group('hexer', 4, 1.2, 0.6),
      { ...group('burrower', 8, 0.7, 1, 1), elite: true }, group('flyer', 5, 0.81, 5),
    ] },
    { name: 'The Rings Align', clearBonus: 60, groups: [
      { ...group('golem', 9, 0.95, 0, 1), elite: true }, group('healer', 4, 1.2, 0.5, 1),
      { ...group('blinker', 8, 0.55, 2), elite: true }, group('splitter', 9, 0.6, 5),
      group('warden', 5, 1, 8, 1),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 16, 'tesla'), build(0, 15, 'barracks'), build(0, 13, 'archer'),
    build(1, 12, 'frost'), build(1, 18, 'ballista'), upgrade(2, 16),
    build(2, 4, 'mortar'), upgrade(3, 13), build(3, 14, 'cannon'),
    upgrade(4, 18), build(4, 6, 'tesla'), upgrade(5, 15),
    build(5, 9, 'ballista'), upgrade(6, 14), build(6, 17, 'archer'),
    upgrade(7, 12), upgrade(7, 16), upgrade(7, 4),
    upgrade(7, 6), upgrade(8, 9), upgrade(8, 18),
    upgrade(8, 13), upgrade(9, 17), upgrade(9, 14),
    upgrade(9, 15), upgrade(10, 12), upgrade(10, 4),
    upgrade(10, 6), upgrade(11, 9), upgrade(11, 17),
  ],
  weakBuildOrder: [
    build(0, 1, 'archer'), build(0, 7, 'cannon'), build(0, 14, 'tesla'),
    build(1, 0, 'frost'), build(2, 8, 'archer'), build(3, 3, 'cannon'),
    build(4, 10, 'ballista'), upgrade(5, 1), upgrade(6, 7),
    upgrade(7, 14), upgrade(8, 0), upgrade(9, 8),
    upgrade(10, 3),
  ],
} satisfies ChapterIsland;
