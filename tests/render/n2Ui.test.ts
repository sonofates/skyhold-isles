import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickTreeFit, TREE_FIT_STEPS, type TreeLayout } from '../../src/render2d/ui/heroScreens.ts';

describe('skill tree fit (heroScreens.ts)', () => {
  it('tries the vertical tree first, largest zoom first, then the across tree largest first', () => {
    const downs = TREE_FIT_STEPS.filter((s) => s[0] === 'down').map((s) => s[1]);
    const across = TREE_FIT_STEPS.filter((s) => s[0] === 'across').map((s) => s[1]);
    expect(TREE_FIT_STEPS[0]).toEqual(['down', 1]);
    expect(TREE_FIT_STEPS.findIndex((s) => s[0] === 'across')).toBe(downs.length);
    expect([...downs].sort((a, b) => b - a)).toEqual(downs);
    expect([...across].sort((a, b) => b - a)).toEqual(across);
    // Never shrinks the vertical tree a lot (it switches layout instead), nor the across one below ~3/4.
    expect(Math.min(...downs)).toBeGreaterThanOrEqual(0.8);
    expect(Math.min(...across)).toBeGreaterThanOrEqual(0.7);
  });

  it('picks the first step that fits, the smallest across step when nothing does', () => {
    const tried: string[] = [];
    const fit = (ok: (l: TreeLayout, z: number) => boolean) =>
      pickTreeFit((l, z) => {
        tried.push(`${l}${z}`);
        return ok(l, z);
      });
    expect(fit(() => true)).toEqual(['down', 1]);
    expect(fit((l, z) => l === 'down' && z <= 0.9)).toEqual(['down', 0.88]);
    expect(fit((l, z) => l === 'across' && z <= 1)).toEqual(['across', 1]);
    expect(fit(() => false)).toEqual(TREE_FIT_STEPS[TREE_FIT_STEPS.length - 1]);
    expect(tried.length).toBeGreaterThan(0);
  });

  it('node text keeps at least 90 % of its size whatever the zoom; the across layout has its connectors', () => {
    const css = readFileSync(join(__dirname, '../../src/render2d/ui/heroScreens.css'), 'utf8');
    expect(css).toMatch(/--nt: calc\(var\(--s\) \* max\(var\(--tz\), 0\.9\)\)/);
    expect(css).toMatch(/\.pu-hnode-name \{\s*font-size: calc\(var\(--nt\)/);
    expect(css).toContain(".pu-hero-tree-grid[data-layout='across'] .pu-hnode-wrap.tier4::after");
    expect(css).toContain(".pu-hero-tree-grid[data-layout='across'] .pu-hero-cap-bar");
  });
});
