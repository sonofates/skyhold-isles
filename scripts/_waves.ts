import { LEVELS } from '../src/data/levels/index.ts';
import { ENEMY_DEFS } from '../src/data/enemies.ts';

const only = process.argv[2] ? Number(process.argv[2]) : 0;
for (const L of LEVELS) {
  if (only && L.index + 1 !== only) continue;
  const hs = L.enemyHpScale ?? 1;
  const g = L.waveHpGrowth ?? 0;
  console.log(`\n== L${L.index + 1} ${L.name} [${L.difficulty}] gold ${L.startingGold} hpScale ${hs} growth ${g}`);
  L.waves.forEach((w, i) => {
    let hp = 0;
    const mult = hs * (1 + g * i);
    const parts = w.groups.map((gr) => {
      hp += ENEMY_DEFS[gr.enemyType].maxHp * gr.count * mult;
      return `${gr.enemyType}×${gr.count}@${gr.spawnInterval}+${gr.startDelay}`;
    });
    const dur = Math.max(...w.groups.map((gr) => gr.startDelay + gr.spawnInterval * (gr.count - 1)));
    console.log(`  W${String(i + 1).padStart(2)} bonus${String(w.clearBonus).padStart(3)} hp~${String(Math.round(hp)).padStart(5)} dur${dur.toFixed(0).padStart(3)}s  ${parts.join('  ')}`);
  });
}
