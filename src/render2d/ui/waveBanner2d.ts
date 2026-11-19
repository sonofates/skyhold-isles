/**
 * Big storybook call-out in the middle of the screen when a wave matters: a boss marching in
 * ("Boss incoming" + its name) or the island's final wave. Lettering only (cream with the kit's
 * dark outline, a red / gold glow), it scales in, holds and fades — no box over the battlefield.
 * Pointer-transparent. Reduced motion: it just fades.
 */
import './waveBanner2d.css';
import type { EnemyType } from '../../core/types.ts';
import { ENEMY_DEFS } from '../../data/enemies.ts';
import { enemyName } from '../../i18n/data.ts';
import { t } from '../../i18n/index.ts';
import { el } from './dom.ts';

export type WaveCallout =
  | { readonly kind: 'boss'; readonly name: string }
  | { readonly kind: 'final'; readonly boss?: string }
  | null;

/**
 * What a starting wave deserves: a boss wave names its boss, the island's last wave is "final"
 * (naming the boss that leads it, most islands end on one); ordinary and Endless waves get none.
 */
export function waveCallout(types: readonly EnemyType[], waveIndex: number, storyWaves: number, endless: boolean): WaveCallout {
  const boss = types.find((ty) => ty === 'boss' || ty === 'tempest' || ENEMY_DEFS[ty]?.type === 'boss');
  const final = !endless && storyWaves > 1 && waveIndex === storyWaves - 1;
  if (final) return boss ? { kind: 'final', boss: enemyName(boss) } : { kind: 'final' };
  if (boss) return { kind: 'boss', name: enemyName(boss) };
  return null;
}

export interface WaveBanner2D {
  show(c: WaveCallout): void;
  debug(): { text: string; shown: boolean };
}

export function mountWaveBanner(): WaveBanner2D {
  const root = el('div', 'pu pu-wave-callout', { 'aria-live': 'assertive', 'data-testid': 'wave2d-callout' });
  const head = el('div', 'pu-wave-callout-head pu-letter');
  const sub = el('div', 'pu-wave-callout-sub pu-letter');
  root.append(head, sub);
  root.style.display = 'none';
  document.body.append(root);
  let timer = 0;
  return {
    show(c) {
      if (!c) return;
      head.textContent = c.kind === 'boss' ? t('callout.boss') : t('callout.final');
      sub.textContent = c.kind === 'boss' ? c.name : c.boss ? t('callout.finalBoss', { name: c.boss }) : t('callout.finalSub');
      // A boss leading the final wave gets the boss's red glow.
      root.dataset.kind = c.kind === 'final' && c.boss ? 'boss' : c.kind;
      root.style.display = '';
      root.classList.remove('go');
      void root.offsetWidth;
      root.classList.add('go');
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        root.style.display = 'none';
      }, 2600);
    },
    debug: () => ({ text: `${head.textContent} ${sub.textContent}`, shown: root.style.display !== 'none' }),
  };
}
