/**
 * Tier-IV specialization portraits (manifest `towerSpecializations.<id>.portrait`) for the build
 * ring and the codex. Loaded lazily (a family's two when one of its towers reaches tier III), cached;
 * a failed request is retried on the next ask.
 */
import { Assets, type Texture } from 'pixi.js';
import type { TowerType } from '../core/types.ts';
import { specializationsFor } from '../data/towers.ts';
import type { LoadedArt } from './assets2d.ts';

const ready = new Map<string, Texture>();
const pending = new Map<string, Promise<Texture | null>>();

/** Portrait URL of a branch, or null when the manifest has none. */
export function specPortraitUrl(art: Pick<LoadedArt, 'manifest' | 'baseUrl'>, id: string): string | null {
  const f = art.manifest.specPortraits?.[id];
  return f ? art.baseUrl + f : null;
}

/** The portrait now (null while loading / missing). */
export function specPortrait(id: string): Texture | null {
  return ready.get(id) ?? null;
}

/** Loads a branch portrait (shared promise per id). */
export function loadSpecPortrait(art: LoadedArt, id: string): Promise<Texture | null> {
  const have = ready.get(id);
  if (have) return Promise.resolve(have);
  const p0 = pending.get(id);
  if (p0) return p0;
  const url = specPortraitUrl(art, id);
  if (!url) return Promise.resolve(null);
  const p = Assets.load<Texture>({ src: url, data: { autoGenerateMipmaps: true } })
    .then((tex) => {
      ready.set(id, tex);
      return tex;
    })
    .catch((err: unknown) => {
      console.warn(`[art2d] specialization portrait ${id} could not load`, err);
      return null;
    })
    .finally(() => pending.delete(id));
  pending.set(id, p);
  return p;
}

/** Starts loading both branch portraits of a family (a tower of it reached tier III). */
export function prefetchSpecPortraits(art: LoadedArt, type: TowerType): void {
  for (const b of specializationsFor(type)) void loadSpecPortrait(art, b.id);
}
