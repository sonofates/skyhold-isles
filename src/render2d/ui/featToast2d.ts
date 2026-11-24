/**
 * "Feat earned" toasts: after a run's result is recorded, each feat it completed slides down from the
 * top of the screen as a parchment card with its wax seal (over the victory board), one after the
 * other, and leaves after a few seconds. Phones show one compact card at a time in the top-left
 * corner, clear of the board's title. The Logbook's Feats tab lists them all.
 */
import type { LevelDef } from '../../data/levels/types.ts';
import type { ProgressData } from '../../core/types.ts';
import { earnedFeatIds, newlyEarnedFeats, type FeatDef } from '../../game/feats.ts';
import { featDesc, featName } from '../../i18n/data.ts';
import { t } from '../../i18n/index.ts';
import { el, sealBadge } from './dom.ts';
import { ensureFeatBaseline } from './featSeen.ts';
import './featToast2d.css';

/** At most this many cards at once (a big save import could complete many feats). */
export const FEAT_TOAST_MAX = 3;
/** Each card stays this long (ms); the next one comes in this much later. */
export const FEAT_TOAST_STAY_MS = 4200;
export const FEAT_TOAST_STEP_MS = 650;

/** The cards to show: the first few, and a count of the rest. */
export function featToastPlan(n: number): { shown: number; more: number } {
  const shown = Math.min(FEAT_TOAST_MAX, Math.max(0, n));
  return { shown, more: Math.max(0, n - shown) };
}

/** Phones: one card at a time (side by side they squeezed over the victory ribbon's title). */
export const FEAT_TOAST_PHONE_STAY_MS = 2800;

export function showFeatToasts(feats: readonly FeatDef[], delayMs = 1600): void {
  if (typeof document === 'undefined' || feats.length === 0) return;
  const { shown, more } = featToastPlan(feats.length);
  const phone = document.documentElement.classList.contains('pu-phone');
  const stay = phone ? FEAT_TOAST_PHONE_STAY_MS : FEAT_TOAST_STAY_MS;
  const step = phone ? FEAT_TOAST_PHONE_STAY_MS + 450 : FEAT_TOAST_STEP_MS;
  let stack = document.querySelector<HTMLElement>('.pu-feat-toasts');
  if (!stack) {
    stack = el('div', 'pu pu-feat-toasts', { 'aria-live': 'polite', 'data-testid': 'feat2d-toasts' });
    document.body.append(stack);
  }
  const host = stack;
  feats.slice(0, shown).forEach((f, i) => {
    window.setTimeout(
      () => {
        const last = i === shown - 1 && more > 0;
        const card = el(
          'div',
          'pu-feat-toast',
          { role: 'status', 'data-testid': `feat2d-toast-${f.id}` },
          sealBadge(f.icon),
          el(
            'div',
            'pu-feat-toast-text',
            {},
            el('div', 'pu-feat-toast-kicker pu-letter', {}, t('feat.earned')),
            el('div', 'pu-feat-toast-name pu-ink', {}, featName(f)),
            el('div', 'pu-feat-toast-desc pu-ink-soft', {}, last ? t('feat.more', { n: more }) : featDesc(f)),
          ),
        );
        host.append(card);
        window.setTimeout(() => {
          card.classList.add('leaving');
          window.setTimeout(() => card.remove(), 400);
        }, stay);
      },
      delayMs + i * step,
    );
  });
}

/** Compares the save before and after a run's result and shows the feats it completed. */
export function showNewFeats(before: ProgressData, after: ProgressData, levels: readonly LevelDef[]): FeatDef[] {
  const had = earnedFeatIds(before, levels);
  // A run reached straight from a deep link: the feats held before it are the "seen" baseline, so the
  // new ones still light the Logbook's dot on the map.
  if (typeof localStorage !== 'undefined') ensureFeatBaseline(had);
  const fresh = newlyEarnedFeats(had, after, levels);
  showFeatToasts(fresh);
  return fresh;
}
