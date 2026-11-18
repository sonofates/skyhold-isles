/**
 * World map (2d.html without ?level=): a painted sea with the 2D isles as medallion nodes along a
 * dotted route, left to right. Locked / unlocked / stars come from the 2D save (progress2d.ts, on
 * the campaign's own rules). Tap an island → briefing card → Play loads `?level=<id>`. The meta
 * screens (Workshop, Logbook, Daily, Settings) open from the round buttons top-right.
 *
 * QA params: ?screen=brief|workshop|logbook|daily|settings opens that screen (brief = frontier
 * island), ?mockislands=N appends N stand-in islands (layout check only; they reuse the first
 * island's map), window.__map exposes the layout.
 */
import type { ProgressData } from '../../core/types.ts';
import { utcDayNumber } from '../../data/daily.ts';
import { LEVELS_2D } from '../../data/levels2d/index.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { nextRankCost, WORKSHOP_UPGRADES } from '../../data/workshop.ts';
import { starWallet, totalCampaignStars } from '../../game/progression.ts';
import { readSafeInsets } from '../uiKit.ts';
import { showBriefing } from './briefing.ts';
import { anySheetOpen, el, glyph, img, KIT, medal, roundButton, starsRow } from './dom.ts';
import { islandHref } from './inGame.ts';
import { fetchMapsManifest, islandMapUrl, type MapsManifest } from './islandArt.ts';
import { routePath, scrollToCentre, worldMapLayout, type WorldMapLayout } from './mapLayout.ts';
import { dailyFor2D, openDaily, openLogbook, openSettings, openWorkshop, type MetaContext } from './metaScreens.ts';
import { islandStates, loadProgress2D, type IslandState } from './progress2d.ts';
import { paintSea } from './seaPainter.ts';

declare global {
  interface Window {
    __map?: { layout: () => WorldMapLayout | null; islands: () => { id: string; unlocked: boolean; stars: number; x: number; y: number }[] };
  }
}

const MOCK_NAMES = ['Gullrock Shoals', 'Ember Terraces', 'Mistveil Keys', 'Thornwood Rise', 'Saltmarsh Reach', 'Cinder Spire', 'Frostfen Ring', 'Lanternfall', 'Brambledeep', 'Coral Bastion', 'Stormcrown', 'Hollow Tide', 'Skyreach', 'Duskmoor', 'Last Lantern'];

function mockLevels(n: number): LevelDef[] {
  const base = LEVELS_2D[0];
  const diffs: LevelDef['difficulty'][] = ['Breezy', 'Challenging', 'Heroic', 'Master'];
  return Array.from({ length: n }, (_, i) => ({
    ...base,
    id: `mock-${i + 1}`,
    name: MOCK_NAMES[i % MOCK_NAMES.length],
    subtitle: 'Stand-in island (layout QA)',
    difficulty: diffs[Math.min(3, Math.floor((i * 4) / Math.max(1, n)))],
    layout2d: i % 3 === 2 ? undefined : base.layout2d,
  }));
}

export async function mountWorldMap(q: URLSearchParams): Promise<void> {
  const mock = Math.max(0, Math.min(24, Number(q.get('mockislands') ?? 0) || 0));
  const levels: readonly LevelDef[] = mock > 0 ? [...LEVELS_2D, ...mockLevels(mock)] : LEVELS_2D;
  const manifest: MapsManifest | null = await fetchMapsManifest();
  const thumb = (l: LevelDef): string | null => islandMapUrl(manifest, l);
  let progress: ProgressData = loadProgress2D(levels);

  const root = el('div', 'pu pu-map', { 'data-testid': 'worldmap2d' });
  const scroll = el('div', 'pu-map-scroll');
  const world = el('div', 'pu-map-world');
  const sea = el('canvas', 'pu-sea');
  const svgNS = 'http://www.w3.org/2000/svg';
  const route = document.createElementNS(svgNS, 'svg');
  route.setAttribute('class', 'pu-route');
  world.append(sea, route);
  scroll.append(world);

  // Top strip.
  const banner = el('div', 'pu-title-banner pu-letter', {}, el('span', '', {}, 'Skyhold Isles'));
  const tallyBox = el('div', 'pu-tally pu-letter', { 'data-testid': 'map2d-stars', title: 'Stars earned' });
  const wsBtn = roundButton('workshop', 'Workshop', 'map2d-workshop', 'Workshop');
  const lbBtn = roundButton('logbook', 'Logbook', 'map2d-logbook', 'Logbook');
  const dailyBtn = roundButton('daily', 'Daily Squall', 'map2d-daily', 'Daily');
  const setBtn = roundButton('settings', 'Settings', 'map2d-settings', 'Settings');
  const right = el('div', 'pu-topbar-right', {}, tallyBox, wsBtn, lbBtn, dailyBtn, setBtn);
  const topbar = el('div', 'pu-topbar', {}, banner, right);
  const hint = el('div', 'pu-map-hint pu-letter', {}, 'Tap an island to set sail');
  root.append(scroll, topbar, hint);
  document.body.append(root);

  let states: IslandState[] = [];
  let layout: WorldMapLayout | null = null;
  const nodes: HTMLButtonElement[] = [];

  const ctx: MetaContext = {
    get progress() {
      return progress;
    },
    set progress(p: ProgressData) {
      progress = p;
    },
    levels,
    thumb,
    onChange: () => {
      progress = loadProgress2D(levels);
      refresh();
    },
  };

  const openBrief = (i: number): void => {
    const st = states[i];
    if (!st) return;
    showBriefing(st, i > 0 ? levels[i - 1] : null, thumb(st.level), () => location.assign(islandHref(st.level)));
  };

  const buildNodes = (): void => {
    for (const n of nodes) n.remove();
    nodes.length = 0;
    states.forEach((st, i) => {
      const b = el('button', `pu-node${st.unlocked ? '' : ' locked'}${st.frontier ? ' frontier' : ''}`, {
        type: 'button',
        'data-testid': `map2d-island-${st.level.id}`,
        'aria-label': `${st.level.name}${st.unlocked ? `, ${st.stars} of 3 stars` : ', locked'}`,
      });
      b.style.animationDelay = `${0.05 + i * 0.06}s`;
      b.append(el('span', 'pu-node-shore'), medal(thumb(st.level), '100%', st.frontier && st.unlocked));
      if (st.unlocked) b.append(starsRow(st.stars, 'pu-stars pu-node-stars'));
      if (st.mastered) {
        const c = el('span', 'pu-node-crown');
        c.append(glyph('crown'));
        b.append(c);
      }
      const name = el('span', 'pu-tag pu-node-name', {}, el('span', 'pu-tag-ring pu-letter', {}, String(i + 1)), el('span', 'pu-ink', {}, st.unlocked ? st.level.name : '? ? ?'));
      b.append(name);
      if (!st.unlocked) {
        const lock = el('span', 'pu-node-lock');
        lock.append(glyph('lock'));
        b.append(lock);
      }
      if (st.frontier && st.unlocked) b.append(img(KIT.rally, '', 'pu-node-flag'));
      b.addEventListener('click', () => openBrief(i));
      world.append(b);
      nodes.push(b);
    });
  };

  const refreshTopbar = (): void => {
    const stars = totalCampaignStars(progress);
    tallyBox.replaceChildren(img(KIT.star), el('b', '', {}, String(stars)), el('small', '', {}, `/ ${levels.length * 3}`));
    wsBtn.querySelector('.pu-badge')?.remove();
    const available = starWallet(progress).available;
    const affordable = WORKSHOP_UPGRADES.filter((d) => {
      const c = nextRankCost(progress.workshop, d.id);
      return c !== null && c <= available;
    }).length;
    if (affordable > 0) wsBtn.append(el('span', 'pu-badge', { 'aria-label': `${affordable} upgrades affordable` }, String(affordable)));
    dailyBtn.querySelector('.pu-dot')?.remove();
    const daily = dailyFor2D(progress, Date.now(), levels);
    if (daily && progress.daily.lastDay !== utcDayNumber(Date.now())) dailyBtn.append(el('span', 'pu-dot', { 'aria-hidden': 'true' }));
  };

  let lastW = 0;
  let lastH = 0;
  const relayout = (force = false): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!force && w === lastW && h === lastH) return;
    lastW = w;
    lastH = h;
    const insets = readSafeInsets();
    const bar = topbar.getBoundingClientRect();
    // The free band starts under the title banner (the round buttons' captions may overhang a bit).
    const L = worldMapLayout(levels.length, w, h, { ...insets, top: 0 }, Math.max(bar.bottom, banner.getBoundingClientRect().bottom) + 6);
    layout = L;
    world.style.width = `${L.worldW}px`;
    paintSea(sea, L.worldW, h, window.devicePixelRatio || 1);
    route.setAttribute('width', String(L.worldW));
    route.setAttribute('height', String(h));
    route.setAttribute('viewBox', `0 0 ${L.worldW} ${h}`);
    const frontier = Math.max(0, Math.min(levels.length - 1, progress.unlockedLevelIndex));
    const done = L.nodes.slice(0, frontier + 1);
    const ahead = L.nodes.slice(frontier);
    const sw = Math.max(3, L.nodeD * 0.045);
    route.innerHTML =
      `<path d="${routePath(done)}" fill="none" stroke="rgba(30,20,8,.35)" stroke-width="${sw * 2.2}" stroke-linecap="round"/>` +
      `<path d="${routePath(done)}" fill="none" stroke="#fff4dc" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${sw * 0.2} ${sw * 2.6}"/>` +
      (ahead.length > 1
        ? `<path d="${routePath(ahead)}" fill="none" stroke="rgba(255,244,220,.45)" stroke-width="${sw * 0.8}" stroke-linecap="round" stroke-dasharray="${sw * 0.2} ${sw * 2.4}"/>`
        : '');
    nodes.forEach((b, i) => {
      b.style.setProperty('--d', `${L.nodeD}px`);
      b.style.left = `${L.nodes[i].x}px`;
      b.style.top = `${L.nodes[i].y}px`;
    });
    scroll.scrollLeft = scrollToCentre(L.nodes[frontier]?.x ?? 0, w, L.worldW);
  };

  const refresh = (): void => {
    states = islandStates(progress, levels);
    buildNodes();
    refreshTopbar();
    relayout(true);
  };

  wsBtn.addEventListener('click', () => openWorkshop(ctx));
  lbBtn.addEventListener('click', () => openLogbook(ctx));
  dailyBtn.addEventListener('click', () => openDaily(ctx));
  setBtn.addEventListener('click', () => openSettings(ctx));
  // A mouse wheel scrolls the sea sideways.
  scroll.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        scroll.scrollLeft += e.deltaY;
        e.preventDefault();
      }
    },
    { passive: false },
  );
  window.addEventListener('resize', () => relayout());
  window.addEventListener('keydown', (e) => {
    if (anySheetOpen()) return;
    if (e.key === 'Enter') openBrief(Math.max(0, Math.min(levels.length - 1, progress.unlockedLevelIndex)));
  });

  await document.fonts?.ready.catch(() => undefined);
  refresh();
  window.__map = {
    layout: () => layout,
    islands: () => states.map((s, i) => ({ id: s.level.id, unlocked: s.unlocked, stars: s.stars, x: layout?.nodes[i]?.x ?? 0, y: layout?.nodes[i]?.y ?? 0 })),
  };

  const screen = q.get('screen');
  if (screen === 'brief') openBrief(Math.max(0, Math.min(levels.length - 1, Number(q.get('island') ?? progress.unlockedLevelIndex) || 0)));
  else if (screen === 'workshop') openWorkshop(ctx);
  else if (screen === 'logbook') openLogbook(ctx, q.get('tab') === 'feats' ? 'feats' : 'islands');
  else if (screen === 'daily') openDaily(ctx);
  else if (screen === 'settings') openSettings(ctx);
}
