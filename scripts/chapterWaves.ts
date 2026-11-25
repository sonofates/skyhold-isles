/** Prints every 2D island's chapter, wave count, difficulty, and HP curve endpoints. */
import { chapterOf, type ChapterId } from '../src/data/chapters.ts';
import { LEVELS_2D } from '../src/data/levels2d/index.ts';

interface Band {
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly finale?: string;
}

const BANDS: Readonly<Record<ChapterId, Band>> = {
  prologue: { label: 'Prologue', min: 1, max: 99 },
  ch1: { label: 'Ch 1', min: 8, max: 11, finale: 'i09' },
  ch2: { label: 'Ch 2', min: 11, max: 13, finale: 'i16' },
  ch3: { label: 'Ch 3', min: 12, max: 14, finale: 'i24' },
  ch4: { label: 'Ch 4', min: 13, max: 15, finale: 'i36' },
  ch5: { label: 'Ch 5', min: 14, max: 16, finale: 'i45' },
};

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
  const chapter = chapterOf(level.id);
  const band = chapter ? BANDS[chapter.id] : undefined;
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
