import { t } from '../../i18n/index.ts';
import { el } from './dom.ts';

/**
 * Settings → Graphics → Show FPS: a small parchment chip in the top-left corner (inside the safe
 * area), refreshed twice a second from main2d's FrameStats.
 */
export interface FpsCounter {
  setVisible(v: boolean): void;
  /** Frames per second (rounded on display). */
  show(fps: number): void;
  readonly visible: boolean;
}

export function mountFpsCounter(): FpsCounter {
  const chip = el('div', 'pu pu-fps pu-letter', { 'data-testid': 'fps2d', 'aria-hidden': 'true' });
  chip.style.cssText =
    'position:fixed;z-index:24;left:calc(env(safe-area-inset-left,0px) + 8px);top:calc(env(safe-area-inset-top,0px) + 6px);' +
    'padding:2px 9px;border-radius:8px;font-size:13px;font-weight:700;letter-spacing:.02em;pointer-events:none;' +
    'background:rgba(58,36,18,.72);box-shadow:0 0 0 2px rgba(255,214,120,.55);color:#fff4dc;display:none';
  document.body.append(chip);
  let visible = false;
  let last = -1;
  return {
    setVisible(v: boolean): void {
      visible = v;
      chip.style.display = v ? '' : 'none';
    },
    show(fps: number): void {
      const n = Math.round(fps);
      if (!visible || n === last) return;
      last = n;
      chip.textContent = t('fps.counter', { n });
      chip.style.color = n >= 50 ? '#fff4dc' : n >= 30 ? '#ffe08a' : '#ff9a7a';
    },
    get visible() {
      return visible;
    },
  };
}
