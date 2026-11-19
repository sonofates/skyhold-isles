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

/** The hero row on the island briefing: who sails with you, level + XP, Change and Skills. */
export function heroChip(ctx: HeroScreenCtx, files: HeroArtFiles): HeroChip {
  const box = el('div', 'pu-hero-chip', { 'data-testid': 'brief2d-hero' });
  const refresh = (): void => {
    const r = roster(ctx).find((e) => e.selected) ?? roster(ctx)[0];
    const change = plank(t('hero.change'), { kind: 'small', testid: 'brief2d-hero-change' });
    change.addEventListener('click', () => openHeroSelect(ctx, files, () => refresh()));
    const skills = plank(t('hero.skillsBtn'), { kind: 'small', testid: 'brief2d-hero-skills' });
    if (r.skillPointsAvailable > 0) skills.append(el('span', 'pu-badge', { 'aria-label': t('hero.points', { n: r.skillPointsAvailable }) }, String(r.skillPointsAvailable)));
    skills.addEventListener('click', () => openSkillTree(ctx, files, r.id, () => refresh()));
    const face = portrait(files, r.id, 'pu-hero-chip-face');
    face.append(levelBadge(r.level, 'pu-hero-face-lvl'));
    box.replaceChildren(
      el(
        'div',
        'pu-hero-chip-in',
        {},
        face,
        el(
          'div',
          'pu-hero-chip-text',
          {},
          el('div', 'pu-hero-chip-kicker pu-ink-soft', {}, t('hero.yourHero')),
          el('div', 'pu-hero-chip-name pu-ink', {}, heroName(r.id)),
          el('div', 'pu-hero-chip-title pu-ink-soft', {}, heroTitle(r.id)),
          xpBar(r.xpProgress),
        ),
        el('div', 'pu-hero-chip-actions', {}, change, skills),
      ),
    );
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
      col.append(el('h3', 'pu-hero-branch-head', {}, icon ? img(icon, '', 'pu-hero-branch-icon') : null, el('span', 'pu-letter', {}, heroBranchName(cur.id, br.id)), el('small', 'pu-ink-soft', {}, heroBranchDesc(cur.id, br.id))));
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
    if (cap) {
      const capOwned = cur.unlockedSkills.includes(cap.id);
      const have = cap.prerequisites.filter((p) => cur.unlockedSkills.includes(p)).length;
      const capRow = el('div', `pu-hero-cap-row${capOwned ? ' owned' : ''}${have >= (cap.minPrerequisites ?? cap.prerequisites.length) ? ' ready' : ''}`, {}, el('span', 'pu-hero-cap-bar', { 'aria-hidden': 'true' }), nodeBtn(cap, 0));
      grid.append(capRow);
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
    sheet.body.replaceChildren(el('div', 'pu-hero-tree-top', {}, tabs, head), el('div', 'pu-hero-tree-main', {}, grid, detail));
  };
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
