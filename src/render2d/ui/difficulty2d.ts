/**
 * Difficulty in the painted UI: the player's remembered choice (last one played, default Normal),
 * the one-line rule text built from the data patch (so it follows any retune of
 * src/data/difficulty.ts), and the emblems (sprout / sword / skull) used by the briefing selector,
 * the HUD badge, the end panel, the world-map Hard ribbon and the Logbook.
 */
import { DEFAULT_DIFFICULTY, DIFFICULTIES, parseDifficulty, type DifficultyId } from '../../data/difficulty.ts';
import { t, type MsgKey } from '../../i18n/index.ts';
import { DIFFICULTY_EMBLEMS } from './difficultyEmblems.ts';
import './difficulty2d.css';

export { DIFFICULTY_EMBLEMS };

export const DIFFICULTY_PREF_KEY = 'skyhold_isles_difficulty2d_v1';

const NAME_KEY: Readonly<Record<DifficultyId, MsgKey>> = { easy: 'diff.easy', normal: 'diff.normal', hard: 'diff.hard' };

export function difficultyLabel(id: DifficultyId): string {
  return t(NAME_KEY[id] ?? 'diff.normal');
}

/** The last difficulty the player picked (Normal when none / unreadable). */
export function loadDifficultyPref(): DifficultyId {
  try {
    return parseDifficulty(typeof localStorage === 'undefined' ? null : localStorage.getItem(DIFFICULTY_PREF_KEY)) ?? DEFAULT_DIFFICULTY;
  } catch {
    return DEFAULT_DIFFICULTY;
  }
}

export function saveDifficultyPref(id: DifficultyId): void {
  try {
    if (typeof localStorage !== 'undefined' && DIFFICULTIES[id]) localStorage.setItem(DIFFICULTY_PREF_KEY, id);
  } catch {
    // private mode / quota: the choice just is not remembered
  }
}

const pct = (mul: number): number => Math.round(Math.abs(1 - mul) * 100);

/**
 * One line for the selector: the patch's rules and the reward, e.g. "Foes −25% health · −8% speed ·
 * +25% gold · +5 lives · max 1★". Normal: "The isle as it was built · up to 3★".
 */
export function difficultyRuleText(id: DifficultyId): string {
  if (id === 'normal') return t('diff.normalDesc');
  const p = DIFFICULTIES[id].patch;
  const parts: string[] = [];
  if (p.enemyHpMul !== undefined && pct(p.enemyHpMul) > 0) parts.push(t(p.enemyHpMul > 1 ? 'diff.hpUp' : 'diff.hpDown', { n: pct(p.enemyHpMul) }));
  if (p.enemySpeedMul !== undefined && pct(p.enemySpeedMul) > 0) parts.push(t(p.enemySpeedMul > 1 ? 'diff.speedUp' : 'diff.speedDown', { n: pct(p.enemySpeedMul) }));
  if (p.startGoldMul !== undefined && pct(p.startGoldMul) > 0) parts.push(t(p.startGoldMul > 1 ? 'diff.goldUp' : 'diff.goldDown', { n: pct(p.startGoldMul) }));
  if (p.maxLives !== undefined && p.maxLives !== null) parts.push(t('diff.livesCap', { n: p.maxLives }));
  else if (p.bonusLives) parts.push(t('diff.livesPlus', { n: p.bonusLives }));
  if (p.heroRespawnMul !== undefined && p.heroRespawnMul > 1 && pct(p.heroRespawnMul) > 0) parts.push(t('diff.respawnSlow', { n: pct(p.heroRespawnMul) }));
  parts.push(t(id === 'easy' ? 'diff.easyReward' : 'diff.hardReward'));
  const line = parts.join(t('common.sep'));
  return line.charAt(0).toLocaleUpperCase() + line.slice(1);
}

/** A small round wax-seal badge with the difficulty's emblem (class `pu-dseal <id>`). */
export function difficultySeal(id: DifficultyId, cls = ''): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = `pu-dseal ${id}${cls ? ` ${cls}` : ''}`;
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = DIFFICULTY_EMBLEMS[id];
  return s;
}

export interface DifficultyBadge2D {
  /** Pins the badge over the wave banner (`banner` = its screen rect; null or `shown` false hides it). */
  update(banner: { x: number; y: number; w: number; h: number } | null, shown: boolean): void;
  debug(): { text: string; shown: boolean; x: number; y: number; w: number; h: number };
}

/**
 * In-run badge: the difficulty seal and name on a small parchment pill hung on the wave banner's rope
 * (bottom-right HUD corner, inside the banner's dock slot so it never covers the playfield).
 * Pointer-transparent; only touches the DOM when its spot moves.
 */
export function mountDifficultyBadge(id: DifficultyId): DifficultyBadge2D {
  const root = document.createElement('div');
  root.className = `pu pu-diff-badge ${id}`;
  root.dataset.testid = 'hud2d-diff';
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', t('diff.badgeAria', { d: difficultyLabel(id) }));
  const name = document.createElement('span');
  name.textContent = difficultyLabel(id);
  root.append(difficultySeal(id), name);
  root.style.display = 'none';
  document.body.append(root);
  let key = '';
  return {
    update(banner, shown) {
      const k = shown && banner ? `${Math.round(banner.x)},${Math.round(banner.y)},${Math.round(banner.w)},${Math.round(banner.h)}` : '';
      if (k === key) return;
      key = k;
      if (!k || !banner) {
        root.style.display = 'none';
        return;
      }
      // A tag tied on the banner's rope (the art's top third), inside the banner's own dock slot.
      const fs = Math.round(Math.max(9, Math.min(16, banner.h * 0.18)));
      root.style.display = '';
      root.style.left = `${banner.x + banner.w / 2}px`;
      root.style.top = `${banner.y + Math.max(banner.h * 0.15, fs * 0.78 + 1)}px`;
      root.style.setProperty('--fs', `${fs}px`);
    },
    debug() {
      const r = root.getBoundingClientRect();
      return { text: name.textContent ?? '', shown: root.style.display !== 'none', x: r.x, y: r.y, w: r.width, h: r.height };
    },
  };
}
