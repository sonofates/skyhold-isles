import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i40.json';

const layout2d = parseLevel2D(json);

export const I40 = {
  id: 'i40',
  index: 39,
  name: 'Starfall Crater',
  subtitle: 'Hold the ash switchback while the assayer sorts the fallen star. Long-range towers can reach through a veil.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1665,
  startingGold: 425,
  enemyHpScale: 2.65,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'First Veil', clearBonus: 25, groups: [
      group('veilcaster', 2, 2), group('grunt', 8, 0.70, 2),
    ] },
    { name: 'Scree Dogs', clearBonus: 27, groups: [
      group('duskhound', 5, 0.40), group('runner', 8, 0.52, 3), group('duskhound', 5, 0.40, 7),
    ] },
    { name: 'Sample Trays', clearBonus: 29, groups: [
      group('warden', 4, 1.2), group('burrower', 6, 0.85, 2), group('draftwing', 4, 1, 5),
    ] },
    { name: 'Fall Line', clearBonus: 30, groups: [
      group('kilnback', 4, 1.25), group('veilcaster', 3, 1.6, 2), group('mite', 10, 0.32, 5),
    ] },
    { name: 'Glint in the Pan', clearBonus: 32, groups: [
      group('splitter', 5, 1), group('healer', 3, 1.45, 2), group('bellrunner', 9, 0.48, 4),
    ] },
    { name: 'Blue Cinders', clearBonus: 34, groups: [
      group('sledguard', 4, 1.38), group('duskhound', 6, 0.42, 2), group('duskhound', 5, 0.42, 7),
    ] },
    { name: 'Glass Seam', clearBonus: 36, groups: [
      group('blinker', 8, 0.76), group('veilcaster', 3, 1.41, 1), group('carrier', 2, 2.3, 5),
    ] },
    { name: 'Slipping Shale', clearBonus: 38, groups: [
      { ...group('kilnback', 4, 1.14), elite: true, hpScale: 2.1 }, group('reedpiper', 3, 1.31, 3), group('runner', 8, 0.54, 6),
    ] },
    { name: 'Sifted Silver', clearBonus: 39, groups: [
      group('burrower', 7, 0.82), group('warden', 5, 1.13, 1), group('draftwing', 5, 0.98, 4),
    ] },
    { name: 'The Darkened Lamp', clearBonus: 41, groups: [
      group('veilcaster', 4, 1.28), group('splitter', 7, 0.88, 1), group('duskhound', 6, 0.38, 5),
    ] },
    { name: 'Iron Rain', clearBonus: 43, groups: [
      group('brute', 6, 1.03), group('blinker', 7, 0.72, 2), group('healer', 3, 1.39, 4),
    ] },
    { name: 'A Second Impact', clearBonus: 45, groups: [
      { ...group('golem', 3, 1.21), elite: true, hpScale: 2 }, group('veilcaster', 3, 1.4, 2), group('mite', 11, 0.33, 4),
    ] },
    { name: 'Glow in the Sieve', clearBonus: 47, groups: [
      group('sledguard', 5, 1.31), group('bellrunner', 12, 0.48, 3), group('reedpiper', 3, 1.24, 5),
    ] },
    { name: 'Assay Fire', clearBonus: 49, groups: [
      group('duskhound', 6, 0.38), group('kilnback', 6, 1.12, 2), group('duskhound', 6, 0.38, 6), group('veilcaster', 3, 1.35, 8),
    ] },
    { name: 'Heart of the Fall', clearBonus: 60, groups: [
      { ...group('sledguard', 4, 1.27), elite: true, hpScale: 2.1 }, group('warden', 5, 1.04, 2), group('burrower', 7, 0.78, 5),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 7, 'tesla'), build(0, 10, 'barracks'), build(0, 11, 'archer'),
    build(1, 3, 'frost'), build(1, 6, 'ballista'), upgrade(2, 7),
    build(2, 8, 'mortar'), upgrade(3, 11), build(3, 2, 'cannon'),
    upgrade(4, 6), build(4, 12, 'tesla'), upgrade(5, 10),
    build(5, 14, 'ballista'), upgrade(6, 2), build(6, 5, 'archer'),
    upgrade(7, 3), upgrade(7, 7), upgrade(7, 8),
    upgrade(7, 12), upgrade(8, 14), upgrade(8, 6),
    upgrade(8, 11), upgrade(9, 5), upgrade(9, 2),
    upgrade(9, 10), upgrade(10, 3), upgrade(10, 8),
    upgrade(10, 12), upgrade(11, 14), upgrade(11, 5),
  ],
  weakBuildOrder: [
    build(0, 0, 'tesla'), build(0, 1, 'barracks'), build(0, 4, 'archer'),
    build(1, 8, 'frost'), build(1, 3, 'ballista'), upgrade(2, 0),
    upgrade(3, 4), upgrade(4, 3), build(4, 15, 'tesla'),
    upgrade(5, 1), build(5, 13, 'ballista'), upgrade(7, 8),
    upgrade(7, 0), upgrade(7, 15), upgrade(8, 13),
    upgrade(8, 3), upgrade(8, 4), upgrade(9, 1),
    upgrade(10, 8), upgrade(10, 15), upgrade(11, 13),
  ],
} satisfies ChapterIsland;
