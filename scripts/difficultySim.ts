/**
 * Difficulty pass (informational, NOT part of the sim:balance gate): every 2D island on Easy /
 * Normal / Hard (src/data/difficulty.ts patches on top of the island's own tuning) with a few
 * player kits, so the difficulty numbers can be re-checked whenever the islands are retuned.
 *
 * Kits (all use the island's greedy build script; `weak` uses its weak script):
 *   bare    no hero, no Workshop       (the sim:balance gate's reference run)
 *   bran1   the default hero (Bran) at level 1, default skills, scripted to hold the merge point
 *   bran10  Bran at level 10
 *   vet     Bran 10 + every Workshop upgrade at max (a veteran who picks Hard)
 *   weak    weak script, no hero        (a clumsy player — Easy should carry them further)
 *
 * Targets (docs/difficulty.md): Easy — bare greedy wins every island with lives to spare; Hard —
 * a kitted greedy player (bran10 / vet) wins most islands but loses lives doing it.
 *
 *   npm run sim:difficulty                         table + verdict over all 2D islands
 *   npm run sim:difficulty -- --levels=l1c,i05     a few islands
 *   npm run sim:difficulty -- --md                 markdown table (docs/difficulty.md)
 *   npm run sim:difficulty -- --sweep=hard --kit=bran10   candidate Hard patches
 *   npm run sim:difficulty -- --sweep=easy                candidate Easy patches
 */
import { BALANCE } from '../src/data/balance.ts';
import { DIFFICULTIES, DIFFICULTY_IDS, withDifficulty, type DifficultyId } from '../src/data/difficulty.ts';
import type { LevelDef } from '../src/data/levels/index.ts';
import { LEVELS_2D } from '../src/data/levels2d/index.ts';
import { combineRunModifiers, NEUTRAL_RUN_MODIFIERS, type RunModifierPatch, type RunModifiers } from '../src/data/runModifiers.ts';
import { maxedWorkshopRanks, workshopModifiers } from '../src/data/workshop.ts';
import { runLevelBalanceSim } from './balanceSim.ts';
import { runHeroIslandSim } from './heroBalance.ts';

type Kit = 'bare' | 'bran1' | 'bran10' | 'vet' | 'weak';
const KITS: readonly Kit[] = ['bare', 'bran1', 'bran10', 'vet', 'weak'];

interface Cell {
  readonly won: boolean;
  readonly lost: number;
  readonly start: number;
  readonly wave: number;
  readonly stars: number;
}

const WORKSHOP_MAX = workshopModifiers(maxedWorkshopRanks());

/** One run of `level` with `kit` and the difficulty / candidate patch `extra` on top. */
function run(level: LevelDef, kit: Kit, extra: RunModifierPatch | DifficultyId): Cell {
  const base: RunModifiers = kit === 'vet' ? WORKSHOP_MAX : NEUTRAL_RUN_MODIFIERS;
  const mods = typeof extra === 'string' ? withDifficulty(base, extra) : combineRunModifiers(base, extra);
  const start = mods.maxLives ?? BALANCE.startingLives + mods.bonusLives;
  let won: boolean;
  let lives: number;
  let wave: number;
  let stars: number;
  if (kit === 'bare' || kit === 'weak') {
    const r = runLevelBalanceSim(level, kit === 'bare' ? 'greedy' : 'weak', (kit === 'bare' ? level.scriptedBuildOrder : level.weakBuildOrder) ?? [], mods);
    won = r.outcome === 'won';
    lives = r.finalLives;
    wave = r.waves.length;
    stars = r.stars;
  } else {
    const r = runHeroIslandSim(level, 'greedy', 'bran', kit === 'bran1' ? 1 : 10, undefined, mods);
    won = r.outcome === 'won';
    lives = r.finalLives;
    wave = r.wavesReached;
    stars = r.stars;
  }
  return { won, lost: won ? start - lives : start, start, wave, stars: won ? stars : 0 };
}

const fmt = (c: Cell): string => (c.won ? `W ${String(c.start - c.lost).padStart(2)}/${c.start} ${c.stars}*` : `L @${c.wave}`);

function sweep(which: 'hard' | 'easy', kit: Kit, levels: readonly LevelDef[]): void {
  const grid: RunModifierPatch[] = [];
  if (which === 'hard') {
    for (const hp of [1.1, 1.15, 1.2, 1.3])
      for (const sp of [1, 1.04])
        for (const gold of [0.9, 1])
          for (const lives of [null, 15, 10]) grid.push({ enemyHpMul: hp, enemySpeedMul: sp, startGoldMul: gold, maxLives: lives, heroRespawnMul: 1.25 });
  } else {
    for (const hp of [0.75, 0.7, 0.65])
      for (const gold of [1.25, 1.4])
        for (const lives of [5, 10]) grid.push({ enemyHpMul: hp, enemySpeedMul: 0.92, startGoldMul: gold, bonusLives: lives });
  }
  console.log(`sweep ${which}, kit ${kit}, ${levels.length} islands`);
  for (const patch of grid) {
    let wins = 0;
    let bleed = 0;
    let lostSum = 0;
    let minLeft = Infinity;
    const lostOn: string[] = [];
    for (const level of levels) {
      const c = run(level, kit, patch);
      lostSum += c.lost;
      if (c.won) {
        wins++;
        if (c.lost > 0) bleed++;
        minLeft = Math.min(minLeft, c.start - c.lost);
      } else lostOn.push(level.id);
    }
    console.log(
      `${JSON.stringify(patch).padEnd(110)} W ${String(wins).padStart(2)}/${levels.length} bleed ${String(bleed).padStart(2)} avgLost ${(lostSum / levels.length).toFixed(1).padStart(4)} minLeft ${minLeft === Infinity ? '-' : minLeft}  lostOn ${lostOn.join(',')}`,
    );
  }
}

function main(): void {
  const argOf = (k: string): string | undefined => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
  const levelArg = argOf('levels');
  const filter = levelArg ? new Set(levelArg.split(',').map((s) => s.trim())) : null;
  const levels = LEVELS_2D.filter((l) => !filter || filter.has(l.id));
  const sweepArg = argOf('sweep');
  if (sweepArg === 'hard' || sweepArg === 'easy') {
    const kitArg = argOf('kit') as Kit | undefined;
    sweep(sweepArg, kitArg && KITS.includes(kitArg) ? kitArg : 'bare', levels);
    return;
  }
  const md = process.argv.includes('--md');
  /** Columns: kit × difficulty. */
  const COLS: readonly [Kit, DifficultyId][] = [
    ['bare', 'easy'],
    ['bare', 'normal'],
    ['bare', 'hard'],
    ['bran1', 'normal'],
    ['bran1', 'hard'],
    ['bran10', 'normal'],
    ['bran10', 'hard'],
    ['vet', 'normal'],
    ['vet', 'hard'],
    ['weak', 'easy'],
    ['weak', 'normal'],
  ];
  const rows: { id: string; tier: string; cells: Cell[] }[] = [];
  if (md) {
    console.log(`| Island | Tier | ${COLS.map(([k, d]) => `${k} ${d}`).join(' | ')} |`);
    console.log(`|---|---|${COLS.map(() => '---').join('|')}|`);
  } else console.log(`island tier        ${COLS.map(([k, d]) => `${k} ${d}`.padEnd(13)).join(' ')}`);
  for (const level of levels) {
    const cells = COLS.map(([k, d]) => run(level, k, d));
    rows.push({ id: level.id, tier: level.difficulty, cells });
    if (md) console.log(`| ${level.id} | ${level.difficulty} | ${cells.map(fmt).join(' | ')} |`);
    else console.log(`${level.id.padEnd(6)} ${level.difficulty.padEnd(11)} ${cells.map((c) => fmt(c).padEnd(13)).join(' ')}`);
  }
  const n = rows.length;
  console.log('');
  for (const d of DIFFICULTY_IDS) console.log(`${d.padEnd(6)} patch ${JSON.stringify(DIFFICULTIES[d].patch)}`);
  console.log('');
  COLS.forEach(([k, d], ci) => {
    const cs = rows.map((r) => r.cells[ci]);
    const wins = cs.filter((c) => c.won);
    const avgLost = cs.reduce((s, c) => s + c.lost, 0) / Math.max(1, n);
    console.log(
      `${`${k} ${d}`.padEnd(13)} wins ${String(wins.length).padStart(2)}/${n}  bleeding wins ${String(wins.filter((c) => c.lost > 0).length).padStart(2)}  flawless ${String(wins.filter((c) => c.lost === 0).length).padStart(2)}  avg lives lost ${avgLost.toFixed(1)}`,
    );
  });
  const col = (k: Kit, d: DifficultyId): Cell[] => rows.map((r) => r.cells[COLS.findIndex(([a, b]) => a === k && b === d)]);
  const easyOk = col('bare', 'easy').every((c) => c.won && c.start - c.lost >= 15);
  const hard = col('bran10', 'hard');
  const vet = col('vet', 'hard');
  console.log('');
  console.log(`Easy: bare greedy wins every island with >= 15 lives left: ${easyOk ? 'yes' : 'NO'}`);
  console.log(`Hard: bran10 greedy wins ${hard.filter((c) => c.won).length}/${n} (losing lives on ${hard.filter((c) => c.won && c.lost > 0).length}); vet wins ${vet.filter((c) => c.won).length}/${n} (losing lives on ${vet.filter((c) => c.won && c.lost > 0).length})`);
}

main();
