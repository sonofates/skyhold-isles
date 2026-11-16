import { describe, expect, it } from 'vitest';
import { resolveTap } from '../../src/platform/tapResolution.ts';

const empty = { col: 3, row: 4, towerId: -1, buildable: true };

describe('resolveTap', () => {
  it('builds on an empty buildable tile even when another tower silhouette covers it', () => {
    expect(resolveTap(empty, 7)).toEqual({ kind: 'build', col: 3, row: 4 });
  });

  it('selects the tower standing on the ground tile, ignoring a different silhouette', () => {
    expect(resolveTap({ ...empty, towerId: 2, buildable: false }, 9)).toEqual({ kind: 'tower', id: 2 });
  });

  it('falls back to the silhouette tower when the ground tile is path / water / decor', () => {
    const path = { col: 1, row: 1, towerId: -1, buildable: false };
    expect(resolveTap(path, 5)).toEqual({ kind: 'tower', id: 5 });
    expect(resolveTap(null, 5)).toEqual({ kind: 'tower', id: 5 });
  });

  it('returns none when nothing is hit', () => {
    expect(resolveTap({ col: 0, row: 0, towerId: -1, buildable: false }, null)).toEqual({ kind: 'none' });
    expect(resolveTap(null, null)).toEqual({ kind: 'none' });
    expect(resolveTap(null, -1)).toEqual({ kind: 'none' });
  });
});
