/**
 * Island briefing card (world map → tap an island): the island's vignette in a medallion, name on
 * the ribbon, subtitle, difficulty, best stars + the 3-star goal, records and Play.
 */
import { describeStarGoals } from '../../data/stars.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { el, glyph, medal, openSheet, plank, starsRow, type Sheet } from './dom.ts';
import type { IslandState } from './progress2d.ts';

const GEM: Record<LevelDef['difficulty'], string> = {
  Breezy: '#6fbf45',
  Challenging: '#3f8fd8',
  Heroic: '#b04fd0',
  Master: '#f2b33d',
};

export function showBriefing(st: IslandState, prev: LevelDef | null, thumb: string | null, onPlay: () => void): Sheet {
  const lvl = st.level;
  const sheet = openSheet(lvl.name, { cls: 'pu-brief', testid: 'brief2d' });
  const goals = describeStarGoals(lvl.difficulty);
  const gem = el('span', 'pu-gem pu-ink', {}, lvl.difficulty);
  gem.style.setProperty('--gem', GEM[lvl.difficulty] ?? GEM.Breezy);
  const info = el(
    'div',
    'pu-brief-info',
    {},
    el('div', 'pu-brief-sub pu-ink-soft', {}, lvl.subtitle),
    el('div', 'pu-brief-row', {}, gem, el('span', 'pu-rec pu-ink', {}, glyph('wave'), `${lvl.waves.length} waves`)),
    el('div', 'pu-brief-row', {}, starsRow(st.stars), el('span', 'pu-ink-soft', {}, st.stars === 3 ? 'Perfect defence' : `3★: ${goals.three}`)),
  );
  if (st.unlocked && st.clears > 0) {
    info.append(
      el(
        'div',
        'pu-brief-row',
        {},
        el('span', 'pu-rec pu-ink', { title: 'Best lives left' }, glyph('heart'), `${st.bestLives} best`),
        el('span', 'pu-rec pu-ink', { title: 'Victories' }, glyph('trophy'), `${st.clears}× won`),
        st.mastered ? el('span', 'pu-rec pu-ink', {}, glyph('crown'), 'Mastered') : null,
      ),
    );
  }
  const thumbBox = medal(thumb, 'calc(var(--s) * 14)', st.frontier && st.unlocked);
  if (!st.unlocked) {
    const lock = el('span', 'pu-node-lock');
    lock.append(glyph('lock'));
    thumbBox.append(lock);
    thumbBox.querySelector<HTMLElement>('.pu-medal-thumb')!.style.filter = 'grayscale(.85) brightness(.72)';
  }
  const play = st.unlocked
    ? plank(st.clears > 0 ? 'Replay' : 'Play', { kind: 'primary', icon: 'play', testid: 'brief2d-play' })
    : plank('Locked', { kind: 'primary', icon: 'lock', testid: 'brief2d-play', sub: prev ? `Win ${prev.name} first` : undefined });
  play.disabled = !st.unlocked;
  play.addEventListener('click', () => {
    sheet.close();
    onPlay();
  });
  sheet.body.append(el('div', 'pu-brief-body', {}, thumbBox, info), el('div', 'pu-brief-actions', {}, play));
  requestAnimationFrame(() => play.focus({ preventScroll: true }));
  return sheet;
}
