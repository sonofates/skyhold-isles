import type { EnemyType } from '../core/types.ts';

export interface EnemyDef {
  readonly type: EnemyType;
  readonly name: string;
  readonly description: string;
  readonly maxHp: number;
  readonly speed: number;
  readonly armor: number;
  readonly reward: number;
  readonly livesCost: number;
  readonly flying: boolean;
  readonly radius: number;
  readonly height: number;
  readonly healAmount?: number;
  readonly healRadius?: number;
  readonly healInterval?: number;
}

export const ENEMY_DEFS: Record<EnemyType, EnemyDef> = {
  grunt: {
    type: 'grunt',
    name: 'Raider Grunt',
    description: 'Balanced foot soldier marching steadily along the road.',
    maxHp: 75,
    speed: 2.3,
    armor: 0,
    reward: 4,
    livesCost: 1,
    flying: false,
    radius: 0.42,
    height: 1.05,
  },
  runner: {
    type: 'runner',
    name: 'Zephyr Runner',
    description: 'Swift scout with light health that sprints past slow turrets.',
    maxHp: 46,
    speed: 4.0,
    armor: 0,
    reward: 3,
    livesCost: 1,
    flying: false,
    radius: 0.36,
    height: 0.95,
  },
  brute: {
    type: 'brute',
    name: 'Iron Brute',
    description: 'Heavily armored juggernaut. Reduces flat damage from every hit.',
    maxHp: 260,
    speed: 1.45,
    armor: 6,
    reward: 7,
    livesCost: 2,
    flying: false,
    radius: 0.56,
    height: 1.35,
  },
  flyer: {
    type: 'flyer',
    name: 'Sky Skimmer',
    description: 'Soars over terrain along aerial lanes. Only anti-air towers can hit it.',
    maxHp: 59,
    speed: 2.56,
    armor: 0,
    reward: 4,
    livesCost: 1,
    flying: true,
    radius: 0.44,
    height: 0.9,
  },
  healer: {
    type: 'healer',
    name: 'Grove Mender',
    description: 'Periodically emits a restorative aura that heals nearby allies.',
    maxHp: 120,
    speed: 1.95,
    armor: 1,
    reward: 6,
    livesCost: 2,
    flying: false,
    radius: 0.45,
    height: 1.2,
    healAmount: 22,
    healRadius: 3.8,
    healInterval: 2.6,
  },
  splitter: {
    type: 'splitter',
    name: 'Cinder Splitling',
    description: 'Volatile ember construct that fractures into two swift hatchlings on death.',
    maxHp: 118,
    speed: 2.0,
    armor: 1,
    reward: 5,
    livesCost: 1,
    flying: false,
    radius: 0.46,
    height: 1.08,
  },
  boss: {
    type: 'boss',
    name: 'Skyhold Dreadnought',
    description: 'Colossal armored warlord. Costs 5 lives if it reaches the sanctuary.',
    maxHp: 1380,
    speed: 1.15,
    armor: 8,
    reward: 35,
    livesCost: 5,
    flying: false,
    radius: 0.78,
    height: 1.85,
  },
};

export const ENEMY_TYPES: readonly EnemyType[] = [
  'grunt',
  'runner',
  'brute',
  'flyer',
  'healer',
  'splitter',
  'boss',
];
