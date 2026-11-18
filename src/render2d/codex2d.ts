import { ENEMY_DEFS } from '../data/enemies.ts';
import type { LoadedArt } from './assets2d.ts';
import { enemyArtFor } from './manifest.ts';
import { roundButton } from './ui/dom.ts';
import { readSafeInsets } from './uiKit.ts';
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
 * Mounts the DOM codex (src/ui/content/codexScreen.ts) on the 2D page with the painted art. The
 * 3D game's global UI stylesheet and the codex code are loaded lazily, only when it first opens,
 * so a plain 2D session pays nothing. `onToggle(open)` lets the game pause while it is open.
 */
export function mountCodex2D(art: LoadedArt, onToggle: (open: boolean) => void): Codex2D {
  // Painted round kit button (book glyph), in the HUD's top-right row left of pause / speed.
  const wrap = document.createElement('div');
  wrap.className = 'pu';
  const btn = roundButton('codex', 'Open codex', 'codex2d-open', 'Codex');
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

  let gameHidden = false;
  let screen: { open: () => void } | null = null;
  let loading: Promise<void> | null = null;
  const load = (): Promise<void> => {
    loading ??= (async () => {
      await import('../style.css');
      const [{ CodexScreen }, { setCodexArtResolver }] = await Promise.all([
        import('../ui/content/codexScreen.ts'),
        import('../ui/content/codexArt.ts'),
      ]);
      setCodexArtResolver((kind, id) => (kind === 'enemy' ? codexEnemyUrl(art, id) : codexTowerUrl(art, id)));
      const root = document.createElement('div');
      root.id = 'ui-root';
      document.body.appendChild(root);
      const cx = new CodexScreen(root, {
        isSeen: () => true,
        onClose: () => {
          btn.style.display = gameHidden ? 'none' : '';
          onToggle(false);
        },
      });
      screen = { open: () => cx.open('enemies') };
    })();
    return loading;
  };
  const open = (): void => {
    void load().then(() => {
      onToggle(true);
      btn.style.display = 'none';
      screen?.open();
    });
  };
  btn.addEventListener('click', open);
  const setButtonVisible = (visible: boolean): void => {
    gameHidden = !visible;
    btn.style.display = visible ? '' : 'none';
  };
  return { open, setButtonVisible };
}
