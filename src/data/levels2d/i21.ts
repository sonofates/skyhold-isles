import { build, group, upgrade, type ChapterIsland } from './chapterIsland.ts';
import { gridSizeFor, parseLevel2D } from './loader.ts';
import json from './i21.json';

const layout2d = parseLevel2D(json);

// The ground column passes the inside bends twice. The flight line cuts straight across the fallen kite.
export const I21 = {
  id: 'i21',
  index: 20,
  name: 'Kitewright Down',
  subtitle: 'The weather kite is down. Hold the chalk bends while the kitewright winds in the broken line.',
  difficulty: 'Master',
  ...gridSizeFor(layout2d),
  layout2d,
  pathWaypoints: [],
  flightPath: [],
  decorationSeed: 1117,
  startingGold: 345,
  enemyHpScale: 2.68,
  waveHpGrowth: 0.101,
  waves: [
    { name: 'Broken Spar', clearBonus: 24, groups: [
      group('bellrunner', 7, 0.72),
      group('grunt', 11, 0.53, 2.6),
    ] },
    { name: 'A Spool Unwinds', clearBonus: 26, groups: [
      group('mite', 21, 0.24),
      group('splitter', 5, 0.79, 1.1),
      group('brute', 4, 1.1, 4.2),
    ] },
    { name: 'Up on the Thermals', clearBonus: 28, groups: [
      group('draftwing', 4, 0.48),
      group('flyer', 4, 0.83, 2.9),
      group('bellrunner', 7, 0.55, 4.1),
    ] },
    { name: 'Two Taut Lines', clearBonus: 29, groups: [
      group('kilnback', 5, 1.31),
      group('reedpiper', 2, 1.74, 0.5),
      group('runner', 13, 0.37, 4.7),
    ] },
    { name: 'The Winch Sticks', clearBonus: 32, groups: [
      group('warden', 3, 1.54),
      group('hexer', 3, 1.39, 1.0),
      { ...group('golem', 4, 1.21, 2.8), hpScale: 1.5 },
      group('healer', 2, 1.47, 4.4),
      { ...group('kilnback', 7, 0.82, 1.4), elite: true },
    ] },
    { name: 'Across the Chalk', clearBonus: 34, groups: [
      group('carrier', 2, 2.65),
      { ...group('draftwing', 5, 0.55, 1.3), elite: true },
      { ...group('bellrunner', 9, 0.51, 3.7), elite: true },
    ] },
    { name: 'A Snarl in the Line', clearBonus: 36, groups: [
      group('burrower', 8, 0.78),
      { ...group('kilnback', 5, 1.12, 0.7), elite: true },
      group('reedpiper', 3, 1.61, 1.8),
      group('splitter', 7, 0.63, 3.9),
    ] },
    { name: 'Running Out of Reel', clearBonus: 39, groups: [
      { ...group('golem', 5, 1.27), elite: true },
      group('healer', 3, 1.17, 0.8),
      group('blinker', 8, 0.63, 2.1),
      group('mite', 20, 0.21, 4.6),
    ] },
    { name: 'The Kite Rises', clearBonus: 40, groups: [
      group('draftwing', 5, 0.52),
      { ...group('carrier', 2, 1.97, 2.8), elite: true },
      { ...group('brute', 7, 0.98, 1.2), elite: true },
      group('bellrunner', 12, 0.43, 5.5),
    ] },
    { name: 'Above the Crossbar', clearBonus: 42, groups: [
      { ...group('kilnback', 7, 1.05), elite: true },
      group('reedpiper', 4, 1.29, 0.6),
      group('warden', 3, 1.25, 1.2),
      group('blinker', 9, 0.53, 5.3),
    ] },
    { name: 'Tail Bows', clearBonus: 44, groups: [
      { ...group('burrower', 10, 0.81), elite: true },
      group('splitter', 11, 0.64, 1.4),
      group('draftwing', 7, 0.47, 4.3),
      { ...group('bellrunner', 9, 0.51, 7.2), elite: true },
    ] },
    { name: 'The Mail Run', clearBonus: 60, groups: [
      { ...group('golem', 5, 0.94), elite: true },
      group('healer', 4, 1.15, 0.6),
      { ...group('kilnback', 8, 1.03, 1.6), elite: true },
      group('bellrunner', 15, 0.39, 3.9),
      { ...group('draftwing', 6, 0.54, 6.1), elite: true },
    ] },
  ],
  scriptedBuildOrder: [
    build(0, 10, 'tesla'), build(0, 11, 'barracks'), build(0, 18, 'archer'),
    build(1, 16, 'cannon'), build(1, 19, 'frost'), upgrade(2, 10),
    build(2, 2, 'archer'), build(3, 15, 'ballista', 'strongest'), upgrade(3, 16),
    build(4, 8, 'mortar'), upgrade(4, 18), build(5, 12, 'tesla'),
    upgrade(5, 15), upgrade(6, 10), build(6, 4, 'ballista'),
    upgrade(7, 19), upgrade(7, 11), upgrade(8, 16), upgrade(8, 12),
    upgrade(9, 4), upgrade(9, 15), upgrade(10, 2), upgrade(10, 8), upgrade(10, 18),
    upgrade(11, 12), upgrade(11, 19), upgrade(11, 4), upgrade(11, 8),
  ],
  weakBuildOrder: [
    build(0, 2, 'archer'), build(0, 14, 'cannon'), build(0, 15, 'archer'),
    build(1, 9, 'frost'), build(2, 3, 'cannon'), build(3, 7, 'archer'),
    build(4, 17, 'ballista'), upgrade(4, 2), upgrade(5, 14), upgrade(6, 15),
    upgrade(7, 9), upgrade(8, 3),
  ],
} satisfies ChapterIsland;
