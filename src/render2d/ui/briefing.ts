/**
 * Island briefing card (world map → tap an island): the island's vignette in a medallion, name on
 * the ribbon, subtitle, difficulty, best stars + the 3-star goal, records, the run modes (island
 * challenges and Endless, once the isle has been won) and Play.
 *
 * Modes: each challenge is a medallion switch showing its rule and badge state; several may be on
 * together. Endless is a separate switch and runs without challenges, so turning it on clears them
 * (and the other way round). Play hands the choice to `onPlay`, which builds the run URL.
 */
import type { ChallengeId } from '../../data/challenges.ts';
import { describeStarGoals } from '../../data/stars.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { el, glyph, img, KIT, medal, openSheet, plank, starsRow, type Sheet } from './dom.ts';
import { endlessRecordText, tierColour } from './modeBits.ts';
import type { AvailableChallenge2D } from './modes2d.ts';
import { ruleSeal } from './metaScreens.ts';
import type { IslandState } from './progress2d.ts';

const GEM: Record<LevelDef['difficulty'], string> = {
  Breezy: '#6fbf45',
  Challenging: '#3f8fd8',
  Heroic: '#b04fd0',
  Master: '#f2b33d',
};

export interface RunChoice {
  readonly challenges: ChallengeId[];
  readonly endless: boolean;
}

export interface BriefingModes {
  /** `availableChallenges(...)`: empty until the isle is won once. */
  readonly challenges: readonly AvailableChallenge2D[];
  /** `canPlayEndless(...)`. */
  readonly endless: boolean;
  /** Pre-selected modes (e.g. QA). */
  readonly initial?: Partial<RunChoice>;
}

/** A row switch: medallion seal (with a check when on), name + rule, and a state on the right. */
function modeSwitch(seal: HTMLElement, name: string, rule: string, state: HTMLElement, testid: string): HTMLButtonElement {
  const b = el('button', 'pu-mode', { type: 'button', role: 'switch', 'aria-checked': 'false', 'data-testid': testid });
  const sealBox = el('span', 'pu-mode-seal', {}, seal, img(KIT.confirm, '', 'pu-mode-check'));
  b.append(sealBox, el('span', 'pu-mode-text pu-ink', {}, name, el('small', 'pu-ink-soft', {}, rule)), state);
  b.setAttribute('aria-label', `${name}: ${rule}`);
  return b;
}

function endlessSeal(): HTMLSpanElement {
  const s = el('span', 'pu-round', { 'aria-hidden': 'true' });
  s.append(glyph('endless'));
  return s;
}

export function showBriefing(st: IslandState, prev: LevelDef | null, thumb: string | null, modes: BriefingModes, onPlay: (choice: RunChoice) => void): Sheet {
  const lvl = st.level;
  const hasModes = st.unlocked && (modes.challenges.length > 0 || modes.endless);
  const sheet = openSheet(lvl.name, { cls: `pu-brief${hasModes ? ' has-modes' : ''}`, testid: 'brief2d' });
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
  } else if (st.unlocked) {
    info.append(el('div', 'pu-brief-row pu-brief-hint pu-ink-soft', { 'data-testid': 'brief2d-modes-hint' }, glyph('lock'), 'Win this isle once to open its challenges and Endless'));
  }
  const thumbBox = medal(thumb, 'calc(var(--s) * 14)', st.frontier && st.unlocked);
  thumbBox.classList.add('pu-brief-medal');
  if (!st.unlocked) {
    const lock = el('span', 'pu-node-lock');
    lock.append(glyph('lock'));
    thumbBox.append(lock);
    thumbBox.querySelector<HTMLElement>('.pu-medal-thumb')!.style.filter = 'grayscale(.85) brightness(.72)';
  }

  // --- run modes ---------------------------------------------------------------------------------
  const chosen = new Set<ChallengeId>();
  let endless = false;
  const chSwitches: { id: ChallengeId; b: HTMLButtonElement }[] = [];
  let endlessSwitch: HTMLButtonElement | null = null;
  let modesBox: HTMLElement | null = null;
  if (hasModes) {
    modesBox = el('div', 'pu-modes', { 'data-testid': 'brief2d-modes' });
    if (modes.challenges.length > 0) {
      const earned = modes.challenges.filter((c) => c.completed).length;
      modesBox.append(el('div', 'pu-modes-head pu-letter', {}, 'Challenges', el('small', '', {}, `${earned}/${modes.challenges.length} badges`)));
      for (const c of modes.challenges) {
        const state = c.completed
          ? el('span', 'pu-mode-state done pu-ink', { title: 'Badge earned' }, glyph('medal'), 'Earned')
          : el('span', 'pu-mode-state pu-ink', { title: 'Win with this rule for a badge and a bonus star' }, img(KIT.star), '+1');
        const b = modeSwitch(ruleSeal(c.id), c.name, c.description, state, `brief2d-ch-${c.id}`);
        chSwitches.push({ id: c.id, b });
        modesBox.append(b);
      }
    }
    if (modes.endless) {
      const rec = endlessRecordText(st.bestEndlessWave, lvl.waves.length);
      const medalTag = el('span', 'pu-mode-medal', {}, rec.tierName ? `${rec.tierName} medal` : 'No medal yet');
      if (rec.tier > 0) medalTag.style.setProperty('--tier', tierColour(rec.tier));
      const state = el('span', `pu-mode-state pu-ink${rec.tier > 0 ? ' done' : ''}`, {}, medalTag, rec.next ? el('small', 'pu-ink-soft', {}, rec.next) : null);
      endlessSwitch = modeSwitch(endlessSeal(), 'Endless tide', `Waves keep coming past wave ${lvl.waves.length}. No challenges.`, state, 'brief2d-endless');
      endlessSwitch.classList.add('endless');
      modesBox.append(el('div', 'pu-modes-head pu-letter', {}, 'Endless', el('small', '', {}, rec.tier > 0 || st.bestEndlessWave > lvl.waves.length ? `Best: ${rec.best.toLowerCase()}` : rec.best)), endlessSwitch);
    }
  }

  const play = st.unlocked
    ? plank(st.clears > 0 ? 'Replay' : 'Play', { kind: 'primary', icon: 'play', testid: 'brief2d-play', sub: hasModes ? 'Campaign' : undefined })
    : plank('Locked', { kind: 'primary', icon: 'lock', testid: 'brief2d-play', sub: prev ? `Win ${prev.name} first` : undefined });
  play.disabled = !st.unlocked;

  const paint = (): void => {
    for (const { id, b } of chSwitches) {
      b.setAttribute('aria-checked', String(chosen.has(id)));
      b.classList.toggle('muted', endless);
    }
    endlessSwitch?.setAttribute('aria-checked', String(endless));
    if (!hasModes) return;
    const label = play.lastElementChild!;
    const sub = endless ? 'Endless' : chosen.size > 0 ? `${chosen.size} ${chosen.size > 1 ? 'challenges' : 'challenge'}` : 'Campaign';
    label.replaceChildren(endless ? 'Set sail' : st.clears > 0 ? 'Replay' : 'Play', el('span', 'pu-plank-sub', {}, sub));
  };
  for (const { id, b } of chSwitches) {
    b.addEventListener('click', () => {
      if (chosen.has(id)) chosen.delete(id);
      else chosen.add(id);
      endless = false;
      paint();
    });
  }
  endlessSwitch?.addEventListener('click', () => {
    endless = !endless;
    if (endless) chosen.clear();
    paint();
  });
  if (modes.initial?.endless && endlessSwitch) endless = true;
  else for (const id of modes.initial?.challenges ?? []) if (chSwitches.some((c) => c.id === id)) chosen.add(id);
  paint();

  play.addEventListener('click', () => {
    sheet.close();
    onPlay({ challenges: endless ? [] : [...chosen], endless });
  });
  const left = el('div', 'pu-brief-main', {}, thumbBox, info);
  sheet.body.append(el('div', 'pu-brief-body', {}, left, modesBox), el('div', 'pu-brief-actions', {}, play));
  requestAnimationFrame(() => play.focus({ preventScroll: true }));
  return sheet;
}
