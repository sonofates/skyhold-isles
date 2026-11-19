/**
 * World map (2d.html without ?level=): a painted sea with the 2D isles as medallion nodes along a
 * painted route (dashes + an anchor per leg), left to right. Locked / unlocked / stars come from the 2D save (progress2d.ts, on
 * the campaign's own rules). Tap an island → briefing card → Play loads `?level=<id>`. The meta
 * screens (Workshop, Logbook, Daily, Settings) open from the round buttons top-right.
 *
 * QA params: ?screen=brief|workshop|logbook|daily|settings|store|heroes|herosel opens that screen
 * (heroes = skill tree, herosel = hero picker, both take &focus=<hero id>; brief = frontier
 * island), ?mockislands=N appends N stand-in islands (layout check only; they reuse the first
 * island's map), window.__map exposes the layout. ?store=<island id> opens the store card for
 * that island (where main2d sends a deep link into an island the free version does not include).
 *
 * The sea under the route is alive (seaLife.ts): rippling water, foam, glints, cloud shadows,
 * clouds, gulls, a rare whale; the islands bob, the frontier ship rocks. Reduced motion stills it.
 *
 * Mobile builds only (and ?iapmock=1 in a browser): islands past the free scope wear the "full
 * adventure" lock (store2d.ts) and open the store card instead of the briefing.
 */
import type { HeroId, ProgressData } from '../../core/types.ts';
import { isHeroId } from '../../data/heroes.ts';
import { utcDayNumber } from '../../data/daily.ts';
import { LEVELS_2D } from '../../data/levels2d/index.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { nextRankCost, WORKSHOP_UPGRADES } from '../../data/workshop.ts';
import { starWallet, totalCampaignStars } from '../../game/progression.ts';
import { islandName } from '../../i18n/data.ts';
import { t } from '../../i18n/index.ts';
import { readSafeInsets } from '../uiKit.ts';
import { showBriefing, type RunChoice } from './briefing.ts';
import { isChallengeId } from '../../data/challenges.ts';
import { anySheetOpen, el, glyph, img, KIT, medal, roundButton, starsRow } from './dom.ts';
import { fetchMapsManifest, islandMapUrl, type MapsManifest } from './islandArt.ts';
import { routeMarks, scrollToCentre, worldMapLayout, type RouteMark, type WorldMapLayout } from './mapLayout.ts';
import { dailyFor2D, openDaily, openLogbook, openSettings, openWorkshop, type MetaContext } from './metaScreens.ts';
import { availableChallenges, buildRunHref2D, canPlayEndless } from './modes2d.ts';
import { islandStates, loadProgress2D, type IslandState } from './progress2d.ts';
import { heroArtFiles } from './heroBits.ts';
import { heroChip, heroesButton, openHeroSelect, openSkillTree } from './heroScreens.ts';
import { needsFullAdventure, openStore, storeEnabled } from './store2d.ts';
import { mountSea } from './seaLife.ts';

declare global {
  interface Window {
    __map?: { layout: () => WorldMapLayout | null; islands: () => { id: string; unlocked: boolean; paid: boolean; stars: number; x: number; y: number }[] };
  }
}

// QA-only stand-in names (?mockislands=N layout check), never shown to players.
const MOCK_NAMES = ['Gullrock Shoals', 'Ember Terraces', 'Mistveil Keys', 'Thornwood Rise', 'Saltmarsh Reach', 'Cinder Spire', 'Frostfen Ring', 'Lanternfall', 'Brambledeep', 'Coral Bastion', 'Stormcrown', 'Hollow Tide', 'Skyreach', 'Duskmoor', 'Last Lantern']; // i18n-ignore (QA stand-ins)

function mockLevels(n: number): LevelDef[] {
  const base = LEVELS_2D[0];
  const diffs: LevelDef['difficulty'][] = ['Breezy', 'Challenging', 'Heroic', 'Master'];
  return Array.from({ length: n }, (_, i) => ({
    ...base,
    id: `mock-${i + 1}`,
    name: MOCK_NAMES[i % MOCK_NAMES.length],
    subtitle: t('map.mockSubtitle'),
    difficulty: diffs[Math.min(3, Math.floor((i * 4) / Math.max(1, n)))],
    layout2d: i % 3 === 2 ? undefined : base.layout2d,
  }));
}

const ROUTE_DASH = '/art2d/ui/route-dash.webp';
const ROUTE_ANCHOR = '/art2d/ui/route-anchor.webp';

/**
 * The voyage route as painted pieces: `route-dash` marks every few steps along the curve through
 * the islands and a `route-anchor` halfway along each leg. Legs already sailed (up to the frontier
 * island) are full colour; the legs ahead are faded. Both pieces are small (32 px) paintings, so
 * they are never drawn wider than 28 css px.
 */
function routeSvg(L: WorldMapLayout, frontier: number): string {
  const dashW = Math.round(Math.max(14, Math.min(28, L.nodeD * 0.13)));
  const dashH = dashW / 2;
  const anchorD = Math.round(Math.max(18, Math.min(28, L.nodeD * 0.16)));
  const marks = routeMarks(L.nodes, dashW * 1.45, L.nodeD * 0.5, anchorD * 0.7);
  const deg = (a: number): string => ((a * 180) / Math.PI).toFixed(1);
  const piece = (m: RouteMark, href: string, w: number, h: number, turn: boolean): string =>
    `<image href="${href}" x="${(-w / 2).toFixed(1)}" y="${(-h / 2).toFixed(1)}" width="${w}" height="${h.toFixed(1)}" preserveAspectRatio="none" ` +
    `transform="translate(${m.x.toFixed(1)} ${m.y.toFixed(1)})${turn ? ` rotate(${deg(m.angle)})` : ''}"/>`;
  const group = (sailed: boolean): string => {
    const keep = (m: RouteMark): boolean => (m.leg < frontier) === sailed;
    return (
      `<g class="pu-route-${sailed ? 'sailed' : 'ahead'}">` +
      marks.dashes.filter(keep).map((m) => piece(m, ROUTE_DASH, dashW, dashH, true)).join('') +
      marks.anchors.filter(keep).map((m) => piece(m, ROUTE_ANCHOR, anchorD, anchorD, false)).join('') +
      '</g>'
    );
  };
  return group(false) + group(true);
}

export async function mountWorldMap(q: URLSearchParams): Promise<void> {
  const mock = Math.max(0, Math.min(24, Number(q.get('mockislands') ?? 0) || 0));
  const levels: readonly LevelDef[] = mock > 0 ? [...LEVELS_2D, ...mockLevels(mock)] : LEVELS_2D;
  const manifest: MapsManifest | null = await fetchMapsManifest();
  const heroFiles = await heroArtFiles();
  const thumb = (level: LevelDef): string | null => {
    const token = manifest?.paintedUi?.[`island-${level.id}`];
    return token ? `/art2d/${token}` : islandMapUrl(manifest, level);
  };
  let progress: ProgressData = loadProgress2D(levels);

  const root = el('div', 'pu pu-map', { 'data-testid': 'worldmap2d' });
  const scroll = el('div', 'pu-map-scroll');
  const world = el('div', 'pu-map-world');
  const svgNS = 'http://www.w3.org/2000/svg';
  const route = document.createElementNS(svgNS, 'svg');
  route.setAttribute('class', 'pu-route');
  world.append(route);
  scroll.append(world);

  // Top strip.
  const banner = el('div', 'pu-title-banner pu-letter', {}, el('span', '', {}, t('map.title')));
  const tallyBox = el('div', 'pu-tally pu-letter', { 'data-testid': 'map2d-stars', title: t('map.starsEarned') });
  const wsBtn = roundButton('workshop', t('map.workshop'), 'map2d-workshop', t('map.workshop'));
  const lbBtn = roundButton('logbook', t('map.logbook'), 'map2d-logbook', t('map.logbookShort'));
  const dailyBtn = roundButton('daily', t('daily.title'), 'map2d-daily', t('map.daily'));
  const setBtn = roundButton('settings', t('map.settings'), 'map2d-settings', t('map.settings'));
  const heroBtn = heroesButton(heroFiles);
  const right = el('div', 'pu-topbar-right', {}, tallyBox, heroBtn.el, wsBtn, lbBtn, dailyBtn, setBtn);
  const topbar = el('div', 'pu-topbar', {}, banner, right);
  const hint = el('div', 'pu-map-hint pu-letter', {}, t('map.hint'));
  // Painted arrows at the sea's edges when more of the route lies that way (mouse users without a
  // wheel; touch pans natively, a mouse can also drag the sea).
  const panL = roundButton('back', t('map.panWest'), 'map2d-pan-left');
  const panR = roundButton('next', t('map.panEast'), 'map2d-pan-right');
  panL.classList.add('pu-map-pan', 'left');
  panR.classList.add('pu-map-pan', 'right');
  root.append(scroll, panL, panR, topbar, hint);
  document.body.append(root);
  const sea = mountSea(root, world, scroll, manifest, q);

  let states: IslandState[] = [];
  /** Per island: past the free version's scope (mobile builds, full adventure not owned). */
  let paid: boolean[] = [];
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

  const openStoreFor = (i: number | null): void => {
    const st = i === null ? null : states[i];
    openStore({
      islandName: st && st.unlocked ? islandName(st.level) : null,
      totalIslands: levels.length,
      onOwnedChange: () => ctx.onChange(),
    });
  };

  const openBrief = (i: number, initial?: Partial<RunChoice>): void => {
    const st = states[i];
    if (!st) return;
    if (paid[i]) {
      openStoreFor(i);
      return;
    }
    const id = st.level.id;
    const modes = st.unlocked
      ? { challenges: availableChallenges(id, progress, levels), endless: canPlayEndless(id, progress, levels), initial }
      : { challenges: [], endless: false };
    showBriefing(
      st,
      i > 0 ? levels[i - 1] : null,
      thumb(st.level),
      modes,
      (choice) => location.assign(buildRunHref2D(id, { challenges: choice.challenges, endless: choice.endless, intro: st.clears === 0 })),
      heroChip(ctx, heroFiles).el,
    );
  };

  const buildNodes = (): void => {
    for (const n of nodes) n.remove();
    nodes.length = 0;
    states.forEach((st, i) => {
      const isPaid = paid[i];
      const b = el('button', `pu-node${st.unlocked ? '' : ' locked'}${isPaid ? ' paid' : ''}${st.frontier ? ' frontier' : ''}`, {
        type: 'button',
        'data-testid': `map2d-island-${st.level.id}`,
        'aria-label': isPaid
          ? t('store.nodeAria', { name: st.unlocked ? islandName(st.level) : '? ? ?' })
          : st.unlocked
            ? t('map.nodeOpen', { name: islandName(st.level), n: st.stars })
            : t('map.nodeLocked', { name: islandName(st.level) }),
      });
      b.style.animationDelay = `${0.05 + i * 0.06}s`;
      sea.decorateNode(b, i, st.frontier && st.unlocked && !isPaid);
      b.append(el('span', 'pu-node-shore'), medal(st.unlocked ? thumb(st.level) : '/art2d/ui/island-fog.webp', '100%', st.frontier && st.unlocked));
      if (st.unlocked && !isPaid) b.append(starsRow(st.stars, 'pu-stars pu-node-stars'));
      if (st.mastered) {
        const c = el('span', 'pu-node-crown');
        c.append(glyph('crown'));
        b.append(c);
      }
      const name = el('span', 'pu-tag pu-node-name', {}, el('span', 'pu-tag-ring pu-letter', {}, String(i + 1)), el('span', 'pu-ink', {}, st.unlocked ? islandName(st.level) : '? ? ?'));
      b.append(name);
      if (isPaid) {
        // The "full adventure" lock: a chest seal and a red ribbon (not the grey padlock of an
        // island the route has not reached yet).
        const seal = el('span', 'pu-node-chest');
        seal.append(glyph('chest'));
        b.append(seal, el('span', 'pu-node-ribbon pu-letter', { 'data-testid': `map2d-paid-${st.level.id}` }, t('store.lockTag')));
      } else if (!st.unlocked) {
        const lock = el('span', 'pu-node-lock');
        lock.append(glyph('lock'));
        b.append(lock);
      }
      if (st.frontier && st.unlocked && !isPaid) b.append(sea.ship());
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
    if (affordable > 0) wsBtn.append(el('span', 'pu-badge', { 'aria-label': t('map.affordable', { n: affordable }) }, String(affordable)));
    heroBtn.refresh(ctx);
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
    route.setAttribute('width', String(L.worldW));
    route.setAttribute('height', String(h));
    route.setAttribute('viewBox', `0 0 ${L.worldW} ${h}`);
    const frontier = Math.max(0, Math.min(levels.length - 1, progress.unlockedLevelIndex));
    route.innerHTML = routeSvg(L, frontier);
    nodes.forEach((b, i) => {
      b.style.setProperty('--d', `${L.nodeD}px`);
      b.style.left = `${L.nodes[i].x}px`;
      b.style.top = `${L.nodes[i].y}px`;
    });
    scroll.scrollLeft = scrollToCentre(L.nodes[frontier]?.x ?? 0, w, L.worldW);
    updatePan();
    sea.layout(L, h, Math.max(bar.bottom, banner.getBoundingClientRect().bottom), hint);
  };

  const refresh = (): void => {
    states = islandStates(progress, levels);
    const scoped = storeEnabled();
    paid = states.map((st) => scoped && needsFullAdventure(st.level.id));
    buildNodes();
    refreshTopbar();
    relayout(true);
  };

  const updatePan = (): void => {
    const max = scroll.scrollWidth - scroll.clientWidth;
    panL.hidden = max <= 2 || scroll.scrollLeft <= 2;
    panR.hidden = max <= 2 || scroll.scrollLeft >= max - 2;
  };
  const panBy = (dir: -1 | 1): void => {
    const step = Math.max(layout ? layout.nodeD * 1.62 : 200, scroll.clientWidth * 0.6);
    scroll.scrollBy({ left: dir * step, behavior: 'smooth' });
  };
  panL.addEventListener('click', () => panBy(-1));
  panR.addEventListener('click', () => panBy(1));
  scroll.addEventListener('scroll', updatePan, { passive: true });
  // Mouse drag pans the sea; a drag never counts as a tap on an island.
  let drag: { x: number; left: number; moved: boolean; id: number } | null = null;
  scroll.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    drag = { x: e.clientX, left: scroll.scrollLeft, moved: false, id: e.pointerId };
  });
  scroll.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    if (!drag.moved && Math.abs(dx) > 6) {
      drag.moved = true;
      scroll.setPointerCapture(e.pointerId);
      scroll.classList.add('dragging');
    }
    if (drag.moved) scroll.scrollLeft = drag.left - dx;
  });
  const endDrag = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null;
    scroll.classList.remove('dragging');
    if (!moved) return;
    // Swallow the click the browser sends after the drag.
    const swallow = (ev: Event): void => {
      ev.stopPropagation();
      ev.preventDefault();
    };
    window.addEventListener('click', swallow, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', swallow, { capture: true }), 0);
  };
  scroll.addEventListener('pointerup', endDrag);
  scroll.addEventListener('pointercancel', endDrag);

  wsBtn.addEventListener('click', () => openWorkshop(ctx));
  lbBtn.addEventListener('click', () => openLogbook(ctx));
  dailyBtn.addEventListener('click', () => openDaily(ctx));
  setBtn.addEventListener('click', () => openSettings(ctx));
  heroBtn.el.addEventListener('click', () => openSkillTree(ctx, heroFiles));
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
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) openBrief(Math.max(0, Math.min(levels.length - 1, progress.unlockedLevelIndex)));
    else if (e.key === 'ArrowLeft') panBy(-1);
    else if (e.key === 'ArrowRight') panBy(1);
  });

  await document.fonts?.ready.catch(() => undefined);
  refresh();
  window.__map = {
    layout: () => layout,
    islands: () => states.map((s, i) => ({ id: s.level.id, unlocked: s.unlocked, paid: paid[i] ?? false, stars: s.stars, x: layout?.nodes[i]?.x ?? 0, y: layout?.nodes[i]?.y ?? 0 })),
  };

  const screen = q.get('screen');
  if (screen === 'brief') {
    // QA: &pick=endless or &pick=<challenge id>[,<id>] pre-selects modes on the card.
    const pick = (q.get('pick') ?? '').split(',').filter(Boolean);
    openBrief(Math.max(0, Math.min(levels.length - 1, Number(q.get('island') ?? progress.unlockedLevelIndex) || 0)), {
      endless: pick.includes('endless'),
      challenges: pick.filter(isChallengeId),
    });
  }
  else if (screen === 'workshop') openWorkshop(ctx);
  else if (screen === 'logbook') openLogbook(ctx, q.get('tab') === 'feats' ? 'feats' : 'islands');
  else if (screen === 'daily') openDaily(ctx);
  else if (screen === 'settings') openSettings(ctx);
  else if (screen === 'heroes') openSkillTree(ctx, heroFiles, isHeroId(q.get('focus')) ? (q.get('focus') as HeroId) : undefined);
  else if (screen === 'herosel') openHeroSelect(ctx, heroFiles, undefined, isHeroId(q.get('focus')) ? (q.get('focus') as HeroId) : undefined);
  else if (screen === 'store' && storeEnabled()) openStoreFor(null);
  // A deep link into an island the free version does not include lands here (main2d.ts).
  const storeFor = q.get('store');
  if (storeFor && storeEnabled()) {
    const i = levels.findIndex((l) => l.id === storeFor);
    if (i >= 0 && paid[i]) {
      const L = layout as WorldMapLayout | null; // set by refresh() above
      if (L) scroll.scrollLeft = scrollToCentre(L.nodes[i]?.x ?? 0, window.innerWidth, L.worldW);
      openStoreFor(i);
    }
  }
}
