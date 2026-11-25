/** Prints every 2D island's chapter, wave count, difficulty, and HP curve endpoints. */
import { LEVELS_2D } from '../src/data/levels2d/index.ts';

interface Band {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly finale?: string;
}

const BANDS: readonly (Band & { match: (id: string) => boolean })[] = [
  { label: 'Prologue', min: 1, max: 99, match: (id) => id === 'l1c' },
  { label: 'Ch 1', min: 8, max: 11, finale: 'i09', match: (id) => /^i0[1-9]$/.test(id) },
  { label: 'Ch 2', min: 11, max: 13, finale: 'i16', match: (id) => /^i1[0-6]$/.test(id) },
  { label: 'Ch 3', min: 12, max: 14, finale: 'i24', match: (id) => /^i(1[7-9]|2[0-4])$/.test(id) },
  { label: 'Ch 4', min: 13, max: 15, finale: 'i36', match: (id) => /^i(2[89]|3[0-6])$/.test(id) },
];

function storyHpScale(base: number, growth: number, waveIndex: number): number {
  const linear = base * (1 + waveIndex * growth);
  return waveIndex <= 5 ? linear : linear * Math.pow(1.032, waveIndex - 5);
}

const md = process.argv.includes('--md');
const header = ['ID', 'Chapter', 'Name', 'Waves', 'Target', 'Difficulty', 'HP 1st', 'HP Last', 'Status'];
if (md) {
  console.log(`| ${header.join(' | ')} |`);
  console.log(`| ${header.map(() => '---').join(' | ')} |`);
} else {
  console.log(
    header
      .map((h, i) => h.padEnd([4, 8, 22, 5, 6, 11, 7, 7, 10][i]))
      .join('  '),
  );
}

for (const level of LEVELS_2D) {
  const band = BANDS.find((b) => b.match(level.id));
  const n = level.waves.length;
  const base = level.enemyHpScale ?? 1;
  const growth = level.waveHpGrowth ?? 0;
  const firstHp = storyHpScale(base, growth, 0);
  const lastHp = storyHpScale(base, growth, n - 1);

  let target = '-';
  let status = 'ok';
  if (band && band.label !== 'Prologue') {
    target = band.finale === level.id ? `${band.max}` : `${band.min}-${band.max}`;
    if (band.finale === level.id) {
      status = n === band.max ? 'ok' : `want ${band.max}`;
    } else if (n < band.min) {
      status = `short (-${band.min - n})`;
    } else if (n > band.max) {
      status = `long (+${n - band.max})`;
    }
  }

  const cells = [
    level.id,
    band?.label ?? '?',
    level.name,
    String(n),
    target,
    level.difficulty,
    firstHp.toFixed(3),
    lastHp.toFixed(3),
    status,
  ];
  if (md) {
    console.log(`| ${cells.join(' | ')} |`);
  } else {
    console.log(
      cells
        .map((c, i) => c.padEnd([4, 8, 22, 5, 6, 11, 7, 7, 10][i]))
        .join('  '),
    );
  }
}
