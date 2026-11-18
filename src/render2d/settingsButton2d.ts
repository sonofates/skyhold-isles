import { LEVELS_2D } from '../data/levels2d/index.ts';
import { t } from '../i18n/index.ts';
import { plank, roundButton } from './ui/dom.ts';
import { addHudKeepOut, readSafeInsets } from './uiKit.ts';
import { hudButtonsLayout, type Rect } from './uiLayout.ts';

export interface Settings2D {
  open(): void;
  readonly isOpen: boolean;
  /** Shows / hides the HUD button and the pause-plate plank (hidden while the end panel is up). */
  setButtonVisible(visible: boolean): void;
  /** The "Paused" plate's screen rect (css px) while the player has paused, else null. */
  setPausePlate(rect: Rect | null): void;
}

/**
 * In-game Settings (owner feedback 2026-11-18: "where is the settings menu?"). A painted round kit
 * button in the HUD's top-right row (left of the Guide button, same style and caption), plus a
 * Settings plank under the "Paused" plate. Both open the world map's Settings view
 * (ui/metaScreens.ts `openSettings`, in-game variant) as an overlay; `onToggle(open)` lets the
 * game pause while it is open and restore its own pause state after.
 */
export function mountSettings2D(onToggle: (open: boolean) => void, onChange: () => void): Settings2D {
  const wrap = document.createElement('div');
  wrap.className = 'pu';
  const btn = roundButton('settings', t('set.title'), 'settings2d-open', t('hud.settings'));
  btn.classList.add('pu-codex-btn');
  const card = plank(t('hud.settings'), { kind: 'small', icon: 'settings', testid: 'pause2d-settings' });
  card.classList.add('pu-pause-settings');
  card.style.display = 'none';
  wrap.append(btn, card);
  document.body.appendChild(wrap);

  const place = (): void => {
    const hb = hudButtonsLayout(window.innerWidth, window.innerHeight, readSafeInsets());
    const r = Math.max(22, hb.r * 0.86);
    btn.style.width = `${r * 2}px`;
    btn.style.height = `${r * 2}px`;
    btn.style.left = `${hb.settingsX - r}px`;
    btn.style.top = `${hb.y - r}px`;
  };
  place();
  window.addEventListener('resize', place);
  addHudKeepOut(() => {
    if (btn.style.display === 'none' || !btn.isConnected) return null;
    const b = btn.getBoundingClientRect();
    const cap = btn.querySelector('.pu-round-label')?.getBoundingClientRect();
    const x0 = Math.min(b.left, cap?.left ?? b.left);
    const y0 = Math.min(b.top, cap?.top ?? b.top);
    const x1 = Math.max(b.right, cap?.right ?? b.right);
    const y1 = Math.max(b.bottom, cap?.bottom ?? b.bottom);
    return { x: x0 - 4, y: y0 - 4, w: x1 - x0 + 8, h: y1 - y0 + 8 };
  });

  let hidden = false;
  let isOpen = false;
  let plate: Rect | null = null;
  const syncCard = (): void => {
    const show = !!plate && !hidden && !isOpen;
    card.style.display = show ? '' : 'none';
    if (show && plate) {
      card.style.left = `${plate.x + plate.w / 2}px`;
      card.style.top = `${plate.y + plate.h + 8}px`;
    }
  };
  const open = (): void => {
    if (isOpen) return;
    isOpen = true;
    btn.style.display = 'none';
    syncCard();
    onToggle(true);
    void import('./ui/metaScreens.ts').then(({ openSettings }) => {
      openSettings({
        levels: LEVELS_2D,
        inGame: true,
        onChange,
        onClose: () => {
          isOpen = false;
          btn.style.display = hidden ? 'none' : '';
          onToggle(false);
          syncCard();
        },
      });
    });
  };
  btn.addEventListener('click', open);
  card.addEventListener('click', open);
  return {
    open,
    get isOpen() {
      return isOpen;
    },
    setButtonVisible(visible: boolean): void {
      hidden = !visible;
      if (!isOpen) btn.style.display = visible ? '' : 'none';
      syncCard();
    },
    setPausePlate(rect: Rect | null): void {
      if (rect === plate || (rect && plate && rect.x === plate.x && rect.y === plate.y && rect.w === plate.w && rect.h === plate.h)) return;
      plate = rect;
      syncCard();
    },
  };
}
