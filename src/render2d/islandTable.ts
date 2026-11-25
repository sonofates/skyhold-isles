/**
 * Per-island JSON tables (src/data/ambientFx, mapAnim, mapLife) loaded one island at a time.
 *
 * They used to be eager `import.meta.glob`s, so every battle downloaded every island's table
 * (~100 kB of JSON for 46 islands). Now each file is its own lazy chunk: the battle loads the
 * one island it plays before it builds the map layers (battle2d.ts `loadIslandTables`), and the
 * getters stay synchronous. Tests load every table up front (tests/setup/islandTables.ts), so the
 * sync getters and `list()` read exactly as before there (docs/handoff-perf.md). This module has
 * no Pixi import, so that setup stays cheap.
 */
import type { AmbientFxConfig } from './ambientFx.ts';
import type { AmbientMap } from './mapAnimLayer.ts';
import type { MapLifeConfig } from './mapLifeLayer.ts';

export interface IslandTable<T> {
  /** The island's table once loaded (undefined: not loaded yet, or the island has none). */
  get(island: string): T | undefined;
  /** Every loaded table, in file-name order (= the old eager glob's order once all are loaded). */
  list(): readonly T[];
  /** Loads one island's table (no-op when it has none or it is already loaded). */
  load(island: string): Promise<void>;
  /** Loads every table (tests, tools). */
  loadAll(): Promise<void>;
}

/** `loaders` is a lazy `import.meta.glob(..., { import: 'default' })` over `${dir}<island>.json`. */
export function islandTable<T>(dir: string, loaders: Record<string, () => Promise<T>>): IslandTable<T> {
  const loaded = new Map<string, T>();
  const pending = new Map<string, Promise<void>>();
  const keys = Object.keys(loaders).sort();
  const load = (path: string): Promise<void> => {
    if (loaded.has(path)) return Promise.resolve();
    const loader = loaders[path];
    if (!loader) return Promise.resolve();
    let p = pending.get(path);
    if (!p) {
      p = loader().then((value) => {
        loaded.set(path, value);
        pending.delete(path);
      });
      pending.set(path, p);
    }
    return p;
  };
  return {
    get: (island) => loaded.get(`${dir}${island}.json`),
    list: () => keys.filter((k) => loaded.has(k)).map((k) => loaded.get(k)!),
    load: (island) => load(`${dir}${island}.json`),
    loadAll: async () => {
      await Promise.all(keys.map(load));
    },
  };
}

/** src/data/ambientFx/<island>.json (procedural ambient FX; ambientFx.ts). */
export const AMBIENT_FX_TABLE = islandTable('../data/ambientFx/', import.meta.glob<AmbientFxConfig>('../data/ambientFx/*.json', { import: 'default' }));
/** src/data/mapAnim/<island>.json (ambient video map; mapAnimLayer.ts). */
export const MAP_ANIM_TABLE = islandTable('../data/mapAnim/', import.meta.glob<AmbientMap>('../data/mapAnim/*.json', { import: 'default' }));
/** src/data/mapLife/<island>.json (procedural map life; mapLifeLayer.ts). */
export const MAP_LIFE_TABLE = islandTable('../data/mapLife/', import.meta.glob<MapLifeConfig>('../data/mapLife/*.json', { import: 'default' }));

/** Loads one island's ambient / map-life tables (`all`: every island — tests and tools). */
export function loadIslandTables(island: string | 'all'): Promise<void> {
  const tables = [AMBIENT_FX_TABLE, MAP_ANIM_TABLE, MAP_LIFE_TABLE] as const;
  return Promise.all(tables.map((t) => (island === 'all' ? t.loadAll() : t.load(island)))).then(() => undefined);
}
