import { expect, it } from 'vitest';
import { EventBus } from '../../src/core/eventBus.ts';
import { ENEMY_DEFS } from '../../src/data/enemies.ts';
import { LEVELS_2D } from '../../src/data/levels2d/index.ts';
import { WaveSystem } from '../../src/sim/waveSystem.ts';

// Neutral story HP multipliers, including the late-wave escalation.
// Keep both endpoints fixed even if the number of waves or the runtime formula changes.
const baseline = [
  ['l1c', 1.38, 3.396703],
  ['i01', 1.144, 2.231892],
  ['i02', 1.741, 6.957253],
  ['i03', 1.6232, 9.617328],
  ['i04', 1.167, 5.014815],
  ['i05', 1.6688, 7.396187],
  ['i06', 1.3623, 11.358132],
  ['i07', 1.7108, 10.136351],
  ['i08', 2.0577, 15.776437],
  ['i09', 1.9549, 17.166632],
  ['i10', 1.0533, 7.857947],
  ['i11', 1.9624, 16.668383],
  ['i12', 2.307, 17.892207],
  ['i13', 1.8298, 13.841877],
  ['i14', 3.2809, 14.189736],
  ['i15', 4.22, 14.980064],
  ['i16', 2.3, 12.448034],
  ['i17', 2.0128, 4.235097],
  ['i18', 2.3266, 5.446910],
  ['i19', 1.7346, 4.060952],
  ['i20', 2.0128, 5.106203],
  ['i21', 2.6554, 6.736393],
  ['i22', 1.8952, 5.197992],
  ['i23', 2.4832, 6.810708],
  ['i24', 1.965, 5.814709],
  ['i25', 2.1, 5.048363],
  ['i26', 2.31, 6.162879],
  ['i27', 1.62, 4.443197],
  ['i28', 1.98, 5.430574],
  ['i29', 2.95, 8.091007],
  ['i30', 2.42, 6.637368],
] as const;

// Named finale formations have their own HP on top of the story curve.
const finaleHp: Record<string, Record<string, number>> = {
  i02: { boss: 1.5 }, i04: { boss: 1.6 }, i05: { boss: 1.3 },
  i10: { boss: 2.5 },
  i17: { 'golem:1': 0.8 }, i22: { golem: 1.8 }, i24: { tempest: 2 }, i27: { 'golem:1': 2 },
};

it.each(baseline)('%s keeps its first and last story wave ground HP within ten percent', (id, first, last) => {
  const level = LEVELS_2D.find(island => island.id === id)!;
  const waves = new WaveSystem(level, new EventBus());
  for (const [wave, expected] of [[1, first], [level.waves.length, last]]) {
    waves.skipToWave(wave);
    const scales = new Set<number>();
    waves.update(Infinity, () => 1, (type, scale, _elite, lane, groupScale) => {
      if (ENEMY_DEFS[type].flying) return;
      const formation = wave === level.waves.length ? finaleHp[id] : undefined;
      expect(groupScale).toBe(formation?.[`${type}:${lane}`] ?? formation?.[type] ?? 1);
      scales.add(scale);
    }, () => {}, () => {});
    expect(scales.size, `ground spawns on wave ${wave}`).toBeGreaterThan(0);
    for (const scale of scales) {
      expect(scale, `wave ${wave}`).toBeGreaterThanOrEqual(expected * 0.9);
      expect(scale, `wave ${wave}`).toBeLessThanOrEqual(expected * 1.1);
    }
  }
});
