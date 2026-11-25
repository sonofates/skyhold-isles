/**
 * npm run sim:difficulty                         full campaign verdict
 * npm run sim:difficulty -- --md                 Markdown results table
 * npm run sim:difficulty -- --levels=l1c,i24     selected islands with full entry progression
 * npm run sim:difficulty -- --sweep=hard         probe nearby patches (--kit=campaign|weak|bare)
 */
import { DIFFICULTIES, DIFFICULTY_IDS, starsAwarded, type DifficultyId } from '../src/data/difficulty.ts';
import type { LevelDef } from '../src/data/levels/index.ts';
import { chapterOf } from '../src/data/chapters.ts';
import { LEVELS_2D } from '../src/data/levels2d/index.ts';
import { combineRunModifiers, type RunModifierPatch } from '../src/data/runModifiers.ts';
import { runLevelBalanceSim, type SimRunResult } from './balanceSim.ts';
import { balanceBuildOrder } from './lib/specializationBuilds.ts';
import { campaignKit, type CampaignKit } from './lib/campaignKit.ts';

type Profile = 'campaign' | 'weak' | 'bare';
const PROFILES: readonly Profile[] = ['campaign', 'weak', 'bare'];

function play(level: LevelDef, profile: Profile, kit: CampaignKit, patch: RunModifierPatch) {
  const weak = profile === 'weak';
  const loadout = profile === 'bare' ? combineRunModifiers(patch)
    : { ...kit, modifiers: combineRunModifiers(kit.modifiers, patch) };
  return runLevelBalanceSim(level, weak ? 'weak' : 'greedy',
    balanceBuildOrder(level, weak ? 'weak' : 'greedy'), loadout);
}

/** A fresh greedy clear earns the next island's hero XP and spendable Workshop stars. */
function firstClears(levels: readonly LevelDef[], difficulty: 'normal' | 'easy', patch: RunModifierPatch) {
  let xp = 0;
  let stars = 0;
  return levels.map(level => {
    const kit = campaignKit(xp, stars);
    const result = play(level, 'campaign', kit, patch);
    xp += result.heroXp;
    if (result.outcome === 'won') stars += starsAwarded(result.stars, difficulty);
    return { kit, result };
  });
}

function fmt(r: SimRunResult, d: DifficultyId): string {
  return r.outcome === 'won' ? `W ${r.finalLives}/${r.startingLives} ${starsAwarded(r.stars, d)}★` : `L @${r.waves.length}`;
}

function sweep(d: 'easy' | 'hard', profile: Profile, levels: readonly LevelDef[], selected: ReadonlySet<LevelDef>) {
  const base = DIFFICULTIES[d].patch;
  const normal = d === 'hard' ? firstClears(levels, 'normal', DIFFICULTIES.normal.patch) : null;
  for (const deltaHp of [-0.02, 0, 0.02]) {
    for (const deltaGold of [-0.05, 0, 0.05]) {
      const patch = { ...base, enemyHpMul: (base.enemyHpMul ?? 1) + deltaHp, startGoldMul: (base.startGoldMul ?? 1) + deltaGold };
      const entries = normal ?? firstClears(levels, 'easy', patch);
      const cells = levels.flatMap((level, i) => {
        if (!selected.has(level)) return [];
        const { kit, result } = entries[i];
        const r = d === 'easy' && profile === 'campaign' ? result : play(level, profile, kit, patch);
        return [{ level, r }];
      });
      const wins = cells.filter(({ r }) => r.outcome === 'won');
      console.log(`${d} ${profile} HP ×${patch.enemyHpMul.toFixed(2)} gold ×${patch.startGoldMul.toFixed(2)}`
        + ` wins ${wins.length}/${cells.length} | ${cells.map(({ level, r }) => `${level.id} ${fmt(r, d)}`).join(' | ')}`);
    }
  }
}

type Runs = Record<DifficultyId, Record<Profile, SimRunResult>>;
interface Row { level: LevelDef; runs: Runs }

function verdict(rows: Row[]): void {
  // Preserve the two historical balance cohorts as later chapters join the campaign.
  const one = rows.filter(r => (chapterOf(r.level.id)?.n ?? Infinity) <= 2);
  const two = rows.filter(r => chapterOf(r.level.id)?.id === 'ch3');
  const wins = (group: Row[], p: Profile, d: DifficultyId) => group.map(r => r.runs[d][p]).filter(r => r.outcome === 'won');
  const easy = wins(rows, 'campaign', 'easy');
  const comfortable = easy.filter(r => r.finalLives >= 12);
  const weakEasy = wins(one, 'weak', 'easy');
  const normal = wins(rows, 'campaign', 'normal');
  const hardOne = wins(one, 'campaign', 'hard');
  const hardTwo = wins(two, 'campaign', 'hard');
  const hard = wins(rows, 'campaign', 'hard');
  const narrow = hard.filter(r => r.finalLives < r.startingLives && r.stars <= 2);
  const finale = rows.find(r => r.level.id === 'i24')?.runs.hard.campaign;
  const weakHard = wins(rows, 'weak', 'hard');
  function check(ok: boolean, label: string) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) process.exitCode = 1;
  }
  check(easy.length === rows.length && comfortable.length === rows.length,
    `Easy campaign clears all ${rows.length} islands, each with ≥12 lives: ${easy.length}/${rows.length} wins, ${comfortable.length}/${rows.length} with ≥12`);
  check(weakEasy.length >= 14, `Easy weak clears at least 14 chapter-one islands: ${weakEasy.length}/${one.length}`);
  check(Object.keys(DIFFICULTIES.normal.patch).length === 0 && normal.length === rows.length,
    `Normal uses the island tuning and clears the campaign: ${normal.length}/${rows.length}`);
  const normalLives = (id: string) => rows.find(r => r.level.id === id)?.runs.normal.campaign.finalLives ?? 0;
  const frostveil = ['i28', 'i29', 'i30', 'i31', 'i32', 'i33'];
  const lives = frostveil.map(normalLives);
  check(lives[0] > normalLives('i24') && lives.every((n, i) => n > 0 && (i === 0 || n < lives[i - 1])),
    `Frostveil eases after Lastlight and rises on Normal: i24 ${normalLives('i24')}, ${frostveil.map((id, i) => id + ' ' + lives[i]).join(', ')} lives`);
  const finaleApproach = ['i33', 'i34', 'i35', 'i36'].map(normalLives);
  check(finaleApproach.every((n, i) => n > 0 && (i === 0 || n < finaleApproach[i - 1])),
    `Normal first clears tighten from Stillfall to the Citadel: ${finaleApproach.join(' > ')} lives`);
  const twos = normal.filter(r => r.stars === 2).length;
  const threes = normal.filter(r => r.stars === 3).length;
  check(twos > rows.length / 2 && threes <= Math.floor(rows.length * 0.4),
    `Normal first clears earn mostly 2★ and at most 40% 3★: ${twos} two-star, ${threes} three-star`);
  check(hardOne.length >= 9 && hardOne.length <= 11, `Hard campaign clears 9–11 islands in chapter one: ${hardOne.length}/${one.length}`);
  check(Math.abs(hardTwo.length - two.length / 2) <= 1,
    `Hard campaign clears about half of chapter two: ${hardTwo.length}/${two.length}`);
  check(hard.length > 0 && narrow.length === hard.length,
    `Hard campaign loses lives and earns 1–2★ on every win: ${narrow.length}/${hard.length}`);
  check(!!finale && finale.outcome === 'won' && finale.stars === 1 && finale.finalLives <= 5,
    `Hard campaign clears i24 with 1★ and ≤5 lives: ${finale ? fmt(finale, 'hard') : 'missing'}`);
  check(weakHard.length <= 3, `Hard weak loses almost everywhere: ${weakHard.length}/${rows.length} wins (at most 3)`);
}

function main(): void {
  const arg = (key: string) => process.argv.find(a => a.startsWith(`--${key}=`))?.slice(key.length + 3);
  const ids = arg('levels')?.split(',').map(s => s.trim());
  if (ids?.some(id => !LEVELS_2D.some(level => level.id === id))) throw new Error('Unknown island in --levels');
  const selected = new Set(LEVELS_2D.filter(level => !ids || ids.includes(level.id)));
  const levels = LEVELS_2D.slice(0, LEVELS_2D.findLastIndex(level => selected.has(level)) + 1);
  const sweepArg = arg('sweep');
  if (sweepArg === 'hard' || sweepArg === 'easy') {
    const profile = arg('kit') ?? 'campaign';
    if (profile !== 'campaign' && profile !== 'weak' && profile !== 'bare') throw new Error('Unknown --kit');
    sweep(sweepArg, profile, levels, selected);
    return;
  }

  const normal = firstClears(levels, 'normal', DIFFICULTIES.normal.patch);
  const easy = firstClears(levels, 'easy', DIFFICULTIES.easy.patch);
  const md = process.argv.includes('--md');
  const columns = PROFILES.flatMap(p => DIFFICULTY_IDS.map(d => ({ p, d })));
  const line = (cells: string[]) => console.log(md ? `| ${cells.join(' | ')} |` : cells.map(s => s.padEnd(15)).join(' ').trimEnd());
  line(['Island', ...columns.map(({ p, d }) => `${p} ${d}`)]);
  if (md) line(['---', ...columns.map(() => '---')]);
  const rows: Row[] = [];
  for (const [i, level] of levels.entries()) {
    if (!selected.has(level)) continue;
    function compare(d: DifficultyId) {
      const entry = d === 'easy' ? easy[i] : normal[i];
      const patch = DIFFICULTIES[d].patch;
      return {
        campaign: d === 'hard' ? play(level, 'campaign', entry.kit, patch) : entry.result,
        weak: play(level, 'weak', entry.kit, patch),
        bare: play(level, 'bare', entry.kit, patch),
      };
    }
    const runs = { easy: compare('easy'), normal: compare('normal'), hard: compare('hard') };
    rows.push({ level, runs });
    line([level.id, ...columns.map(({ p, d }) => fmt(runs[d][p], d))]);
  }
  console.log('');
  for (const p of PROFILES) {
    const totals = DIFFICULTY_IDS.map(d => `${d} ${rows.filter(row => row.runs[d][p].outcome === 'won').length}/${rows.length}`);
    console.log(`${p} wins   ${totals.join('   ')}`);
  }
  console.log('');
  if (selected.size === LEVELS_2D.length) verdict(rows);
  else console.log('Campaign verdict requires all islands.');
}

main();
