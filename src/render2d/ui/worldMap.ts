/**
 * World map (2d.html without ?level=): a painted sea with the 2D isles as medallion nodes along a
 * painted route (dashes + an anchor per leg), left to right. Locked / unlocked / stars come from the 2D save (progress2d.ts, on
 * the campaign's own rules). Tap an island → briefing card → Play loads `?level=<id>`. The meta
 * screens (Workshop, Logbook, Daily, Settings) open from the round buttons top-right.
 *
 * QA params: ?screen=brief|workshop|logbook|daily|settings|store|heroes|herosel|credits opens that screen
 * (ending = the ending's story beats, endcredits[&at=0..1] = its credits roll, paused at `at`,
 * campaign = the "Campaign complete" card; ending2d.ts)
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
import { hardRibbon, showBriefing, type RunChoice } from './briefing.ts';
import { readMarket2D } from './market2d.ts';
import { markMarketSeen, marketSeen } from './marketModel.ts';
import { openMarket, type CrystalShop } from './marketScreen.ts';
import { beltChip } from './marketBelt.ts';
import { parseDifficulty } from '../../data/difficulty.ts';
import { loadDifficultyPref, saveDifficultyPref } from './difficulty2d.ts';
import { isChallengeId } from '../../data/challenges.ts';
import { anySheetOpen, el, glyph, img, KIT, medal, roundButton, starsRow } from './dom.ts';
import { fetchMapsManifest, islandMapUrl, prefetchLevelArt, type MapsManifest } from './islandArt.ts';
import { routeMarks, scrollToCentre, worldMapLayout, type RouteMark, type WorldMapLayout } from './mapLayout.ts';
import { dailyFor2D, openDaily, openLogbook, openSettings, openWorkshop, type MetaContext } from './metaScreens.ts';
import { unseenFeats } from './featSeen.ts';
import { availableChallenges, buildRunHref2D, canPlayEndless } from './modes2d.ts';
import { isCampaignComplete, islandStates, loadProgress2D, type IslandState } from './progress2d.ts';
import { openCredits } from './credits2d.ts';
import { navigateWithVeil } from './transition2d.ts';
import { heroArtFiles } from './heroBits.ts';
import { heroChip, heroesButton, openHeroSelect, openSkillTree } from './heroScreens.ts';
import { needsFullAdventure, openStore, storeEnabled } from './store2d.ts';
import { mountSea } from './seaLife.ts';
import { chapterPages, nextChapter, pageOfIsland, PROLOGUE, type ChapterDef, type ChapterPage } from '../../data/chapters.ts';
import { cardsDue, chapterStates, firstIsland, parseCardsSeen, type CardsSeen, type ChapterState } from './chapterState.ts';
import { showChapterDone, showChapterTitle } from './chapterCards.ts';
import { storyBeats } from './storyBeats.ts';
import './worldChapters.css';

declare global {
  interface Window {
    __map?: {
      layout: () => WorldMapLayout | null;
      /** The islands on the page shown (x / y = node centre in world px). */
      islands: () => { id: string; unlocked: boolean; paid: boolean; stars: number; x: number; y: number }[];
      /** The chapter page shown, and every chapter's tally. */
      chapter: () => { page: number; id: string; opened: boolean; soon: boolean };
      chapters: () => { id: string; opened: boolean; complete: boolean; cleared: number; total: number; stars: number; maxStars: number }[];
      showChapter: (page: number) => void;
    };
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

/** The cloth's lettering band of ui-banner.webp, as a share of the art's width (x 80-432 of 512). */
const BANNER_CLOTH = 352 / 512;

/**
 * Sizes the title banner to its word: the cloth between the rope knots is always wider than the
 * title plus a margin (the art stretches sideways a little for a long title), and the banner never
 * takes more than ~34 % of the screen's width (a long title gets a smaller size instead).
 */
export function titleBannerWidth(textW: number, fontPx: number, screenW: number): { width: number; scale: number } {
  const want = (textW + fontPx * 0.9) / BANNER_CLOTH;
  const max = Math.max(160, screenW * 0.34);
  return want <= max ? { width: Math.ceil(want), scale: 1 } : { width: Math.floor(max), scale: Math.max(0.72, max / want) };
}

function fitTitleBanner(banner: HTMLElement, text: HTMLElement, screenW: number, right?: HTMLElement): void {
  text.style.fontSize = '';
  const fs = parseFloat(getComputedStyle(banner).fontSize) || 16;
  let maxW = screenW;
  if (document.documentElement.classList.contains('pu-phone') && right) {
    const rw = right.getBoundingClientRect().width;
    const avail = Math.max(130, screenW - rw - 32);
    maxW = Math.min(screenW, avail / 0.34);
  }
  const fit = titleBannerWidth(text.getBoundingClientRect().width, fs, maxW);
  banner.style.setProperty('--bw', `${fit.width}px`);
  if (fit.scale < 1) text.style.fontSize = `${Math.max(14, fs * fit.scale).toFixed(1)}px`;
}

/**
 * The round buttons' captions hang under them and can be wider than the button ("Kahramanlar"):
 * the extra left margin each button needs so its caption keeps `minGap` from the previous one's.
 * `labels` are the captions' [left, right] edges, in order, measured with no extra margins.
 */
export function captionMargins(labels: readonly (readonly [number, number])[], minGap: number): number[] {
  return labels.map((l, i) => (i === 0 ? 0 : Math.max(0, Math.ceil(minGap - (l[0] - labels[i - 1][1])))));
}

function spaceCaptions(row: HTMLElement): void {
  const btns = Array.from(row.children).filter((c): c is HTMLElement => c instanceof HTMLElement && !!c.querySelector(':scope > .pu-round-label'));
  for (const b of btns) b.style.marginLeft = '';
  const boxes = btns.map((b) => {
    const r = b.querySelector(':scope > .pu-round-label')?.getBoundingClientRect();
    return [r?.left ?? 0, r?.right ?? 0] as const;
  });
  const cap = btns[0]?.querySelector(':scope > .pu-round-label');
  const fs = cap ? parseFloat(getComputedStyle(cap).fontSize) || 12 : 12;
  captionMargins(boxes, fs).forEach((m, i) => {
    if (m > 0) btns[i].style.marginLeft = `${m}px`;
  });
}

const FOG_ART = '/art2d/ui/island-fog.webp';

/** localStorage: the furthest island the map has already shown as open (for the unveil). */
const UNVEIL_KEY = 'skyhold2d_map_unlock_seen_v1';

/**
 * The island to unveil on this map visit: the one just reached since the map last showed the
 * route (-1 when nothing new, on a first visit with no record, or after a reset).
 */
export function unveilIndex(seen: number | null, unlocked: number, count: number): number {
  if (seen === null || !Number.isFinite(seen)) return -1;
  return unlocked > seen && unlocked < count ? unlocked : -1;
}

/** localStorage: each island's stars as the map last showed them (new ones pop in once). */
const STARS_KEY = 'skyhold2d_map_stars_seen_v1';

/**
 * Per island, the first star to pop in on this visit (its index), -1 when none is new. No record
 * (a first visit) pops nothing.
 */
export function newStarsFrom(seen: readonly number[] | null, now: readonly number[]): number[] {
  return now.map((n, i) => {
    if (!seen) return -1;
    const before = Math.max(0, Math.min(3, Number(seen[i]) || 0));
    return n > before ? before : -1;
  });
}

function readStarsSeen(): number[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(STARS_KEY) ?? 'null') as unknown;
    return Array.isArray(v) ? v.map((x) => Number(x) || 0) : null;
  } catch {
    return null;
  }
}

function readUnveilSeen(): number | null {
  try {
    const v = localStorage.getItem(UNVEIL_KEY);
    return v === null ? null : Number(v);
  } catch {
    return null;
  }
}

function writeUnveilSeen(n: number): void {
  try {
    localStorage.setItem(UNVEIL_KEY, String(n));
  } catch {
    /* private mode: no unveil next time, nothing else */
  }
}

/** localStorage: chapter cards already shown (chapterState.ts `cardsDue`). */
const CARDS_KEY = 'skyhold2d_chapter_cards_v1';

function readCardsSeen(): CardsSeen {
  try {
    return parseCardsSeen(localStorage.getItem(CARDS_KEY)) ?? { title: [], done: [] };
  } catch {
    return { title: [], done: [] };
  }
}

function writeCardsSeen(seen: CardsSeen): void {
  try {
    localStorage.setItem(CARDS_KEY, JSON.stringify(seen));
  } catch {
    /* private mode: the cards may show again next visit */
  }
}

/**
 * The route's sailed legs on a chapter page: up to the frontier when it is on the page, all of
 * them on a chapter already left behind, none on one not reached yet (`routeSvg`'s `frontier`).
 */
export function pageFrontier(page: readonly number[], frontier: number): number {
  if (page.length === 0) return 0;
  const reached = page.filter((i) => i <= frontier).length;
  return Math.max(0, reached - 1);
}

/** The "Chapter 2 · 4/9" line of a chapter tab / the chapter bar. */
function chapterCount(c: ChapterState): string {
  return t('chapter.count', { n: c.chapter.n, done: c.cleared, total: c.total });
}

function chapterAria(c: ChapterState): string {
  const name = t(c.chapter.nameKey);
  if (c.chapter.status === 'soon') return t('chapter.tabSoonAria', { n: c.chapter.n, name });
  if (!c.opened && c.chapter.n > 1) return t('chapter.tabLockedAria', { n: c.chapter.n, name });
  return t('chapter.tabAria', { n: c.chapter.n, name, done: c.cleared, total: c.total, stars: c.stars, max: c.maxStars });
}

/** A chapter page that shows the fog (with the unlock hint, or "coming soon") instead of its route. */
function pageVeiled(c: ChapterState): boolean {
  return c.chapter.status === 'soon' || (!c.opened && c.chapter.n > 1);
}

/** CSS wash for the still sea painting (the WebGL water grades itself, `SeaHandle.setGrade`). */
function seaWash(c: ChapterDef): string {
  const [r, g, b, sat] = c.sea;
  const m = Math.max(r, g, b, 0.001);
  const a = Math.min(0.5, Math.abs(r - b) * 1.6 + (1 - sat) * 0.6);
  return a < 0.01 ? 'transparent' : `rgba(${Math.round((r / m) * 255)}, ${Math.round((g / m) * 255)}, ${Math.round((b / m) * 255)}, ${a.toFixed(2)})`;
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
  // A newly reached island lifts its fog once (the first build only; later refreshes don't replay it).
  let unveilAt = unveilIndex(readUnveilSeen(), progress.unlockedLevelIndex, levels.length);
  writeUnveilSeen(progress.unlockedLevelIndex);
  let starsFrom = newStarsFrom(readStarsSeen(), levels.map((_, i) => progress.bestStars[i] ?? 0));
  try {
    localStorage.setItem(STARS_KEY, JSON.stringify(levels.map((_, i) => progress.bestStars[i] ?? 0)));
  } catch {
    /* private mode */
  }

  const root = el('div', 'pu pu-map', { 'data-testid': 'worldmap2d' });
  const scroll = el('div', 'pu-map-scroll');
  const world = el('div', 'pu-map-world');
  const svgNS = 'http://www.w3.org/2000/svg';
  const route = document.createElementNS(svgNS, 'svg');
  route.setAttribute('class', 'pu-route');
  world.append(route);
  scroll.append(world);

  // Top strip.
  const bannerText = el('span', '', {}, t('map.title'));
  const banner = el('div', 'pu-title-banner pu-letter', {}, bannerText);
  const tallyBox = el('div', 'pu-tally pu-letter', { 'data-testid': 'map2d-stars', title: t('map.starsEarned') });
  const wsBtn = roundButton('workshop', t('map.workshop'), 'map2d-workshop', t('map.workshop'));
  // The Market (Sky Crystals → belt items), beside the Workshop: crystal glyph, the wallet on a chip.
  const mkBtn = roundButton('crystal', t('market.title'), 'map2d-market', t('market.title'));
  mkBtn.classList.add('pu-market-btn');
  const mkCount = el('span', 'pu-market-count pu-letter', { 'data-testid': 'map2d-crystals', 'aria-hidden': 'true' });
  mkBtn.append(mkCount);
  const lbBtn = roundButton('logbook', t('map.logbook'), 'map2d-logbook', t('map.logbookShort'));
  const dailyBtn = roundButton('daily', t('daily.title'), 'map2d-daily', t('map.daily'));
  const setBtn = roundButton('settings', t('map.settings'), 'map2d-settings', t('map.settings'));
  const heroBtn = heroesButton(heroFiles);
  const right = el('div', 'pu-topbar-right', {}, tallyBox, heroBtn.el, mkBtn, wsBtn, lbBtn, dailyBtn, setBtn);
  const topbar = el('div', 'pu-topbar', {}, banner, right);
  // Painted arrows at the sea's edges when more of the route lies that way (mouse users without a
  // wheel; touch pans natively, a mouse can also drag the sea).
  const panL = roundButton('back', t('map.panWest'), 'map2d-pan-left');
  const panR = roundButton('next', t('map.panEast'), 'map2d-pan-right');
  panL.classList.add('pu-map-pan', 'left');
  panR.classList.add('pu-map-pan', 'right');
  // Keys / pad walk the islands (each focus scrolls the sea); the pan arrows would be extra stops.
  panL.dataset.navSkip = panR.dataset.navSkip = '';

  // Chapter bar (bottom centre): ‹ the chapter's tally and its five tabs › (one page per chapter).
  const chPrev = roundButton('back', t('chapter.prev'), 'map2d-chapter-prev');
  const chNext = roundButton('next', t('chapter.next'), 'map2d-chapter-next');
  chPrev.classList.add('pu-ch-arrow');
  chNext.classList.add('pu-ch-arrow');
  const chLabel = el('div', 'pu-ch-label pu-letter', { 'data-testid': 'map2d-chapter-label' });
  const chTabs = el('div', 'pu-ch-tabs', { role: 'tablist', 'aria-label': t('chapter.tabs') });
  const chBar = el('nav', 'pu-chapter-bar', { 'data-testid': 'map2d-chapters', 'aria-label': t('chapter.tabs') }, chPrev, el('div', 'pu-ch-plaque', {}, chLabel, chTabs), chNext);
  // Fog over a chapter not reached yet / still to come, with its hint card.
  const veilCard = el('div', 'pu-ch-veil-card pu-card', { 'data-testid': 'map2d-chapter-veil' });
  const veil = el('div', 'pu-chapter-veil', { 'aria-live': 'polite' }, veilCard);
  veil.hidden = true;
  root.append(scroll, veil, panL, panR, topbar, chBar);
  document.body.append(root);
  const sea = mountSea(root, world, scroll, manifest, q);

  let states: IslandState[] = [];
  /** Per island: past the free version's scope (mobile builds, full adventure not owned). */
  let paid: boolean[] = [];
  let layout: WorldMapLayout | null = null;
  const nodes: HTMLButtonElement[] = [];
  const pages: ChapterPage[] = chapterPages(levels.map((l) => l.id));
  let chapters: ChapterState[] = [];
  /** The chapter page shown (index into `pages`). */
  let page = 0;
  /** Island indexes (into `levels`) drawn on the page shown, in route order. */
  let shown: readonly number[] = [];
  /** Where the next layout scrolls to: the frontier / a given island, or the page's start or end. */
  let scrollTarget: number | 'start' | 'end' | null = null;

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

  // Dev builds only (`vite` dev server): ?iapqa=1 shows the mobile crystal packs with a mock store, so
  // QA can see the section in a browser. A production build drops this branch: no URL flag can
  // enable purchases there (docs/market.md).
  const qaShop: CrystalShop | undefined = import.meta.env.DEV && q.get('iapqa') ? (await import('./marketQaShop.ts')).qaShop(q.get('iapqa') ?? '') : undefined;
  const openMarketSheet = (closed?: () => void): void => {
    markMarketSeen(localStorage);
    openMarket({
      onChange: refreshTopbar,
      onClose: () => {
        refreshTopbar();
        closed?.();
      },
      ...(qaShop ? { shop: qaShop } : {}),
    });
    refreshTopbar();
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
    if (st.unlocked) prefetchLevelArt(manifest, st.level);
    const id = st.level.id;
    const difficulty = loadDifficultyPref();
    const modes = st.unlocked
      ? { challenges: availableChallenges(id, progress, levels), endless: canPlayEndless(id, progress, levels), initial, difficulty }
      : { challenges: [], endless: false, difficulty };
    showBriefing(
      st,
      i > 0 ? levels[i - 1] : null,
      thumb(st.level),
      modes,
      (choice) => {
        // Endless always plays Normal: it does not change the remembered choice.
        if (!choice.endless) saveDifficultyPref(choice.difficulty);
        navigateWithVeil(buildRunHref2D(id, { challenges: choice.challenges, endless: choice.endless, difficulty: choice.difficulty, intro: st.clears === 0 }));
      },
      heroChip(ctx, heroFiles).el,
      st.unlocked ? beltChip({ onMarket: openMarketSheet }) : undefined,
    );
  };

  const buildNodes = (): void => {
    for (const n of nodes) n.remove();
    nodes.length = 0;
    const veiled = chapters[page] ? pageVeiled(chapters[page]) : false;
    let num = 0;
    shown.forEach((i, k) => {
      const st = states[i];
      if (!st) return;
      const isPaid = paid[i];
      const prologue = PROLOGUE.islands.includes(st.level.id);
      if (!prologue) num++;
      const b = el('button', `pu-node${st.unlocked ? '' : ' locked'}${isPaid ? ' paid' : ''}${st.frontier ? ' frontier' : ''}`, {
        type: 'button',
        'data-testid': `map2d-island-${st.level.id}`,
        'aria-label': isPaid
          ? t('store.nodeAria', { name: st.unlocked ? islandName(st.level) : '? ? ?' })
          : st.unlocked
            ? t('map.nodeOpen', { name: islandName(st.level), n: st.stars })
            : t('map.nodeLocked', { name: islandName(st.level) }),
      });
      b.style.animationDelay = `${0.05 + k * 0.06}s`;
      // Keyboard / pad focus starts on the island to play next.
      if (st.frontier && st.unlocked) b.dataset.navDefault = '';
      // Under a chapter's fog the islands are only a silhouette: not a stop for taps or keys.
      if (veiled) {
        b.classList.add('veiled');
        b.tabIndex = -1;
        b.dataset.navSkip = '';
        b.setAttribute('aria-hidden', 'true');
      }
      sea.decorateNode(b, i, st.frontier && st.unlocked && !isPaid);
      b.append(el('span', 'pu-node-shore'), medal(st.unlocked ? thumb(st.level) : FOG_ART, '100%', st.frontier && st.unlocked));
      if (st.unlocked && !isPaid) {
        const row = starsRow(st.stars, 'pu-stars pu-node-stars');
        // Stars won since the last visit drop onto the node one by one (after the node pops in).
        const from = starsFrom[i] ?? -1;
        if (from >= 0 && !document.documentElement.classList.contains('pu-reduce-motion')) {
          Array.from(row.children).forEach((star, j) => {
            if (j < from || j >= st.stars || !(star instanceof HTMLElement)) return;
            star.classList.add('pu-star-new');
            star.style.setProperty('--sd', `${(0.75 + k * 0.06 + (j - from) * 0.22).toFixed(2)}s`);
          });
        }
        b.append(row);
      }
      if (st.mastered) {
        const c = el('span', 'pu-node-crown');
        c.append(glyph('crown'));
        b.append(c);
      }
      if (st.unlocked && !isPaid && st.hardWon) b.append(hardRibbon(`map2d-hard-${st.level.id}`));
      const name = el('span', 'pu-tag pu-node-name', {}, el('span', 'pu-tag-ring pu-letter', {}, prologue ? t('chapter.prologueTag') : String(num)), el('span', 'pu-ink', {}, st.unlocked ? islandName(st.level) : '? ? ?'));
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
      if (i === unveilAt && st.unlocked && !isPaid) unveil(b, k);
      b.addEventListener('click', () => openBrief(i));
      world.append(b);
      nodes.push(b);
    });
    // Both play on the first build only (later refreshes, e.g. after the Workshop, don't replay them).
    starsFrom = [];
  };

  /** The fog and padlock of the locked look lift off the medal, then a gold ring bursts (not with reduced motion). */
  const unveil = (b: HTMLElement, i: number): void => {
    unveilAt = -1;
    if (document.documentElement.classList.contains('pu-reduce-motion')) return;
    b.classList.add('unveil');
    b.style.setProperty('--ud', `${(1.2 + i * 0.06).toFixed(2)}s`);
    const fog = el('span', 'pu-medal-thumb pu-unveil-fog', { 'aria-hidden': 'true' });
    fog.style.backgroundImage = `url("${FOG_ART}")`;
    fog.style.backgroundSize = 'contain';
    fog.style.backgroundPosition = '55% 50%';
    b.querySelector('.pu-medal')?.append(fog);
    const lock = el('span', 'pu-node-lock pu-unveil-lock', { 'aria-hidden': 'true' });
    lock.append(glyph('lock'));
    const burst = el('span', 'pu-unveil-burst', { 'aria-hidden': 'true' });
    b.append(lock, burst);
    // The burst is the last step: then the overlays leave (they end invisible anyway).
    burst.addEventListener(
      'animationend',
      () => {
        b.classList.remove('unveil');
        for (const e of [fog, lock, burst]) e.remove();
      },
      { once: true },
    );
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
    const crystals = readMarket2D().crystals;
    mkCount.replaceChildren(img('/art2d/market/skyCrystal.webp', '', 'pu-crystal-ico'), String(crystals));
    mkBtn.setAttribute('aria-label', `${t('market.title')}: ${t('market.walletAria', { n: crystals })}`);
    mkBtn.querySelector('.pu-market-new')?.remove();
    if (!marketSeen(localStorage)) mkBtn.append(el('span', 'pu-market-new pu-letter', { 'data-testid': 'map2d-market-new', role: 'img', 'aria-label': t('market.newAria') }, t('market.new')));
    lbBtn.querySelector('.pu-dot')?.remove();
    lbBtn.removeAttribute('data-new-feats');
    const newFeats = unseenFeats(progress, levels).length;
    if (newFeats > 0) {
      lbBtn.setAttribute('data-new-feats', String(newFeats));
      lbBtn.append(el('span', 'pu-dot', { role: 'img', 'aria-label': t('map.logbookNew') }));
    }
    dailyBtn.querySelector('.pu-dot')?.remove();
    const daily = dailyFor2D(progress, Date.now(), levels);
    if (daily && progress.daily.lastDay !== utcDayNumber(Date.now())) dailyBtn.append(el('span', 'pu-dot', { 'aria-hidden': 'true' }));
  };

  let lastW = 0;
  let lastH = 0;
  let lastK = '';
  const relayout = (force = false): void => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    // The interface size (Settings, `--ui-scale`) changes the top bar too: lay out again then.
    const k = document.documentElement.style.getPropertyValue('--ui-scale');
    if (!force && w === lastW && h === lastH && k === lastK) return;
    lastW = w;
    lastH = h;
    lastK = k;
    spaceCaptions(right);
    fitTitleBanner(banner, bannerText, w, right);
    const insets = readSafeInsets();
    const bar = topbar.getBoundingClientRect();
    // The chapter bar keeps the bottom of the sea: the route lies above it.
    const chTop = chBar.getBoundingClientRect().top;
    const bottomInset = Math.max(insets.bottom, chTop > 0 && chTop < h ? h - chTop - Math.max(10, h * 0.03) + 4 : 0);
    // The free band starts under the title banner (the round buttons' captions may overhang a bit).
    const L = worldMapLayout(shown.length, w, h, { ...insets, top: 0, bottom: bottomInset }, Math.max(bar.bottom, banner.getBoundingClientRect().bottom) + 6);
    layout = L;
    world.style.width = `${L.worldW}px`;
    route.setAttribute('width', String(L.worldW));
    route.setAttribute('height', String(h));
    route.setAttribute('viewBox', `0 0 ${L.worldW} ${h}`);
    const frontier = Math.max(0, Math.min(levels.length - 1, progress.unlockedLevelIndex));
    route.innerHTML = chapters[page] && pageVeiled(chapters[page]) ? '' : routeSvg(L, pageFrontier(shown, frontier));
    nodes.forEach((b, k) => {
      b.style.setProperty('--d', `${L.nodeD}px`);
      b.style.left = `${L.nodes[k].x}px`;
      b.style.top = `${L.nodes[k].y}px`;
    });
    // Scroll: a requested island, the page's start / end (turning pages), else the frontier island
    // when it is on this page, else the start of the route.
    const target = scrollTarget ?? (shown.includes(frontier) ? frontier : 'start');
    const at = typeof target === 'number' ? shown.indexOf(target) : -1;
    scroll.scrollLeft = target === 'end' ? L.worldW : at >= 0 ? scrollToCentre(L.nodes[at]?.x ?? 0, w, L.worldW) : 0;
    scrollTarget = null;
    updatePan();
    sea.layout(L, h, Math.max(bar.bottom, banner.getBoundingClientRect().bottom), chBar);
  };

  /** The chapter bar: the page's tally, its tabs, the arrows. */
  const renderChapterBar = (): void => {
    const c = chapters[page];
    if (!c) return;
    const veiled = pageVeiled(c);
    chLabel.replaceChildren(
      el('span', '', {}, chapterCount(c)),
      ...(c.chapter.status === 'soon' ? [] : [el('span', 'pu-ch-stars', {}, img(KIT.star), `${c.stars}/${c.maxStars}`)]),
    );
    chLabel.classList.toggle('veiled', veiled);
    chTabs.replaceChildren(
      ...chapters.map((cs, p) => {
        const on = p === page;
        const tab = el(
          'button',
          `pu-ch-tab${on ? ' on' : ''}${pageVeiled(cs) ? (cs.chapter.status === 'soon' ? ' soon' : ' locked') : ''}${cs.complete ? ' complete' : ''}`,
          { type: 'button', role: 'tab', 'aria-selected': String(on), 'aria-label': chapterAria(cs), 'data-testid': `map2d-chapter-tab-${cs.chapter.n}`, title: t(cs.chapter.nameKey) },
          el('span', 'pu-letter', {}, String(cs.chapter.n)),
        );
        tab.style.setProperty('--accent', cs.chapter.accent);
        tab.tabIndex = on ? 0 : -1;
        tab.addEventListener('click', () => showPage(p));
        return tab;
      }),
    );
    chPrev.disabled = page <= 0;
    chNext.disabled = page >= chapters.length - 1;
    // Title banner: the chapter's name; the sea takes the chapter's tint.
    bannerText.textContent = t(c.chapter.nameKey);
    root.style.setProperty('--chapter-accent', c.chapter.accent);
    root.style.setProperty('--sea-wash', seaWash(c.chapter));
    root.dataset.chapter = c.chapter.id;
    sea.setGrade(c.chapter.sea);
    // The fog: a chapter not reached yet, or one still to come.
    veil.hidden = !veiled;
    root.classList.toggle('chapter-veiled', veiled);
    root.classList.toggle('chapter-soon', c.chapter.status === 'soon');
    if (veiled) {
      const soon = c.chapter.status === 'soon';
      const prev = chapters[page - 1];
      const paidChapter = !soon && c.page.own.some((i) => paid[i]);
      veilCard.replaceChildren(
        el('div', 'pu-ch-veil-kicker pu-ink-soft', {}, t('chapter.label', { n: c.chapter.n })),
        el('div', 'pu-ch-veil-name pu-letter', {}, t(c.chapter.nameKey)),
        el('div', 'pu-ch-veil-state pu-ink', {}, glyph('lock'), soon ? t('chapter.soon') : t('chapter.locked')),
        el('div', 'pu-ch-veil-hint pu-ink-soft', {}, soon ? t('chapter.soonHint') : t('chapter.lockedHint', { n: prev?.chapter.n ?? 1 })),
      );
      // The full adventure starts with the first chapter past the free scope (Chapter 2).
      const firstPaid = chapters.find((x) => x.page.own.some((i) => paid[i]))?.chapter.n ?? c.chapter.n;
      if (paidChapter) veilCard.append(el('div', 'pu-ch-veil-hint pu-ink-soft', {}, t('chapter.lockedPaid', { n: firstPaid })));
    }
  };

  const refresh = (): void => {
    states = islandStates(progress, levels);
    const scoped = storeEnabled();
    paid = states.map((st) => scoped && needsFullAdventure(st.level.id));
    chapters = chapterStates(states);
    shown = pages[page]?.indexes ?? [];
    renderChapterBar();
    buildNodes();
    refreshTopbar();
    relayout(true);
  };

  /** Turns to chapter page `p` (`at`: an island to centre, else the start, or the end going back). */
  const showPage = (p: number, at?: number | 'start' | 'end'): void => {
    const to = Math.max(0, Math.min(pages.length - 1, p));
    if (to === page && at === undefined) return;
    const dir = to > page ? 1 : -1;
    page = to;
    scrollTarget = at ?? (dir > 0 ? 'start' : 'end');
    if (at === undefined) {
      // Arriving on the frontier's chapter centres the ship.
      const f = Math.max(0, Math.min(levels.length - 1, progress.unlockedLevelIndex));
      if (pages[to]?.indexes.includes(f)) scrollTarget = f;
    }
    refresh();
    if (!document.documentElement.classList.contains('pu-reduce-motion')) {
      world.classList.remove('pu-page-turn', 'back');
      void world.offsetWidth;
      world.classList.add('pu-page-turn');
      world.classList.toggle('back', dir < 0);
    }
  };
  chPrev.addEventListener('click', () => showPage(page - 1));
  chNext.addEventListener('click', () => showPage(page + 1));

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
  mkBtn.addEventListener('click', () => openMarketSheet());
  lbBtn.addEventListener('click', () => openLogbook(ctx, undefined, refreshTopbar));
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
  /** The sea is scrolled to its left / right end (or does not scroll at all). */
  const atEdge = (dir: -1 | 1): boolean => {
    const max = scroll.scrollWidth - scroll.clientWidth;
    return max <= 2 || (dir < 0 ? scroll.scrollLeft <= 2 : scroll.scrollLeft >= max - 2);
  };
  // Touch: a swipe that starts and ends at the route's end turns the chapter page that way.
  let swipe: { x: number; y: number; left: boolean; right: boolean } | null = null;
  scroll.addEventListener(
    'touchstart',
    (e) => {
      const tp = e.touches[0];
      swipe = e.touches.length === 1 && tp ? { x: tp.clientX, y: tp.clientY, left: atEdge(-1), right: atEdge(1) } : null;
    },
    { passive: true },
  );
  scroll.addEventListener(
    'touchend',
    (e) => {
      const tp = e.changedTouches[0];
      const sw = swipe;
      swipe = null;
      if (!sw || !tp || anySheetOpen()) return;
      const dx = tp.clientX - sw.x;
      if (Math.abs(dx) < 56 || Math.abs(dx) < Math.abs(tp.clientY - sw.y) * 1.4) return;
      if (dx < 0 && sw.right && atEdge(1) && page < pages.length - 1) showPage(page + 1);
      else if (dx > 0 && sw.left && atEdge(-1) && page > 0) showPage(page - 1);
    },
    { passive: true },
  );
  window.addEventListener('keydown', (e) => {
    if (anySheetOpen()) return;
    const inBar = e.target instanceof Node && chBar.contains(e.target);
    if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
      const f = Math.max(0, Math.min(levels.length - 1, progress.unlockedLevelIndex));
      if (!shown.includes(f)) showPage(pageOfIsland(pages, f), f);
      openBrief(f);
    } else if (e.key === 'PageUp' || e.key === '[') showPage(page - 1);
    else if (e.key === 'PageDown' || e.key === ']') showPage(page + 1);
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      // Past the route's end the arrows turn the chapter page (not while walking the chapter tabs).
      if (!inBar && atEdge(dir) && (dir < 0 ? page > 0 : page < pages.length - 1)) showPage(page + dir);
      else if (!inBar) panBy(dir);
    }
  });

  await document.fonts?.ready.catch(() => undefined);
  // Open on the frontier's chapter (?chapter=N: on chapter N, QA).
  const qChapter = Number(q.get('chapter'));
  const frontierIdx = Math.max(0, Math.min(levels.length - 1, progress.unlockedLevelIndex));
  page = Number.isInteger(qChapter) && qChapter >= 1 && qChapter <= pages.length ? qChapter - 1 : pageOfIsland(pages, frontierIdx);
  refresh();
  window.__map = {
    layout: () => layout,
    islands: () =>
      shown.map((i, k) => {
        const s = states[i];
        return { id: s.level.id, unlocked: s.unlocked, paid: paid[i] ?? false, stars: s.stars, x: layout?.nodes[k]?.x ?? 0, y: layout?.nodes[k]?.y ?? 0 };
      }),
    chapter: () => ({ page, id: chapters[page]?.chapter.id ?? '', opened: chapters[page]?.opened ?? false, soon: chapters[page]?.chapter.status === 'soon' }),
    chapters: () => chapters.map((c) => ({ id: c.chapter.id, opened: c.opened, complete: c.complete, cleared: c.cleared, total: c.total, stars: c.stars, maxStars: c.maxStars })),
    showChapter: (p: number) => showPage(p),
  };

  /** The painting of an island's story part (its first beat), else its map. */
  const storyArt = (i: number | undefined, part: 'intro' | 'outro'): string | null => {
    const st = i === undefined ? undefined : states[i];
    if (!st) return null;
    return storyBeats(st.level, part)[0]?.art ?? thumb(st.level);
  };
  const titleCard = (c: ChapterDef, then?: () => void): void => {
    const p = pages.findIndex((pg) => pg.chapter.id === c.id);
    if (p >= 0 && p !== page) showPage(p);
    const cs = chapters[p];
    showChapterTitle(c, storyArt(cs ? firstIsland(cs, states)?.index : undefined, 'intro'), () => then?.());
  };
  const doneCard = (c: ChapterDef, then: () => void): void => {
    const cs = chapters.find((x) => x.chapter.id === c.id);
    if (!cs) return then();
    const finale = cs.page.own.find((i) => states[i]?.level.id === c.finale) ?? cs.page.own[cs.page.own.length - 1];
    const next = nextChapter(c);
    showChapterDone({
      chapter: c,
      art: storyArt(finale, 'outro'),
      stars: cs.stars,
      maxStars: cs.maxStars,
      cleared: cs.cleared,
      total: cs.total,
      next,
      onNext: () => {
        const p = pages.findIndex((pg) => pg.chapter.id === next?.id);
        if (p >= 0) showPage(p);
      },
      onDone: then,
    });
  };

  /** "Campaign complete" (ending2d.ts): the whole campaign's tally, the third ending painting. */
  const campaignCard = (then: () => void): void => {
    void import('./ending2d.ts').then((m) => {
      m.showCampaignCard({ summary: m.campaignSummary(states), art: m.endingArt(manifest)[2] ?? null, onDone: then });
    });
  };

  const screen = q.get('screen');
  if (screen === 'brief') {
    // QA: &pick=endless or &pick=<challenge id>[,<id>] pre-selects modes on the card.
    const pick = (q.get('pick') ?? '').split(',').filter(Boolean);
    // &diff=easy|normal|hard pre-selects the difficulty.
    const diff = parseDifficulty(q.get('diff'));
    const bi = Math.max(0, Math.min(levels.length - 1, Number(q.get('island') ?? progress.unlockedLevelIndex) || 0));
    if (!shown.includes(bi)) showPage(pageOfIsland(pages, bi), bi);
    openBrief(bi, {
      endless: pick.includes('endless'),
      challenges: pick.filter(isChallengeId),
      ...(diff ? { difficulty: diff } : {}),
    });
  }
  else if (screen === 'workshop') openWorkshop(ctx);
  else if (screen === 'market') openMarketSheet();
  else if (screen === 'beltpick') openBrief(Math.max(0, Math.min(levels.length - 1, progress.unlockedLevelIndex)));
  else if (screen === 'logbook') openLogbook(ctx, q.get('tab') === 'feats' ? 'feats' : 'islands', refreshTopbar);
  else if (screen === 'daily') openDaily(ctx);
  else if (screen === 'settings') openSettings(ctx);
  else if (screen === 'credits') openCredits();
  else if (screen === 'heroes') openSkillTree(ctx, heroFiles, isHeroId(q.get('focus')) ? (q.get('focus') as HeroId) : undefined);
  else if (screen === 'herosel') openHeroSelect(ctx, heroFiles, undefined, isHeroId(q.get('focus')) ? (q.get('focus') as HeroId) : undefined);
  else if (screen === 'store' && storeEnabled()) openStoreFor(null);
  // QA: the chapter cards of the page shown (?chapter=N&screen=chaptertitle|chapterdone).
  else if (screen === 'chaptertitle' && chapters[page]) titleCard(chapters[page].chapter);
  else if (screen === 'chapterdone' && chapters[page]) doneCard(chapters[page].chapter, () => undefined);
  // QA: the ending (beat 1), the credits roll (&at=0..1 seeks there and pauses), the campaign card.
  else if (screen === 'ending') void import('./ending2d.ts').then((m) => m.playEnding(manifest, () => undefined));
  else if (screen === 'endcredits') {
    const at = Number(q.get('at'));
    void import('./ending2d.ts').then((m) => {
      const roll = m.playEnding(manifest, () => undefined, { startAt: 'credits' }).roll();
      if (roll && q.has('at') && Number.isFinite(at)) {
        roll.pause(true);
        requestAnimationFrame(() => roll.seek(at));
      }
    });
  } else if (screen === 'campaign') campaignCard(() => undefined);
  // A deep link into an island the free version does not include lands here (main2d.ts).
  const storeFor = q.get('store');
  if (storeFor && storeEnabled()) {
    const i = levels.findIndex((l) => l.id === storeFor);
    if (i >= 0 && paid[i]) {
      showPage(pageOfIsland(pages, i), i);
      openStoreFor(i);
    }
  }
  // A chapter just finished / just opened: its card, once (not over a QA screen or a deep link).
  // After the ending (the last finale's first win): the "Campaign complete" card, once.
  if (!screen && !storeFor && mock === 0) {
    const due = cardsDue(chapters, readCardsSeen(), isCampaignComplete(progress, levels));
    writeCardsSeen(due.seen);
    const title = due.title;
    const titleNext = (): void => (title ? titleCard(title) : undefined);
    if (due.campaign) campaignCard(() => (due.done ? doneCard(due.done, titleNext) : titleNext()));
    else if (due.done) doneCard(due.done, titleNext);
    else if (title) titleCard(title);
  }
}
