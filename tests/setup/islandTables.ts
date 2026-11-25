/**
 * The per-island ambient / map-life tables are lazy chunks in the game (src/render2d/islandTable.ts):
 * the battle loads its island's file before it builds the map layers. Tests read them through the
 * synchronous getters for any island, so every table is loaded up front here (vitest setupFiles).
 */
import { loadIslandTables } from '../../src/render2d/islandTable.ts';

await loadIslandTables('all');
