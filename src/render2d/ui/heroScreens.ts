/**
 * Hero screens on the world map (DOM, painted kit):
 * - `heroChip`: the hero row on the island briefing (portrait, name, level + XP bar, Change / Skills).
 * - `openHeroSelect`: "Choose your hero" — the five heroes (locked ones show their unlock rule),
 *   the full-body select art, role, passive + both actives, level, XP bar, Choose / Skill tree.
 *   The pick is saved (progress2d `heroes.selectedHero`) and used by the next run; `?hero=` deep
 *   links still win in main2d.
 * - `openSkillTree`: per hero 3 branches × 4 tiers + the capstone as painted medallion nodes with
 *   branch icons, owned / available / locked states, points to spend, the node's effect text, Learn
 *   and a free Reset (respec is free on the world map).
 * - `heroesButton`: the round "Heroes" button of the map's top row (the current hero's portrait,
 *   a badge with unspent skill points).
 * Every state change goes through the pure helpers in heroes2d.ts and is saved with saveProgress2D.
 */
import type { HeroId, ProgressData } from '../../core/types.ts';
import { HERO_DEFS, HERO_IDS, type HeroSkillNodeDef } from '../../data/heroes.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import {
  heroBranchDesc,
  heroBranchName,
  heroDesc,
  heroName,
  heroNodeDesc,
  heroNodeName,
  heroPassiveDesc,
  heroPassiveName,
  heroRole,
  heroSkillDesc,
  heroSkillName,
  heroTitle,
} from '../../i18n/data.ts';
import { num, t } from '../../i18n/index.ts';
import { applyNode, clearedIslandsCount2D, heroRoster, nodeUnlockStatus, respec, selectHero, type HeroNodeUnlockStatus, type HeroRosterEntry } from '../heroes2d.ts';
import { el, glyph, img, KIT, openSheet, plank, type Sheet } from './dom.ts';
import { heroBranchUrl, heroPortraitUrl, heroSelectUrl, heroSkillUrl, levelBadge, unlockRuleText, xpBar, type HeroArtFiles } from './heroBits.ts';
import { saveProgress2D } from './progress2d.ts';
import './heroScreens.css';

/** What the hero screens need from the world map (MetaContext fits). */
export interface HeroScreenCtx {
  progress: ProgressData;
  readonly levels: readonly LevelDef[];
  onChange(): void;
}

function commit(ctx: HeroScreenCtx, next: ProgressData): void {
  ctx.progress = next;
  saveProgress2D(next, ctx.levels);
  ctx.onChange();
}

function roster(ctx: HeroScreenCtx): HeroRosterEntry[] {
  return heroRoster(ctx.progress, ctx.levels);
}

/** Round painted portrait (falls back to a coloured disc with the initial). */
function portrait(files: HeroArtFiles, id: HeroId, cls = ''): HTMLSpanElement {
  const p = el('span', `pu-hero-face${cls ? ` ${cls}` : ''}`, { 'data-hero': id });
  const url = heroPortraitUrl(files, id);
  if (url) p.append(img(url, '', 'pu-hero-face-art'));
  else p.append(el('span', 'pu-hero-face-initial pu-letter', {}, heroName(id).slice(0, 1)));
  return p;
}

function pointsTag(n: number): HTMLSpanElement {
  return el('span', `pu-hero-points pu-letter${n > 0 ? ' has' : ''}`, { 'data-testid': 'hero-points' }, t('hero.points', { n }));
}

// --- briefing chip -----------------------------------------------------------------------------

export interface HeroChip {
  readonly el: HTMLElement;
  refresh(): void;
}

/**
 * The hero on the island briefing's loadout row: one tappable chip (portrait + level, name) that
 * opens "Choose your hero", and a small round skill-tree button (badge = unspent points).
 */
export function heroChip(ctx: HeroScreenCtx, files: HeroArtFiles): HeroChip {
  const box = el('div', 'pu-hero-chip', { 'data-testid': 'brief2d-hero' });
  const refresh = (): void => {
    const r = roster(ctx).find((e) => e.selected) ?? roster(ctx)[0];
    const face = portrait(files, r.id, 'pu-hero-chip-face');
    face.append(levelBadge(r.level, 'pu-hero-face-lvl'));
    const xp = r.xpProgress.nextLevelXp === null ? t('hero.maxLevel') : t('hero.xpOf', { xp: r.xpProgress.xpIntoLevel, need: r.xpProgress.xpForNextLevel });
    const about = `${t('hero.yourHero')}: ${heroName(r.id)}${t('common.sep')}${heroTitle(r.id)}${t('common.sep')}${t('hero.levelAria', { n: r.level })}${t('common.sep')}${xp}`;
    const change = el('button', 'pu-hero-chip-pick', { type: 'button', 'data-testid': 'brief2d-hero-change', 'aria-label': `${about}. ${t('hero.change')}`, title: about });
    change.append(face, el('span', 'pu-hero-chip-name pu-ink', {}, heroName(r.id)));
    change.addEventListener('click', () => openHeroSelect(ctx, files, () => refresh()));
    const skills = el('button', 'pu-round pu-hero-chip-tree', { type: 'button', 'data-testid': 'brief2d-hero-skills', 'aria-label': t('hero.skillsBtn'), title: t('hero.skillsBtn') });
    skills.append(img(KIT.upgrade, '', 'pu-hero-chip-tree-icon'));
    if (r.skillPointsAvailable > 0) skills.append(el('span', 'pu-badge', { 'aria-label': t('hero.points', { n: r.skillPointsAvailable }) }, String(r.skillPointsAvailable)));
    skills.addEventListener('click', () => openSkillTree(ctx, files, r.id, () => refresh()));
    box.replaceChildren(change, skills);
  };
  refresh();
  return { el: box, refresh };
}

// --- hero select -------------------------------------------------------------------------------

function skillLine(files: HeroArtFiles, id: HeroId, slot: 'passive' | 0 | 1, extra: string): HTMLElement {
  const url = heroSkillUrl(files, id, slot);
  const name = slot === 'passive' ? heroPassiveName(id) : heroSkillName(id, slot);
  const desc = slot === 'passive' ? heroPassiveDesc(id) : heroSkillDesc(id, slot);
  const kind = slot === 'passive' ? t('hero.passive') : t('hero.active', { n: slot + 1 });
  const icon = el('span', 'pu-hero-skill-icon');
  if (url) icon.append(img(url));
  return el(
    'div',
    'pu-hero-skill',
    { 'data-skill': slot },
    icon,
    el('div', 'pu-hero-skill-text', {}, el('div', 'pu-ink', {}, name, el('small', 'pu-hero-skill-kind', {}, kind), extra ? el('small', 'pu-ink-soft', {}, extra) : null), el('div', 'pu-ink-soft', {}, desc)),
  );
}

/** "Choose your hero": the roster, select art and the focused hero's details. */
export function openHeroSelect(ctx: HeroScreenCtx, files: HeroArtFiles, onDone?: (id: HeroId) => void, focusId?: HeroId): Sheet {
  const sheet = openSheet(t('hero.chooseTitle'), { cls: 'pu-meta pu-hero-sel', testid: 'hero2d-select' });
  let focus: HeroId = focusId ?? roster(ctx).find((e) => e.selected)?.id ?? 'bran';
  const render = (): void => {
    const list = roster(ctx);
    const cur = list.find((e) => e.id === focus) ?? list[0];
    const tabs = el('div', 'pu-hero-roster', { role: 'tablist', 'aria-label': t('hero.rosterAria') });
    for (const e of list) {
      const b = el('button', `pu-hero-tab${e.id === focus ? ' on' : ''}${e.unlocked ? '' : ' locked'}${e.selected ? ' chosen' : ''}`, {
        type: 'button',
        role: 'tab',
        'aria-selected': String(e.id === focus),
        'data-testid': `hero2d-tab-${e.id}`,
        'aria-label': e.unlocked ? `${heroName(e.id)}, ${t('hero.levelAria', { n: e.level })}` : `${heroName(e.id)}, ${t('hero.locked')}`,
      });
      const face = portrait(files, e.id);
      if (e.unlocked) face.append(levelBadge(e.level, 'pu-hero-face-lvl'));
      else {
        const lock = el('span', 'pu-hero-face-lock');
        lock.append(glyph('lock'));
        face.append(lock);
      }
      if (e.selected) face.append(img(KIT.confirm, '', 'pu-hero-face-check'));
      b.append(face, el('span', 'pu-hero-tab-name pu-letter', {}, heroName(e.id).split(' ')[0]));
      b.addEventListener('click', () => {
        focus = e.id;
        render();
      });
      tabs.append(b);
    }
    const artUrl = heroSelectUrl(files, cur.id);
    const art = el('div', `pu-hero-art${cur.unlocked ? '' : ' locked'}`, {}, artUrl ? img(artUrl, heroName(cur.id), 'pu-hero-art-img') : portrait(files, cur.id));
    const def = HERO_DEFS[cur.id];
    const info = el('div', 'pu-hero-info');
    info.append(
      el('div', 'pu-hero-name pu-ink', {}, heroName(cur.id)),
      el('div', 'pu-hero-sub pu-ink-soft', {}, `${heroTitle(cur.id)}${t('common.sep')}${heroRole(cur.id)}`),
      el('div', 'pu-hero-blurb pu-ink-soft', {}, heroDesc(cur.id)),
    );
    if (cur.unlocked) {
      info.append(el('div', 'pu-hero-lvlrow', {}, levelBadge(cur.level), xpBar(cur.xpProgress), pointsTag(cur.skillPointsAvailable)));
    } else {
      const rule = cur.unlockRule;
      const have = clearedIslandsCount2D(ctx.progress, ctx.levels);
      info.append(
        el(
          'div',
          'pu-hero-unlock pu-ink',
          { 'data-testid': 'hero2d-unlock' },
          glyph('lock'),
          el('span', '', {}, unlockRuleText(rule), rule.kind === 'islandsCleared' ? el('small', 'pu-ink-soft', {}, t('hero.unlockProgress', { have: Math.min(have, rule.count), n: rule.count })) : null),
        ),
      );
    }
    const st = cur.resolvedStats;
    info.append(
      el(
        'div',
        'pu-hero-stats pu-ink',
        {},
        el('span', '', {}, glyph('heart'), num(st.maxHp)),
        el('span', '', {}, t('hero.statDamage', { n: num(st.damage) })),
        el('span', '', {}, def.baseStats.attackMode === 'melee' ? t('hero.melee') : t('hero.ranged')),
      ),
      skillLine(files, cur.id, 'passive', ''),
      skillLine(files, cur.id, 0, t('ab.cooldown', { n: Math.round(st.actives[0].cooldownSec) })),
      skillLine(files, cur.id, 1, t('ab.cooldown', { n: Math.round(st.actives[1].cooldownSec) })),
    );
    const tree = plank(t('hero.skillsBtn'), { kind: 'small', testid: 'hero2d-open-tree' });
    if (cur.unlocked && cur.skillPointsAvailable > 0) tree.append(el('span', 'pu-badge', {}, String(cur.skillPointsAvailable)));
    tree.addEventListener('click', () => openSkillTree(ctx, files, cur.id, () => render()));
    const choose = plank(cur.selected ? t('hero.chosen') : cur.unlocked ? t('hero.choose') : t('hero.locked'), { kind: 'primary', icon: cur.unlocked ? undefined : 'lock', testid: 'hero2d-choose' });
    choose.disabled = !cur.unlocked || cur.selected;
    choose.addEventListener('click', () => {
      const next = selectHero(ctx.progress, cur.id, ctx.levels);
      if (!next) return;
      commit(ctx, next);
      onDone?.(cur.id);
      sheet.close();
    });
    sheet.body.replaceChildren(el('div', 'pu-hero-sel-grid', {}, tabs, art, info), el('div', 'pu-hero-actions', {}, tree, choose));
  };
  render();
  return sheet;
}

// --- skill tree --------------------------------------------------------------------------------

const STATUS_CLASS: Readonly<Record<HeroNodeUnlockStatus, string>> = {
  unlocked: 'owned',
  available: 'available',
  insufficientPoints: 'poor',
  lockedPrereq: 'locked',
  heroLocked: 'locked',
  invalid: 'locked',
};

/** Requirement line of a node ("Needs Deep Roots" / "Needs 2 of 3 tier-3 skills"). */
function requirement(id: HeroId, n: HeroSkillNodeDef): string {
  if (n.prerequisites.length === 0) return '';
  if (n.minPrerequisites !== undefined) return t('hero.needsAny', { n: n.minPrerequisites, of: n.prerequisites.length });
  return t('hero.needs', { name: n.prerequisites.map((p) => heroNodeName(id, p)).join(t('common.sep')) });
}

export type TreeLayout = 'down' | 'across';

/**
 * Layout / node zoom tried in order until the whole tree (capstone included) sits inside the board
 * without scrolling: the vertical tree first (a little smaller if need be), then the left-to-right
 * tree for short screens (landscape phones, small laptops), largest zoom first.
 */
export const TREE_FIT_STEPS: ReadonlyArray<readonly [TreeLayout, number]> = [
  ['down', 1],
  ['down', 0.94],
  ['down', 0.88],
  ['down', 0.83],
  ['across', 1.15],
  ['across', 1.05],
  ['across', 1],
  ['across', 0.93],
  ['across', 0.86],
  ['across', 0.8],
  ['across', 0.74],
  // Big interface sizes on phones (Settings → Interface size 130 %).
  ['across', 0.68],
  ['across', 0.62],
  ['across', 0.56],
  ['across', 0.5],
];

/** First fitting step (`fits` measures the DOM); the last step when nothing fits (the body scrolls). */
export function pickTreeFit(fits: (layout: TreeLayout, zoom: number) => boolean): readonly [TreeLayout, number] {
  for (const step of TREE_FIT_STEPS) if (fits(step[0], step[1])) return step;
  return TREE_FIT_STEPS[TREE_FIT_STEPS.length - 1];
}

/** Fits the tree grid into the sheet body (layout + zoom), then joins the across capstone bracket. */
interface TreeParts {
  body: HTMLElement;
  main: HTMLElement;
  grid: HTMLElement;
  /** Tier-4 medals of the branches, top to bottom. */
  ends: HTMLElement[];
  capRow: HTMLElement | null;
  capMedal: HTMLElement | null;
}

function fitTree({ body, main, grid, ends: endMedals, capRow, capMedal }: TreeParts): void {
  const apply = (layout: TreeLayout, zoom: number): void => {
    grid.dataset.layout = layout;
    main.dataset.layout = layout;
    grid.style.setProperty('--tz', String(zoom));
  };
  // The board pops in with a scale animation: rects are scaled, client sizes are not.
  const scale = (): number => {
    const h = body.offsetHeight;
    return h > 0 ? body.getBoundingClientRect().height / h : 1;
  };
  const fits = (layout: TreeLayout, zoom: number): boolean => {
    apply(layout, zoom);
    const k = scale();
    const pad = parseFloat(getComputedStyle(body).paddingBottom) || 0;
    const room = body.clientTop + body.clientHeight - pad;
    const low = (grid.getBoundingClientRect().bottom - body.getBoundingClientRect().top) / k;
    return low <= room + 1 && main.scrollWidth <= main.clientWidth + 1 && grid.scrollWidth <= grid.clientWidth + 1;
  };
  const top = body.scrollTop;
  body.scrollTop = 0;
  // On phone policy (`html.pu-phone`), never shrink skill nodes below comfortable touch size:
  // lock zoom to 1 and let the sheet body scroll instead of cramming unreadable nodes.
  const phone = document.documentElement.classList.contains('pu-phone');
  const [layout, zoom]: readonly [TreeLayout, number] = phone
    ? [window.innerWidth >= 860 ? 'across' : 'down', 1]
    : pickTreeFit(fits);
  apply(layout, zoom);
  body.scrollTop = top;
  if (!capRow) return;
  for (const k of ['--bar-top', '--bar-h', '--stub-y', '--cap-pad']) capRow.style.removeProperty(k);
  if (layout !== 'across') return;
  // Bracket from the first branch's tier-4 medal to the last one's, the capstone level with its middle.
  const k = scale();
  const ends = endMedals.map((m) => {
    const r = m.getBoundingClientRect();
    return (r.top + r.height / 2) / k;
  });
  if (ends.length < 2 || !capMedal) return;
  const rowTop = capRow.getBoundingClientRect().top / k;
  const y0 = Math.min(...ends) - rowTop;
  const y1 = Math.max(...ends) - rowTop;
  const mid = (y0 + y1) / 2;
  capRow.style.setProperty('--bar-top', `${y0}px`);
  capRow.style.setProperty('--bar-h', `${y1 - y0}px`);
  capRow.style.setProperty('--stub-y', `${mid - y0}px`);
  capRow.style.setProperty('--cap-pad', `${Math.max(0, mid - capMedal.getBoundingClientRect().height / k / 2)}px`);
}

/** The skill tree of one hero (tabs switch heroes). */
export function openSkillTree(ctx: HeroScreenCtx, files: HeroArtFiles, heroId?: HeroId, onClose?: () => void): Sheet {
  const sheet = openSheet(t('hero.treeTitle'), { cls: 'pu-meta pu-hero-tree', testid: 'hero2d-tree', onClose });
  let hero: HeroId = heroId ?? roster(ctx).find((e) => e.selected)?.id ?? 'bran';
  let picked: string | null = null;
  let armedUntil = 0;
  let justLearned: string | null = null;
  const render = (): void => {
    const list = roster(ctx);
    const cur = list.find((e) => e.id === hero) ?? list[0];
    const def = HERO_DEFS[cur.id];
    // Hero tabs.
    const tabs = el('div', 'pu-hero-tree-tabs', { role: 'tablist' });
    for (const e of list) {
      const b = el('button', `pu-hero-tab small${e.id === hero ? ' on' : ''}${e.unlocked ? '' : ' locked'}`, { type: 'button', role: 'tab', 'aria-selected': String(e.id === hero), 'data-testid': `tree2d-tab-${e.id}`, 'aria-label': heroName(e.id) });
      const face = portrait(files, e.id);
      if (e.unlocked && e.skillPointsAvailable > 0) face.append(el('span', 'pu-badge', {}, String(e.skillPointsAvailable)));
      if (!e.unlocked) {
        const lock = el('span', 'pu-hero-face-lock');
        lock.append(glyph('lock'));
        face.append(lock);
      }
      b.append(face);
      b.addEventListener('click', () => {
        hero = e.id;
        picked = null;
        armedUntil = 0;
        render();
      });
      tabs.append(b);
    }
    // Header: who, level, XP, points, Reset.
    const reset = plank(performance.now() < armedUntil ? t('hero.resetArmed', { n: cur.skillPointsSpent }) : t('hero.reset'), { kind: 'small', testid: 'tree2d-reset' });
    reset.disabled = cur.skillPointsSpent === 0;
    reset.title = t('hero.resetNote');
    reset.addEventListener('click', () => {
      if (performance.now() < armedUntil) {
        armedUntil = 0;
        picked = null;
        commit(ctx, respec(ctx.progress, cur.id, ctx.levels));
        render();
        return;
      }
      armedUntil = performance.now() + 3200;
      render();
      window.setTimeout(render, 3300);
    });
    const head = el(
      'div',
      'pu-hero-tree-head',
      {},
      portrait(files, cur.id, 'pu-hero-tree-face'),
      el('div', 'pu-hero-tree-who', {}, el('div', 'pu-hero-name pu-ink', {}, heroName(cur.id), ' ', levelBadge(cur.level)), cur.unlocked ? xpBar(cur.xpProgress) : el('div', 'pu-ink-soft', {}, unlockRuleText(cur.unlockRule))),
      el('div', 'pu-hero-tree-pts', {}, pointsTag(cur.skillPointsAvailable), el('small', 'pu-ink-soft', {}, t('hero.pointsNote', { spent: cur.skillPointsSpent, earned: cur.skillPointsEarned }))),
      reset,
    );
    // Branch columns (tiers 1..4), then the capstone.
    const grid = el('div', `pu-hero-tree-grid${cur.unlocked ? '' : ' hero-locked'}`);
    const medals = new Map<string, HTMLElement>();
    const nodeBtn = (n: HeroSkillNodeDef, branchIndex: number): HTMLButtonElement => {
      const status = nodeUnlockStatus(ctx.progress, cur.id, n.id, ctx.levels);
      const b = el('button', `pu-hnode ${STATUS_CLASS[status]}${n.isCapstone ? ' cap' : ''}${picked === n.id ? ' picked' : ''}${justLearned === n.id ? ' just' : ''}`, {
        type: 'button',
        'data-node': n.id,
        'data-status': status,
        'data-testid': `tree2d-node-${n.id}`,
        'aria-label': `${heroNodeName(cur.id, n.id)}: ${heroNodeDesc(cur.id, n.id)}`,
        'aria-pressed': String(picked === n.id),
      });
      const medal = el('span', 'pu-hnode-medal');
      medal.append(img(status === 'unlocked' || status === 'available' ? KIT.medallionHi : KIT.medallion, '', 'pu-hnode-ring'));
      const disc = el('span', 'pu-hnode-disc');
      if (n.isCapstone) {
        disc.classList.add('cap');
        for (let i = 0; i < 3; i++) {
          const u = heroBranchUrl(files, cur.id, i);
          if (u) disc.append(img(u, '', `pu-hnode-cap${i}`));
        }
      } else {
        const u = heroBranchUrl(files, cur.id, branchIndex);
        if (u) disc.append(img(u));
      }
      medal.append(disc);
      medals.set(n.id, medal);
      if (status === 'unlocked') medal.append(img(KIT.confirm, '', 'pu-hnode-check'));
      else if (status === 'lockedPrereq' || status === 'heroLocked') {
        const l = el('span', 'pu-hnode-lock');
        l.append(glyph('lock'));
        medal.append(l);
      }
      const pips = el('span', 'pu-hnode-cost', { 'aria-hidden': 'true' });
      for (let i = 0; i < n.cost; i++) pips.append(img(status === 'unlocked' ? KIT.pipFilled : KIT.pipEmpty));
      b.append(medal, el('span', 'pu-hnode-name pu-ink', {}, heroNodeName(cur.id, n.id)), pips);
      b.addEventListener('click', () => {
        picked = picked === n.id ? null : n.id;
        render();
      });
      return b;
    };
    def.branches.forEach((br, bi) => {
      const col = el('section', 'pu-hero-branch', { 'data-branch': br.id });
      const icon = heroBranchUrl(files, cur.id, bi);
      col.append(
        el(
          'h3',
          'pu-hero-branch-head',
          {},
          el('span', 'pu-hero-branch-title', {}, icon ? img(icon, '', 'pu-hero-branch-icon') : null, el('span', 'pu-letter', {}, heroBranchName(cur.id, br.id))),
          el('small', 'pu-ink-soft', {}, heroBranchDesc(cur.id, br.id)),
        ),
      );
      const nodes = def.skillTree.filter((n) => n.branch === br.id).sort((a, b) => a.tier - b.tier);
      for (const n of nodes) {
        const owned = cur.unlockedSkills.includes(n.id);
        const wrap = el('div', `pu-hnode-wrap tier${n.tier}${owned ? ' owned' : ''}`);
        wrap.append(nodeBtn(n, bi));
        col.append(wrap);
      }
      grid.append(col);
    });
    const cap = def.skillTree.find((n) => n.isCapstone);
    let capRowEl: HTMLElement | null = null;
    if (cap) {
      const capOwned = cur.unlockedSkills.includes(cap.id);
      const have = cap.prerequisites.filter((p) => cur.unlockedSkills.includes(p)).length;
      const capRow = el('div', `pu-hero-cap-row${capOwned ? ' owned' : ''}${have >= (cap.minPrerequisites ?? cap.prerequisites.length) ? ' ready' : ''}`, {}, el('span', 'pu-hero-cap-bar', { 'aria-hidden': 'true' }), nodeBtn(cap, 0));
      grid.append(capRow);
      capRowEl = capRow;
    }
    // Details of the picked node (or a hint).
    const detail = el('div', 'pu-hero-node-detail pu-card', { 'data-testid': 'tree2d-detail' });
    const pn = picked ? def.skillTree.find((n) => n.id === picked) : null;
    if (pn) {
      const status = nodeUnlockStatus(ctx.progress, cur.id, pn.id, ctx.levels);
      const branch = pn.isCapstone ? t('hero.capstone') : heroBranchName(cur.id, pn.branch);
      const req = requirement(cur.id, pn);
      const learn = plank(status === 'unlocked' ? t('hero.learned') : t('hero.learn', { n: pn.cost }), { kind: 'small', testid: 'tree2d-learn' });
      learn.disabled = status !== 'available';
      learn.addEventListener('click', () => {
        const next = applyNode(ctx.progress, cur.id, pn.id, ctx.levels);
        if (!next) return;
        justLearned = pn.id;
        commit(ctx, next);
        render();
        window.setTimeout(() => {
          justLearned = null;
        }, 700);
      });
      const why =
        status === 'lockedPrereq' ? req : status === 'insufficientPoints' ? t('hero.notEnough', { n: pn.cost }) : status === 'heroLocked' ? unlockRuleText(cur.unlockRule) : '';
      detail.append(
        el('div', 'pu-hero-node-title pu-ink', {}, heroNodeName(cur.id, pn.id), el('small', 'pu-ink-soft', {}, `${branch}${t('common.sep')}${t('hero.tier', { n: pn.tier })}${t('common.sep')}${t('hero.cost', { n: pn.cost })}`)),
        el('div', 'pu-hero-node-desc pu-ink', {}, heroNodeDesc(cur.id, pn.id)),
        el('div', 'pu-hero-node-foot', {}, el('span', `pu-hero-node-why pu-ink-soft${why ? ' warn' : ''}`, {}, why || req), learn),
      );
    } else {
      detail.append(el('div', 'pu-ink-soft pu-hero-node-hint', {}, cur.unlocked ? t('hero.treeHint') : unlockRuleText(cur.unlockRule)));
    }
    const main = el('div', 'pu-hero-tree-main', {}, grid, detail);
    sheet.body.replaceChildren(el('div', 'pu-hero-tree-top', {}, tabs, head), main);
    const parts: TreeParts = {
      body: sheet.body,
      main,
      grid,
      ends: def.branches.flatMap((br) => {
        const last = def.skillTree.filter((n) => n.branch === br.id && !n.isCapstone).sort((a, b) => b.tier - a.tier)[0];
        const m = last ? medals.get(last.id) : undefined;
        return m ? [m] : [];
      }),
      capRow: capRowEl,
      capMedal: cap ? (medals.get(cap.id) ?? null) : null,
    };
    fitTree(parts);
    refit = () => fitTree(parts);
  };
  let refit = (): void => undefined;
  let raf = 0;
  const onResize = (): void => {
    if (!sheet.overlay.isConnected) {
      window.removeEventListener('resize', onResize);
      return;
    }
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => refit());
  };
  window.addEventListener('resize', onResize);
  render();
  return sheet;
}

// --- world map button --------------------------------------------------------------------------

/** Round "Heroes" button for the map's top row: the chosen hero's portrait + unspent points badge. */
export function heroesButton(files: HeroArtFiles): { el: HTMLButtonElement; refresh(ctx: HeroScreenCtx): void } {
  const b = el('button', 'pu-round pu-hero-mapbtn', { type: 'button', 'aria-label': t('hero.heroes'), 'data-testid': 'map2d-heroes', title: t('hero.heroes') });
  const refresh = (ctx: HeroScreenCtx): void => {
    const list = roster(ctx);
    const cur = list.find((e) => e.selected) ?? list[0];
    const pts = list.filter((e) => e.unlocked).reduce((a, e) => a + e.skillPointsAvailable, 0);
    b.replaceChildren(portrait(files, cur.id, 'pu-hero-mapbtn-face'), el('span', 'pu-round-label pu-letter', {}, t('hero.heroes')));
    if (pts > 0) b.append(el('span', 'pu-badge', { 'aria-label': t('hero.points', { n: pts }) }, String(pts)));
  };
  return { el: b, refresh };
}

/** All five ids in roster order (QA). */
export const HERO_ORDER: readonly HeroId[] = HERO_IDS;
