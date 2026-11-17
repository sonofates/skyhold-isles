import { describe, expect, it } from 'vitest';
import { LEVELS } from '../../src/data/levels/index.ts';

// Same rules as the ISLANDS branch's waveNames test for islands 1-9 (flavour names, data only).
describe('named waves (islands 10+)', () => {
  for (const level of LEVELS.slice(9)) {
    it(`${level.name}: every wave has a short unique name`, () => {
      const seen = new Set<string>();
      level.waves.forEach((w, i) => {
        expect(w.name, `wave ${i + 1} has no name`).toBeTruthy();
        const name = w.name as string;
        expect(name.length).toBeLessThanOrEqual(32);
        expect(seen.has(name), `duplicate wave name "${name}"`).toBe(false);
        seen.add(name);
      });
    });
  }
});
