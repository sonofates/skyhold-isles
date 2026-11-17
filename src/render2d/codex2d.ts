import { ENEMY_DEFS } from '../data/enemies.ts';
import type { LoadedArt } from './assets2d.ts';
import { enemyArtFor } from './manifest.ts';

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
}

/**
 * Mounts the DOM codex (src/ui/content/codexScreen.ts) on the 2D page with the painted art. The
 * 3D game's global UI stylesheet and the codex code are loaded lazily, only when it first opens,
 * so a plain 2D session pays nothing. `onToggle(open)` lets the game pause while it is open.
 */
export function mountCodex2D(art: LoadedArt, onToggle: (open: boolean) => void): Codex2D {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('data-testid', 'codex2d-open');
  btn.setAttribute('aria-label', 'Open codex');
  btn.textContent = 'Codex';
  btn.style.cssText =
    'position:fixed;left:10px;top:10px;z-index:30;min-width:56px;min-height:48px;padding:0 12px;border-radius:14px;' +
    'border:3px solid #3a2412;background:linear-gradient(#b87a3c,#8a5427);color:#fff4dc;font:700 15px/1 system-ui,sans-serif;' +
    'text-shadow:0 2px 0 #3a2412;box-shadow:0 3px 0 #3a2412;touch-action:manipulation;cursor:pointer';
  document.body.appendChild(btn);

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
        onClose: () => onToggle(false),
      });
      screen = { open: () => cx.open('enemies') };
    })();
    return loading;
  };
  const open = (): void => {
    void load().then(() => {
      onToggle(true);
      screen?.open();
    });
  };
  btn.addEventListener('click', open);
  return { open };
}
