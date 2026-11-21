// Contiguous wall-clock phases on the Performance timeline, including navigation to JS entry.
const enabled = typeof location !== 'undefined' && new URLSearchParams(location.search).get('boottrace') === '1';
let previous: string | undefined;

export function bootPhase(name: string): void {
  if (!enabled) return;
  const mark = 'boot:' + name;
  performance.mark(mark);
  performance.measure(mark, previous, mark);
  previous = mark;
}

export function reportBoot(): void {
  if (!enabled) return;
  console.table(performance.getEntriesByType('measure').filter(e => e.name.startsWith('boot:')).map(e => ({
    phase: e.name.slice(5).replaceAll('-', ' '), ms: Math.round(e.duration), sinceNavigationMs: Math.round(e.startTime + e.duration),
  })));
}
