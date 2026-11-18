/**
 * Pure + storage-backed settings helpers for the 2D renderer.
 *
 * Honours the shared `GameSettings` (`platform/storage`) and music volume (`audio/musicPrefs`)
 * that the Settings screen saves:
 *  - `audioSettings2d`: single canonical getter for master volume, music volume, and mute
 *    (2D has no WebAudio playback wired yet; future 2D audio consumers read this single source).
 *  - `triggerShake2D` / `stepShake2D`: damped view-shake state gated by `settings.cameraShake`.
 *  - `spawnDamageNumber2D` / `stepDamageNumbers2D`: pooled floating damage numbers with 150 ms
 *    per-enemy hit merging (matching 3D `FloatingTextPool`), gated by `settings.damageNumbers`.
 *  - `shouldVibrate2D`: touch haptics gate (`settings.haptics`).
 */
import { getMusicVolume } from '../audio/musicPrefs.ts';
import type { GameSettings } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { loadSettings } from '../platform/storage.ts';

export interface AudioSettings2D {
  readonly muted: boolean;
  readonly masterVolume: number;
  readonly musicVolume: number;
  /** Effective SFX gain in 0..1 (0 when muted or masterVolume <= 0.01). */
  readonly effectiveSfxVolume: number;
  /** Effective music gain in 0..1 (0 when muted, masterVolume <= 0.01, or musicVolume <= 0.005). */
  readonly effectiveMusicVolume: number;
}

function clamp01(v: number, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : fallback;
}

/**
 * Single canonical 2D audio settings getter combining shared `GameSettings` (`masterVolume`, `muted`)
 * and `musicPrefs` (`musicVolume`). Pure when explicit inputs are passed; reads live storage by default.
 */
export function audioSettings2d(
  settings: Pick<GameSettings, 'masterVolume' | 'muted'> = loadSettings(),
  musicVolume: number = getMusicVolume(),
): AudioSettings2D {
  const muted = Boolean(settings.muted);
  const master = clamp01(settings.masterVolume, 0.65);
  const music = clamp01(musicVolume, 0.6);
  const sfxAudible = !muted && master > 0.01;
  const musicAudible = sfxAudible && music > 0.005;
  return {
    muted,
    masterVolume: master,
    musicVolume: music,
    effectiveSfxVolume: sfxAudible ? master : 0,
    effectiveMusicVolume: musicAudible ? master * music : 0,
  };
}

// --- Screen shake (pure, matching 3D CameraController decay & cooldown) ------------------------

export const MAX_SHAKE_UNITS_2D = 0.15;
export const SHAKE_COOLDOWN_SEC_2D = 0.22;

export interface ShakeState2D {
  intensity: number;
  cooldown: number;
  phase: number;
  /** Offset in world units along x and z (multiply by `pxPerUnit * mapScale` for screen px). */
  offsetX: number;
  offsetY: number;
  triggers: number;
}

export function createShakeState2D(): ShakeState2D {
  return { intensity: 0, cooldown: 0, phase: 0, offsetX: 0, offsetY: 0, triggers: 0 };
}

export function resetShakeState2D(state: ShakeState2D): void {
  state.intensity = 0;
  state.cooldown = 0;
  state.phase = 0;
  state.offsetX = 0;
  state.offsetY = 0;
}

export function shouldShake2D(settings: Pick<GameSettings, 'cameraShake'>): boolean {
  return settings.cameraShake === true;
}

/**
 * Adds view shake in world units when `settings.cameraShake` is enabled.
 * Mirrors 3D `CameraController.addShake`: stronger blows during the cooldown raise amplitude
 * without letting rapid small hits stack unboundedly.
 */
export function triggerShake2D(
  state: ShakeState2D,
  amountUnits: number,
  settings: Pick<GameSettings, 'cameraShake'>,
): boolean {
  if (!shouldShake2D(settings) || !(amountUnits > 0)) return false;
  const clamped = Math.min(MAX_SHAKE_UNITS_2D, amountUnits);
  if (state.cooldown > 0) {
    state.intensity = Math.min(MAX_SHAKE_UNITS_2D, Math.max(state.intensity, clamped));
    return true;
  }
  state.intensity = Math.min(MAX_SHAKE_UNITS_2D, Math.max(state.intensity, clamped));
  state.cooldown = SHAKE_COOLDOWN_SEC_2D;
  state.triggers++;
  return true;
}

/** Advances view shake by `dt` seconds; clears offsets immediately if `cameraShake` was turned off. */
export function stepShake2D(
  state: ShakeState2D,
  dt: number,
  settings: Pick<GameSettings, 'cameraShake'>,
): void {
  if (!shouldShake2D(settings)) {
    resetShakeState2D(state);
    return;
  }
  if (!(dt > 0)) return;
  if (state.cooldown > 0) {
    state.cooldown = Math.max(0, state.cooldown - dt);
  }
  if (state.intensity > 0.001) {
    state.phase += dt * 42;
    state.offsetX = Math.sin(state.phase * 1.7) * state.intensity;
    state.offsetY = Math.cos(state.phase * 2.3) * state.intensity * 0.75;
    state.intensity *= Math.exp(-BALANCE.camera.shakeDecay * dt);
  } else {
    state.intensity = 0;
    state.offsetX = 0;
    state.offsetY = 0;
  }
}

// --- Floating damage numbers (pure pool, matching 3D FloatingTextPool merge rules) --------------

export const DAMAGE_POPUP_DURATION_SEC = 0.72;
export const HEAVY_DAMAGE_THRESHOLD = 55;

export interface DamagePopupSlot2D {
  active: boolean;
  enemyId: number;
  amount: number;
  heavy: boolean;
  createdSeq: number;
  lastUpdateSec: number;
  age: number;
  duration: number;
  x: number;
  y: number;
  z: number;
}

export interface DamagePopupPool2D {
  readonly slots: DamagePopupSlot2D[];
  seqCounter: number;
  spawned: number;
}

export interface DamageHitInput2D {
  readonly enemyId: number;
  readonly damage: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly isBoss?: boolean;
}

export function createDamagePopupPool2D(capacity = 28): DamagePopupPool2D {
  const slots: DamagePopupSlot2D[] = [];
  for (let i = 0; i < capacity; i++) {
    slots.push({
      active: false,
      enemyId: 0,
      amount: 0,
      heavy: false,
      createdSeq: 0,
      lastUpdateSec: 0,
      age: 0,
      duration: DAMAGE_POPUP_DURATION_SEC,
      x: 0,
      y: 0,
      z: 0,
    });
  }
  return { slots, seqCounter: 1, spawned: 0 };
}

export function clearDamagePopupPool2D(pool: DamagePopupPool2D): void {
  for (const s of pool.slots) s.active = false;
}

export function shouldShowDamageNumbers2D(
  settings: Pick<GameSettings, 'damageNumbers'>,
  damage = 1,
): boolean {
  return settings.damageNumbers === true && damage > 0;
}

/**
 * Spawns or merges a floating damage number when `settings.damageNumbers` is enabled.
 * Rapid hits on the same `enemyId` within `BALANCE.floatingTextMergeWindowSec` (150 ms) merge
 * into one rising number, identical to 3D `FloatingTextPool.spawnDamage`.
 */
export function spawnDamageNumber2D(
  pool: DamagePopupPool2D,
  hit: DamageHitInput2D,
  nowSec: number,
  settings: Pick<GameSettings, 'damageNumbers'>,
): DamagePopupSlot2D | null {
  const dmg = Math.round(hit.damage);
  if (!shouldShowDamageNumbers2D(settings, dmg)) return null;
  if (pool.slots.length === 0) return null;

  const mergeWindow = BALANCE.floatingTextMergeWindowSec;
  for (let i = 0; i < pool.slots.length; i++) {
    const s = pool.slots[i];
    if (s.active && s.enemyId === hit.enemyId && nowSec - s.lastUpdateSec <= mergeWindow) {
      s.amount += dmg;
      s.heavy = s.heavy || hit.isBoss === true || s.amount >= HEAVY_DAMAGE_THRESHOLD;
      s.lastUpdateSec = nowSec;
      s.age = 0.04;
      s.x = hit.x;
      s.y = hit.y;
      s.z = hit.z;
      return s;
    }
  }

  let target = pool.slots[0];
  for (let i = 0; i < pool.slots.length; i++) {
    const s = pool.slots[i];
    if (!s.active) {
      target = s;
      break;
    }
    if (s.createdSeq < target.createdSeq) target = s;
  }

  target.active = true;
  target.enemyId = hit.enemyId;
  target.amount = dmg;
  target.heavy = hit.isBoss === true || dmg >= HEAVY_DAMAGE_THRESHOLD;
  target.createdSeq = pool.seqCounter++;
  target.lastUpdateSec = nowSec;
  target.age = 0;
  target.duration = DAMAGE_POPUP_DURATION_SEC;
  target.x = hit.x;
  target.y = hit.y;
  target.z = hit.z;
  pool.spawned++;
  return target;
}

/** Steps active damage popups; clears them immediately if `settings.damageNumbers` is turned off. */
export function stepDamageNumbers2D(
  pool: DamagePopupPool2D,
  dt: number,
  settings: Pick<GameSettings, 'damageNumbers'>,
): number {
  if (!settings.damageNumbers) {
    clearDamagePopupPool2D(pool);
    return 0;
  }
  let active = 0;
  for (let i = 0; i < pool.slots.length; i++) {
    const s = pool.slots[i];
    if (!s.active) continue;
    if (dt > 0) s.age += dt;
    if (s.age >= s.duration) {
      s.active = false;
      continue;
    }
    active++;
  }
  return active;
}

// --- Haptics gate -------------------------------------------------------------------------------

export function shouldVibrate2D(settings: Pick<GameSettings, 'haptics'>, isTouch: boolean): boolean {
  return settings.haptics === true && isTouch === true;
}
