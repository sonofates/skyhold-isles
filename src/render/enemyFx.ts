import type { EventBus } from '../core/eventBus.ts';
import { PALETTE_HEX } from '../data/palette.ts';
import type { EffectsRenderer } from './effectsRenderer.ts';

const WARD_BLUE = 0x9fdcff;
const BLINK_AQUA = 0x3fe0d0;
const FROST_CRACK = 0xcfefff;

/**
 * Hit / ability FX for the newer enemy archetypes (warden, burrower, hauler, blinker, golem).
 * Reuses the pooled particle / pulse-ring / shard buckets of EffectsRenderer — no new draw calls.
 * Returns unsubscribe callbacks so the caller can drop them on level change.
 */
export function bindEnemyArchetypeFx(
  events: EventBus,
  fx: EffectsRenderer,
): Array<() => void> {
  return [
    events.on('wardPulse', (e) => {
      fx.spawnPulseRing(e.x, e.y, e.z, e.radius, WARD_BLUE);
      fx.spawnParticles(e.x, e.y + 1.2, e.z, PALETTE_HEX.gold, 5, 1.6, 1.0);
    }),
    events.on('shieldBroken', (e) => {
      fx.spawnParticles(e.x, e.y, e.z, WARD_BLUE, 9, 3.0, 3.5);
      fx.spawnParticles(e.x, e.y, e.z, PALETTE_HEX.cream, 4, 2.4, 3.5);
    }),
    events.on('enemyBurrow', (e) => {
      fx.spawnParticles(e.x, e.y + 0.15, e.z, PALETTE_HEX.dirt, 10, 2.6, 7.5);
      fx.spawnParticles(e.x, e.y + 0.1, e.z, PALETTE_HEX.sand, 5, 2.0, 7.5);
      if (!e.burrowed) {
        fx.spawnPulseRing(e.x, e.y + 0.06, e.z, 1.0, PALETTE_HEX.dirt);
      }
    }),
    events.on('enemyBlink', (e) => {
      fx.spawnParticles(e.fromX, e.fromY + 0.6, e.fromZ, BLINK_AQUA, 9, 2.8, 0.5);
      fx.spawnParticles(e.toX, e.toY + 0.6, e.toZ, PALETTE_HEX.cream, 7, 2.4, 0.5);
      fx.spawnPulseRing(e.toX, e.toY + 0.08, e.toZ, 1.2, BLINK_AQUA);
    }),
    events.on('carrierDrop', (e) => {
      fx.spawnParticles(e.x, e.y + 0.4, e.z, PALETTE_HEX.sand, 10, 3.0, 6.0);
      fx.spawnPulseRing(e.groundX, e.groundY + 0.08, e.groundZ, 1.4, PALETTE_HEX.coral);
      fx.spawnParticles(e.groundX, e.groundY + 0.3, e.groundZ, PALETTE_HEX.cream, 6, 2.2, 5.0);
    }),
    events.on('armorCracked', (e) => {
      fx.spawnDeathShards('golem', e.x, e.y, e.z);
      fx.spawnParticles(e.x, e.y, e.z, FROST_CRACK, 8, 2.6, 4.0);
    }),
  ];
}
