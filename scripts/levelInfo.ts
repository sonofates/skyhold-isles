// Prints per-level path lengths (tiles) and a layout map with the flight path overlaid.
import { LEVELS } from '../src/data/levels/index.ts';

const len = (w: readonly { col: number; row: number }[]) =>
  w.reduce((s, p, i) => (i === 0 ? 0 : s + Math.hypot(p.col - w[i - 1].col, p.row - w[i - 1].row)), 0);

for (const L of LEVELS) {
  const g = len(L.pathWaypoints);
  const f = len(L.flightPath);
  const flyers = L.waves.map((w) =>
    w.groups.filter((x) => x.enemyType === 'flyer').reduce((s, x) => s + x.count, 0),
  );
  console.log(
    `\nL${L.index + 1} ${L.name} (${L.difficulty}) ${L.cols}x${L.rows} ground ${g.toFixed(1)} flight ${f.toFixed(1)} (${((f / g) * 100).toFixed(0)}%) gold ${L.startingGold} hp ${L.enemyHpScale}+${L.waveHpGrowth}/w waves ${L.waves.length}`,
  );
  console.log('flyers/wave: ' + flyers.join(','));
  console.log('flight: ' + L.flightPath.map((p) => `${p.col},${p.row}`).join(' '));
  const rows = L.layout.map((r) => r.trim().split(/\s+/));
  const cov = new Set<string>();
  for (let i = 1; i < L.flightPath.length; i++) {
    const a = L.flightPath[i - 1];
    const b = L.flightPath[i];
    const n = Math.ceil(Math.hypot(b.col - a.col, b.row - a.row) * 4);
    for (let k = 0; k <= n; k++) {
      cov.add(`${Math.round(a.col + ((b.col - a.col) * k) / n)},${Math.round(a.row + ((b.row - a.row) * k) / n)}`);
    }
  }
  const towerMark: Record<string, string> = { archer: 'A', cannon: 'C', frost: 'F', tesla: 'Z', mortar: 'M' };
  const towers = new Map<string, string>();
  for (const a of L.scriptedBuildOrder ?? []) {
    if (a.action === 'build' && a.towerType) towers.set(`${a.col},${a.row}`, towerMark[a.towerType]);
  }
  console.log(
    rows
      .map((r, ri) =>
        r
          .map((c, ci) => {
            const t = towers.get(`${ci},${ri}`);
            if (t) return t;
            return cov.has(`${ci},${ri}`) ? (c === '.' || c === 'T' ? '*' : c.toLowerCase()) : c;
          })
          .join(' '),
      )
      .join('\n'),
  );
}
