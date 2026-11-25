import '@fontsource-variable/fredoka';
import './ui/fredokaTr.css';
// The painted DOM kit stays in the entry stylesheet (as before the battle split) so its cascade
// order ahead of every screen's own CSS is unchanged.
import './ui/paintedUi.css';
import { LEVELS_2D } from '../data/levels2d/index.ts';
import { t } from '../i18n/index.ts';
import { isDesktopShell, setPresence } from '../platform/desktopShell.ts';
import { loadSettings } from '../platform/storage.ts';
import { bootPhase } from './bootTrace.ts';
import { applyPageGraphics, applyUiScale, bootLocale, GAME_PARAMS, showError } from './bootShared2d.ts';
import { isDesktopClient } from './renderResolution.ts';
import { GRAPHICS_EVENT, loadGraphics } from './ui/graphicsSettings.ts';
import { installNav } from './ui/navFocus.ts';
import { dismissBoot } from './ui/transition2d.ts';

/**
 * 2d.html entry — the painted 2D renderer (Pixi v8) on the real sim. This module stays small:
 * the title screen and world map load without Pixi or the battle; a game scene loads battle2d.ts
 * on demand (docs/handoff-perf.md).
 *   (no params)       the title screen once per session (titleScreen.ts; ?title=1 forces it, ?title=0 or
 *                     an automated browser skips it), then the world map (island select, briefing,
 *                     Workshop / Logbook / Daily / Settings);
 *                     map QA: ?screen=brief|workshop|logbook|daily|settings|store, ?mockislands=N,
 *                     ?store=<id> (store card for a paid island), ?iapmock=1 (mock store, mobile scope)
 *   ?level=l1c        play an island (deep link, skips the map; any debug param below defaults to l1c)
 *   &intro=1          show the island's story panels first (once; the map adds it on a first play)
 *   ?story=intro|outro QA: force the story panels (intro on load, outro after a win)
 *   ?end=won&story=ending  QA: the ending (beats + credits roll, then the map) over the won board
 *   ?ab=1             enemy-animation A/B showcase (no combat)
 *   ?bench=150        stress scene: ~N enemies, towers on every plot, window.__bench stats
 *   ?autoplay=1       plays the greedy build script and auto-calls waves
 *   ?raider=veo31q    raider walk-cycle variant (default omni12; `cheap` = procedural)
 *   ?codex=1          opens the codex (painted art) on load; a Codex button is always top-left
 *   ?artcheck=1       overlay: which manifest art files are present / missing (and the stand-ins)
 *   ?zoo=1[&types=a,b]  all 26 enemy types (or only `types`) walking, specials triggered periodically (labelled)
 *   ?towers=1[&tier=N] every tower type built and firing (cycles T1-T3 unless tier is given)
 *   ?towers=aim&type=cannon|archer|ballista|mortar[&tier=N]  turret aim QA (window.__aim, aim overlay)
 *   ?melee=1[&tier=N][&types=a,b][&plot=N][&die=1][&kill=1][&crowd=N]  barracks melee QA
 *                     (window.__meleeScene; with &manual=1 the game only advances through
 *                     window.__meleeScene.step(frames), for frame-exact captures)
 *   ?speed=2|3|4      start at 2× / 3× / 4× sim speed (QA recordings)
 *   ?end=won|lost     force the end panel shortly after load (UI QA)
 *   ?mapmips=1        QA: draw the map texture mipmapped (default: resolution variant, no mips)
 *   &settings=1       open the in-game Settings on load (a language switch reloads with it)
 *   &settab=general|audio|graphics|controls   the Settings section it opens on (QA; map too)
 *   ?desktop=1|0      QA: force the desktop / phone render-resolution policy (renderResolution.ts)
 *   ?hero=<id>|none   run with that hero (or none); &herolevel=1..20 forces its level (QA)
 *   &herosel=1        QA: start with the hero selected (move mode)
 */
/** The title screen in front of the world map (titleScreen.ts); the map mounts on Continue / New game. */
async function runTitleScreen(q: URLSearchParams, title: typeof import('./ui/titleScreen.ts')): Promise<void> {
  dismissBoot();
  const { screen, done } = title.runTitle(q, {
    openMap: async () => {
      const { mountWorldMap } = await import('./ui/worldMap.ts');
      await mountWorldMap(q);
    },
    openSettings: (onClose) => {
      void import('./ui/metaScreens.ts').then(({ openSettings }) =>
        openSettings({ levels: LEVELS_2D, onChange: () => undefined, onClose, reloadTo: '?title=1&titleopen=settings' }),
      );
    },
    openCredits: (onClose) => {
      void import('./ui/credits2d.ts').then(({ openCredits }) => openCredits(onClose));
    },
    confirmNewGame: async () => {
      const { confirmBoard } = await import('./ui/runControls2d.ts');
      return confirmBoard({ title: t('title.newTitle'), body: t('title.newBody'), yes: t('title.newYes'), no: t('title.newNo'), testid: 'confirm-newgame' });
    },
    ...(isDesktopShell()
      ? {
          quit: () => {
            void import('./ui/gameMenu2d.ts').then(({ confirmQuit }) => confirmQuit());
          },
        }
      : {}),
  });
  setPresence('menu');
  window.__title = screen;
  await done;
}

async function main(): Promise<void> {
  const q = new URLSearchParams(location.search);
  bootPhase('js-entry');
  // A game scene: start fetching the battle (Pixi, sim, layers) now, in parallel with the fonts.
  const battle = GAME_PARAMS.some((k) => q.has(k)) ? import('./battle2d.ts') : null;
  const fontsReady = bootLocale();
  installNav();
  // Interface size changes on the map too (the run's own listener re-applies the rest).
  window.addEventListener(GRAPHICS_EVENT, () => applyUiScale(loadGraphics().uiScale));
  const desktop = isDesktopClient(q);
  document.documentElement.classList.toggle('pu-phone', !desktop);
  const gfx = loadGraphics();
  const engine = applyPageGraphics(gfx, loadSettings().quality, desktop);
  if (!GAME_PARAMS.some((k) => q.has(k))) {
    await fontsReady;
    const title = await import('./ui/titleScreen.ts');
    if (title.shouldShowTitle(q, { seen: title.titleSeen(), automated: navigator.webdriver === true })) {
      await runTitleScreen(q, title);
      return;
    }
    const { mountWorldMap } = await import('./ui/worldMap.ts');
    await mountWorldMap(q);
    dismissBoot();
    return;
  }
  const { runBattle2D } = await battle!;
  await runBattle2D(q, { fontsReady, desktop, gfx, engine });
}

main().catch((err: unknown) => {
  console.error(err);
  showError(t('boot.failed', { msg: err instanceof Error ? err.message : String(err) }));
});
