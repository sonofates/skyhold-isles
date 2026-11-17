import type { ArtManifest, EnemyArt } from './manifest.ts';
import { enemyArtFor } from './manifest.ts';
import type { EnemyType, TowerType } from '../core/types.ts';

/**
 * Pure fallback resolution for art that is still on its way (no Pixi, so it is unit-testable and
 * shared by the loader and the `?artcheck=1` overlay). `present(path)` says whether a manifest
 * file (path relative to the manifest) exists / loaded.
 */
export type Present = (path: string) => boolean;

const MAX_HOPS = 6;

/** Multiply two 0xRRGGBB tints. */
export function mulTint(a: number, b: number): number {
  const r = (((a >> 16) & 255) * ((b >> 16) & 255)) / 255;
  const g = (((a >> 8) & 255) * ((b >> 8) & 255)) / 255;
  const bl = ((a & 255) * (b & 255)) / 255;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** Linear mix of two 0xRRGGBB colours (t = 0 → a, 1 → b). */
export function mixTint(a: number, b: number, t: number): number {
  const k = Math.max(0, Math.min(1, t));
  const r = ((a >> 16) & 255) * (1 - k) + ((b >> 16) & 255) * k;
  const g = ((a >> 8) & 255) * (1 - k) + ((b >> 8) & 255) * k;
  const bl = (a & 255) * (1 - k) + (b & 255) * k;
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

/** True when the art has its own front sprite or a complete walk sheet pair. */
export function enemyHasArt(art: EnemyArt, present: Present): boolean {
  if (present(art.file)) return true;
  return !!art.sheet && present(art.sheet.down) && present(art.sheet.up);
}

export interface EnemyResolution {
  /** Art key whose textures are drawn. */
  readonly key: string;
  /** Multiply tint accumulated along the fallback chain. */
  readonly tint: number;
  /** Scale multiplier accumulated along the fallback chain. */
  readonly scale: number;
  /** True when `key` is the requested art itself (not a fallback). */
  readonly own: boolean;
  readonly chain: readonly string[];
}

/** Follows `fallback` links until an art key that has files (or the chain ends). */
export function resolveEnemyArt(manifest: ArtManifest, key: string, present: Present): EnemyResolution {
  let cur = key;
  let tint = 0xffffff;
  let scale = 1;
  const chain = [key];
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const art = manifest.enemies[cur];
    if (!art || enemyHasArt(art, present) || !art.fallback || !manifest.enemies[art.fallback.art]) break;
    tint = mulTint(tint, art.fallback.tint ?? 0xffffff);
    scale *= art.fallback.scale ?? 1;
    cur = art.fallback.art;
    chain.push(cur);
  }
  return { key: cur, tint, scale, own: cur === key, chain };
}

/** Sim enemy type → resolved art (tint/scale of the enemyMap entry NOT included). */
export function resolveEnemyType(manifest: ArtManifest, type: EnemyType, flying: boolean, present: Present): EnemyResolution {
  return resolveEnemyArt(manifest, enemyArtFor(manifest, type, flying).art, present);
}

/**
 * Tier art: tier `tier` (1-based) uses the highest present tier at or below it, else the lowest
 * present tier above it. -1 when no tier file exists.
 */
export function pickTier(has: readonly boolean[], tier: number): number {
  for (let i = Math.min(tier, has.length) - 1; i >= 0; i--) if (has[i]) return i;
  for (let i = tier; i < has.length; i++) if (has[i]) return i;
  return -1;
}

export interface TowerResolution {
  /** Tower whose files are drawn. */
  readonly source: string;
  readonly tint: number;
  readonly own: boolean;
  /** Per tier 1..3: the file drawn (manifest-relative), or null when nothing is available. */
  readonly tierFiles: readonly (string | null)[];
}

export function resolveTowerTiers(manifest: ArtManifest, type: string, present: Present): TowerResolution {
  let cur = type;
  let tint = 0xffffff;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const art = manifest.towers[cur as TowerType];
    if (!art) break;
    const has = art.tiers.map((f) => present(f));
    if (has.some(Boolean) || !art.fallback || !manifest.towers[art.fallback.tower as TowerType]) {
      const files = [1, 2, 3].map((t) => {
        const i = pickTier(has, t);
        return i >= 0 ? art.tiers[i] : null;
      });
      return { source: cur, tint, own: cur === type, tierFiles: files };
    }
    tint = mulTint(tint, art.fallback.tint ?? 0xffffff);
    cur = art.fallback.tower;
  }
  return { source: cur, tint, own: cur === type, tierFiles: [null, null, null] };
}

export type MatrixCell = boolean | null;

export interface ArtRow {
  readonly kind: 'enemy' | 'tower';
  readonly id: string;
  /** Sim types that use this art (enemies). */
  readonly types: readonly string[];
  readonly cells: Readonly<Record<string, MatrixCell>>;
  /** What is actually drawn right now. */
  readonly effective: string;
  readonly complete: boolean;
}

const ENEMY_SLOTS = ['front', 'back', 'down', 'up', 'mound'] as const;

/** One row per enemy art key referenced by enemyMap and per tower, for the artcheck overlay. */
export function buildArtMatrix(manifest: ArtManifest, present: Present): ArtRow[] {
  const rows: ArtRow[] = [];
  const typesByArt = new Map<string, string[]>();
  for (const [type, e] of Object.entries(manifest.enemyMap)) {
    if (type.startsWith('*')) continue;
    const list = typesByArt.get(e.art) ?? [];
    list.push(type);
    typesByArt.set(e.art, list);
  }
  for (const [key, types] of typesByArt) {
    const art = manifest.enemies[key];
    if (!art) continue;
    const cells: Record<string, MatrixCell> = {
      front: present(art.file),
      back: art.back ? present(art.back) : null,
      down: art.sheet ? present(art.sheet.down) : null,
      up: art.sheet ? present(art.sheet.up) : null,
      mound: art.mound ? present(art.mound) : null,
    };
    const res = resolveEnemyArt(manifest, key, present);
    const own = enemyHasArt(art, present);
    const complete = ENEMY_SLOTS.every((s) => cells[s] !== false);
    rows.push({
      kind: 'enemy',
      id: key,
      types,
      cells,
      effective: own ? (cells.down && cells.up ? 'sheet' : 'sprite') : res.own ? 'missing' : `→ ${res.key}`,
      complete,
    });
  }
  for (const [type, art] of Object.entries(manifest.towers)) {
    if (!art) continue;
    const cells: Record<string, MatrixCell> = {};
    art.tiers.forEach((f, i) => (cells[`t${i + 1}`] = present(f)));
    for (let i = art.tiers.length; i < 3; i++) cells[`t${i + 1}`] = null;
    const res = resolveTowerTiers(manifest, type, present);
    const anyOwn = art.tiers.some((f) => present(f));
    rows.push({
      kind: 'tower',
      id: type,
      types: [type],
      cells,
      effective: anyOwn ? 'art' : res.own ? 'missing' : `→ ${res.source}`,
      complete: Object.values(cells).every((c) => c !== false),
    });
  }
  return rows;
}

/** Every manifest-relative file the renderer may load for enemies and towers (for coverage tests). */
export function listArtFiles(manifest: ArtManifest): string[] {
  const out = new Set<string>();
  for (const e of Object.values(manifest.enemies)) {
    out.add(e.file);
    if (e.back) out.add(e.back);
    if (e.mound) out.add(e.mound);
    if (e.sheet) {
      out.add(e.sheet.down);
      out.add(e.sheet.up);
    }
    for (const f of e.frames ?? []) out.add(f);
  }
  for (const t of Object.values(manifest.towers)) for (const f of t?.tiers ?? []) out.add(f);
  return [...out];
}
