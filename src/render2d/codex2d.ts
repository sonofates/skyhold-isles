import { ENEMY_DEFS } from '../data/enemies.ts';
import { t } from '../i18n/index.ts';
import type { LoadedArt } from './assets2d.ts';
import { enemyArtFor } from './manifest.ts';
import { specPortraitUrl } from './specArt.ts';
import { roundButton } from './ui/dom.ts';
import { addHudKeepOut, readSafeInsets } from './uiKit.ts';
import { hudButtonsLayout } from './uiLayout.ts';

/** Image URL of an enemy's front sprite for the codex (stand-in art when its own is pending), or null. */
export function codexEnemyUrl(art: LoadedArt, id: string): string | null {
  const def = ENEMY_DEFS[id as keyof typeof ENEMY_DEFS];
  if (!def) return null;
  const rt = art.enemies[enemyArtFor(art.manifest, def.type, def.flying).art];
  if (!rt || !art.present.has(rt.frontFile)) return null;
  return art.baseUrl + rt.frontFile;
}

/** Image URL of a tower's T1 sprite for the codex, or null. */
export function codexTowerUrl(art: LoadedArt, id: string): string | null {
  const rt = art.towers[id as keyof typeof art.towers];
  const file = rt?.tierFiles[0];
  if (!file || !art.present.has(file)) return null;
  return art.baseUrl + file;
}

export interface Codex2D {
  open(): void;
  /** Shows / hides the Codex button (hidden while the end panel is up). */
  setButtonVisible(visible: boolean): void;
}

/**
 * Mounts the painted Codex (ui/codexSheet.ts) on the 2D page with the painted art, in the player's
 * language. The sheet code is loaded lazily, only when it first opens, so a plain 2D session pays
 * nothing. `onToggle(open)` lets the game pause while it is open.
 */
export function mountCodex2D(art: LoadedArt, onToggle: (open: boolean) => void): Codex2D {
  // Painted round kit button (book glyph), in the HUD's top-right row left of pause / speed.
  const wrap = document.createElement('div');
  wrap.className = 'pu';
  const btn = roundButton('codex', t('codex.open'), 'codex2d-open', t('codex.button'));
  btn.classList.add('pu-codex-btn');
  wrap.appendChild(btn);
  document.body.appendChild(wrap);
  const place = (): void => {
    const hb = hudButtonsLayout(window.innerWidth, window.innerHeight, readSafeInsets());
    // A touch smaller than pause / speed: it is a secondary action.
    const r = Math.max(22, hb.r * 0.86);
    btn.style.width = `${r * 2}px`;
    btn.style.height = `${r * 2}px`;
    btn.style.left = `${hb.codexX - r}px`;
    btn.style.top = `${hb.y - r}px`;
  };
  place();
  window.addEventListener('resize', place);
  // The button and its caption sit over the canvas: the build ring keeps clear of both.
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

  let gameHidden = false;
  let isOpen = false;
  const open = (): void => {
    if (isOpen) return;
    isOpen = true;
    void import('./ui/codexSheet.ts').then(({ openCodex2D }) => {
      onToggle(true);
      btn.style.display = 'none';
      openCodex2D({
        enemyUrl: (id) => codexEnemyUrl(art, id),
        towerUrl: (id) => codexTowerUrl(art, id),
        specUrl: (id) => specPortraitUrl(art, id),
        onClose: () => {
          isOpen = false;
          btn.style.display = gameHidden ? 'none' : '';
          onToggle(false);
        },
      });
    });
  };
  btn.addEventListener('click', open);
  const setButtonVisible = (visible: boolean): void => {
    gameHidden = !visible;
    btn.style.display = visible ? '' : 'none';
  };
  return { open, setButtonVisible };
}
