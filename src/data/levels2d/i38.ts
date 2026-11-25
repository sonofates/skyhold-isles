import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i38.json';

const layout2d = parseLevel2D(json);

/** A Dusk Hound pack: 4-6 hounds 0.35 s apart, so a kill enrages the mates around it. */
const pack = (count: number, startDelay: number, hpScale: number) =>
  ({ ...group('duskhound', count, 0.35, startDelay), hpScale });

export const I38 = {
  id: 'i38',
  index: 37,
  name: 'Shardfloat Isles',
  subtitle: 'Three shards hang from a single cable. Guard the bridgeheads while the tender takes up the slack.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1583,
  startingGold: 415,
  enemyHpScale: 2.416,
  waveHpGrowth: 0.1,
  waves: [
    { name: 'Sound the Span', clearBonus: 25, groups: [
      group('bellrunner', 8, 0.54), group('warden', 3, 1.2, 2),
    ] },
    // Introduces the Dusk Hound: two tight five-strong packs across the first span.
    { name: 'Paws on Planks', clearBonus: 27, groups: [
      pack(5, 0, 3), pack(5, 4.5, 4.5), group('brute', 3, 1.2, 8),
    ] },
    { name: 'Survey Lamps', clearBonus: 29, groups: [
      group('mite', 13, 0.3), group('reedpiper', 3, 1.38, 2), group('draftwing', 4, 0.93, 4),
    ] },
    { name: 'Cable Call', clearBonus: 30, groups: [
      group('splitter', 5, 0.84), group('bellrunner', 8, 0.5, 3), group('healer', 2, 1.44, 5),
    ] },
    { name: 'Quartz Dust', clearBonus: 32, groups: [
      group('kilnback', 5, 1.07), group('blinker', 8, 0.68, 2),
    ] },
    { name: 'First Abutment', clearBonus: 34, groups: [
      group('sledguard', 5, 1.44), group('hexer', 3, 1.34, 3), pack(6, 5, 2.5),
    ] },
    { name: 'Wire Song', clearBonus: 36, groups: [
      group('draftwing', 5, 0.91), group('burrower', 7, 0.8, 1.8), group('warden', 4, 1.15, 3),
    ] },
    { name: 'Moving Shore', clearBonus: 38, groups: [
      { ...group('brute', 7, 1.0), elite: true }, group('healer', 3, 1.4, 2),
      group('bellrunner', 10, 0.51, 5),
    ] },
    { name: 'Loose Pin', clearBonus: 39, groups: [
      group('carrier', 2, 2.2), group('mite', 15, 0.29, 2), group('kilnback', 6, 1.03, 4),
      pack(5, 4, 3),
    ] },
    { name: 'Return Pulley', clearBonus: 41, groups: [
      { ...group('splitter', 7, 0.79), elite: true }, group('blinker', 9, 0.66, 2),
      group('reedpiper', 4, 1.32, 5),
    ] },
    { name: 'Three Lanterns', clearBonus: 43, groups: [
      group('sledguard', 6, 1.39), group('bellrunner', 12, 0.48, 2), group('burrower', 9, 0.74, 4),
    ] },
    { name: 'The Long Crossing', clearBonus: 45, groups: [
      { ...group('golem', 3, 1.15), elite: true, hpScale: 2.56 }, pack(6, 2, 1.5),
      group('hexer', 3, 1.26, 5), pack(6, 7, 1.5),
    ] },
    { name: 'Anchor Shoes', clearBonus: 47, groups: [
      group('kilnback', 7, 1.06), group('draftwing', 5, 0.91, 1.5), group('healer', 3, 1.31, 4),
    ] },
    { name: 'Final Rivet', clearBonus: 60, groups: [
      { ...group('sledguard', 4, 1.37), elite: true, hpScale: 2.75 }, group('splitter', 8, 0.79, 3),
      group('bellrunner', 12, 0.48, 6),
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 4, 'tesla'), build(0, 12, 'barracks'), build(0, 9, 'archer'),
    build(1, 7, 'frost'), build(1, 3, 'ballista'), upgrade(2, 4),
    build(2, 10, 'mortar'), upgrade(3, 9), build(3, 11, 'cannon'),
    upgrade(4, 3), build(4, 15, 'tesla'), upgrade(5, 12),
    build(5, 6, 'ballista'), upgrade(6, 11), build(6, 16, 'archer'),
    upgrade(7, 7), upgrade(7, 4), upgrade(7, 10),
    upgrade(7, 15), upgrade(8, 6), upgrade(8, 3),
    upgrade(8, 9), upgrade(9, 16), upgrade(9, 11),
    upgrade(9, 12), upgrade(10, 7), upgrade(10, 10),
    upgrade(10, 15), upgrade(11, 6), upgrade(11, 16),
  ],
  weakBuildOrder: [
    build(0, 0, 'tesla'), build(0, 16, 'barracks'), build(0, 9, 'archer'),
    build(1, 7, 'frost'), build(1, 3, 'ballista'), upgrade(2, 0),
    upgrade(3, 9), upgrade(4, 3), build(4, 15, 'tesla'),
    upgrade(5, 16), build(5, 6, 'ballista'), upgrade(7, 7),
    upgrade(7, 0), upgrade(7, 15), upgrade(8, 6),
    upgrade(8, 3), upgrade(8, 9), upgrade(9, 16),
    upgrade(10, 7), upgrade(10, 15), upgrade(11, 6),
  ],
} satisfies ChapterIsland;
