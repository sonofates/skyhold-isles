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
import { STAR_RULES } from '../../data/stars.ts';
import { challengeDesc, challengeName, difficultyName, islandName, islandSubtitle } from '../../i18n/data.ts';
import { lower, t } from '../../i18n/index.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { el, gemUrl, glyph, img, KIT, medal, openSheet, plank, sealBadge, starsRow, type Sheet } from './dom.ts';
import { endlessRecordText, tierColour } from './modeBits.ts';
import type { AvailableChallenge2D } from './modes2d.ts';
import { ruleSeal } from './metaScreens.ts';
import type { IslandState } from './progress2d.ts';

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
  return sealBadge('endless');
}

export function showBriefing(st: IslandState, prev: LevelDef | null, thumb: string | null, modes: BriefingModes, onPlay: (choice: RunChoice) => void): Sheet {
  const lvl = st.level;
  const hasModes = st.unlocked && (modes.challenges.length > 0 || modes.endless);
  const sheet = openSheet(islandName(lvl), { cls: `pu-brief${hasModes ? ' has-modes' : ''}`, testid: 'brief2d' });
  const lost3 = (STAR_RULES[lvl.difficulty] ?? STAR_RULES.Breezy).threeStarMaxLost;
  const goal3 = lost3 === 0 ? t('brief.goalNoLoss') : t('brief.goalLose', { n: lost3 });
  // Painted difficulty jewel in front of the name.
  const gem = el('span', 'pu-gem pu-ink', {}, img(gemUrl(lvl.difficulty), '', 'pu-gem-img'), difficultyName(lvl.difficulty));
  const info = el(
    'div',
    'pu-brief-info',
    {},
    el('div', 'pu-brief-sub pu-ink-soft', {}, islandSubtitle(lvl)),
    el('div', 'pu-brief-row', {}, gem, el('span', 'pu-rec pu-ink', {}, glyph('wave'), t('brief.waves', { n: lvl.waves.length }))),
    el('div', 'pu-brief-row', {}, starsRow(st.stars), el('span', 'pu-ink-soft', {}, st.stars === 3 ? t('brief.perfect') : t('brief.goal3', { goal: goal3 }))),
  );
  if (st.unlocked && st.clears > 0) {
    info.append(
      el(
        'div',
        'pu-brief-row',
        {},
        el('span', 'pu-rec pu-ink', { title: t('brief.bestLivesTitle') }, glyph('heart'), t('brief.bestLives', { n: st.bestLives })),
        el('span', 'pu-rec pu-ink', { title: t('brief.victoriesTitle') }, glyph('trophy'), t('brief.wins', { n: st.clears })),
        st.mastered ? el('span', 'pu-rec pu-ink', {}, glyph('crown'), t('brief.mastered')) : null,
      ),
    );
  } else if (st.unlocked) {
    info.append(el('div', 'pu-brief-row pu-brief-hint pu-ink-soft', { 'data-testid': 'brief2d-modes-hint' }, glyph('lock'), t('brief.modesLocked')));
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
      modesBox.append(el('div', 'pu-modes-head pu-letter', {}, t('brief.challenges'), el('small', '', {}, t('brief.badgesCount', { e: earned, n: modes.challenges.length }))));
      for (const c of modes.challenges) {
        const state = c.completed
          ? el('span', 'pu-mode-state done pu-ink', { title: t('brief.badgeEarnedTitle') }, glyph('medal'), t('brief.earned'))
          : el('span', 'pu-mode-state pu-ink', { title: t('brief.bonusTitle') }, img(KIT.star), '+1');
        const b = modeSwitch(ruleSeal(c.id), challengeName(c.id), challengeDesc(c.id), state, `brief2d-ch-${c.id}`);
        chSwitches.push({ id: c.id, b });
        modesBox.append(b);
      }
    }
    if (modes.endless) {
      const rec = endlessRecordText(st.bestEndlessWave, lvl.waves.length);
      const medalTag = el('span', 'pu-mode-medal', {}, rec.tierName ? t('brief.tierMedal', { tier: rec.tierName }) : t('brief.noMedal'));
      if (rec.tier > 0) medalTag.style.setProperty('--tier', tierColour(rec.tier));
      const state = el('span', `pu-mode-state pu-ink${rec.tier > 0 ? ' done' : ''}`, {}, medalTag, rec.next ? el('small', 'pu-ink-soft', {}, rec.next) : null);
      endlessSwitch = modeSwitch(endlessSeal(), t('brief.endlessName'), t('brief.endlessRule', { n: lvl.waves.length }), state, 'brief2d-endless');
      endlessSwitch.classList.add('endless');
      modesBox.append(el('div', 'pu-modes-head pu-letter', {}, t('brief.endless'), el('small', '', {}, rec.tier > 0 || st.bestEndlessWave > lvl.waves.length ? t('brief.endlessBest', { best: lower(rec.best) }) : rec.best)), endlessSwitch);
    }
  }

  const play = st.unlocked
    ? plank(st.clears > 0 ? t('brief.replay') : t('brief.play'), { kind: 'primary', icon: 'play', testid: 'brief2d-play', sub: hasModes ? t('brief.campaign') : undefined })
    : plank(t('brief.locked'), { kind: 'primary', icon: 'lock', testid: 'brief2d-play', sub: prev ? t('brief.winFirst', { name: islandName(prev) }) : undefined });
  play.disabled = !st.unlocked;

  const paint = (): void => {
    for (const { id, b } of chSwitches) {
      b.setAttribute('aria-checked', String(chosen.has(id)));
      b.classList.toggle('muted', endless);
    }
    endlessSwitch?.setAttribute('aria-checked', String(endless));
    if (!hasModes) return;
    const label = play.lastElementChild!;
    const sub = endless ? t('brief.endless') : chosen.size > 0 ? t('brief.nChallenges', { n: chosen.size }) : t('brief.campaign');
    label.replaceChildren(endless ? t('brief.setSail') : st.clears > 0 ? t('brief.replay') : t('brief.play'), el('span', 'pu-plank-sub', {}, sub));
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
