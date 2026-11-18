/**
 * Painted Codex for the 2D isles: a ribbon board with Foes / Towers tabs, a grid of medallion
 * tiles (the painted sprites) on the left and the chosen entry on a parchment card on the right.
 *
 * Numbers come from the shared codex data (src/ui/content/codexData.ts: stats, tiers) and the data
 * tables; every word comes from the i18n dictionaries / data lookups, so the Codex reads in the
 * player's language. It replaces the 3D build's DOM codex on the 2D page (that one has English text
 * baked in and the 3D slate look). In 2D every entry counts as met (no sighting log yet).
 */
import type { TowerType } from '../../core/types.ts';
import { getTowerTierStats, TOWER_DEFS } from '../../data/towers.ts';
import {
  enemyCounter,
  enemyDesc,
  enemyName,
  signatureDesc,
  signatureName,
  tagName,
  towerDesc,
  towerName,
  towerShortName,
  towerStrong,
  towerWeak,
} from '../../i18n/data.ts';
import { t, type MsgKey } from '../../i18n/index.ts';
import { allEnemyEntries, allTowerEntries, eliteEntry, speedClass, type CodexEliteEntry, type CodexEnemyEntry } from '../../ui/content/codexData.ts';
import { ENEMY_DEFS } from '../../data/enemies.ts';
import { el, glyph, img, KIT, openSheet, plank, type Sheet } from './dom.ts';
import type { IconName } from './paintedIcons.ts';

export type CodexTab2D = 'enemies' | 'towers';

export interface CodexSheetOptions {
  /** Painted sprite URL for an enemy / tower id (null = blank medallion). */
  readonly enemyUrl: (id: string) => string | null;
  readonly towerUrl: (id: string) => string | null;
  /** Entry ids met in play (default: all). */
  readonly isSeen?: (id: string) => boolean;
  readonly onClose?: () => void;
}

type FoeEntry = CodexEnemyEntry | CodexEliteEntry;

const ROMAN = ['I', 'II', 'III'] as const;
const pct = (n: number): string => `${Math.round(n * 100)}%`;

const SPEED_KEY: Record<ReturnType<typeof speedClass>, MsgKey> = {
  slow: 'codex.speed.slow',
  steady: 'codex.speed.steady',
  quick: 'codex.speed.quick',
  swift: 'codex.speed.swift',
};

/** Localised tier line, e.g. "18 dmg · 1.1/s · range 6" (same parts as the 3D codex). */
export function tierLine(type: TowerType, tier: 1 | 2 | 3): string {
  const s = getTowerTierStats(type, tier);
  const parts: string[] = [];
  if (TOWER_DEFS[type].role === 'support') {
    parts.push(t('codex.tier.fireRate', { p: pct(s.auraRate ?? 0) }));
    if (s.auraRange) parts.push(t('codex.tier.range', { p: pct(s.auraRange) }));
    parts.push(t('codex.tier.aura', { r: s.range }));
    return parts.join(t('common.sep'));
  }
  parts.push(t('codex.tier.dmg', { n: s.damage }), t('codex.tier.rate', { n: s.fireRate }), t('codex.tier.reach', { r: s.range }));
  if (s.splashRadius > 0) parts.push(t('codex.tier.splash', { r: s.splashRadius }));
  if (s.slowRatio > 0) parts.push(t('codex.tier.slow', { p: pct(s.slowRatio) }));
  if (s.chainCount > 0) parts.push(t('codex.tier.jumps', { n: s.chainCount }));
  if (s.armorPierce) parts.push(t('codex.tier.pierce', { n: s.armorPierce }));
  return parts.join(t('common.sep'));
}

function stat(label: string, value: string): HTMLElement {
  return el('div', 'pu-cx-stat', {}, el('strong', 'pu-ink', {}, value), el('span', 'pu-ink-soft', {}, label));
}

function enemyStats(e: FoeEntry): HTMLElement {
  const row = el('div', 'pu-cx-stats');
  if (e.kind === 'elite') {
    const [hp, armor, bounty] = e.stats;
    row.append(stat(t('codex.stat.health'), hp.value), stat(t('codex.stat.armor'), armor.value), stat(t('codex.stat.bounty'), bounty.value));
    return row;
  }
  const d = ENEMY_DEFS[e.id];
  row.append(
    stat(t('codex.stat.health'), String(d.maxHp)),
    stat(t('codex.stat.speed'), t(SPEED_KEY[speedClass(d.speed)])),
    stat(t('codex.stat.armor'), d.armor > 0 ? String(d.armor) : t('codex.none')),
    stat(t('codex.stat.bounty'), t('codex.gold', { n: d.reward })),
    stat(t('codex.stat.lives'), String(d.livesCost)),
  );
  return row;
}

function towerStats(id: TowerType): HTMLElement {
  const d = TOWER_DEFS[id];
  const t1 = getTowerTierStats(id, 1);
  const row = el('div', 'pu-cx-stats');
  row.append(
    stat(t('codex.stat.cost'), t('codex.gold', { n: t1.upgradeCost })),
    stat(t('codex.stat.targets'), d.role === 'support' ? t('codex.targets.support') : d.hitsFlyers ? t('codex.targets.both') : t('codex.targets.ground')),
    stat(t('codex.stat.range'), String(t1.range)),
  );
  if (d.role !== 'support') row.append(stat(t('codex.stat.damage'), String(t1.damage)));
  return row;
}

/** A labelled note with a round seal: "How to stop it", "Strong at", "Watch out". */
function note(icon: IconName, label: string, text: string, tone: 'good' | 'warn' = 'good'): HTMLElement {
  const seal = el('span', 'pu-round', { 'aria-hidden': 'true' });
  seal.append(glyph(icon));
  return el('div', `pu-rule pu-cx-note ${tone}`, {}, seal, el('div', 'pu-ink', {}, label, el('small', 'pu-ink-soft', {}, text)));
}

function tags(list: readonly string[]): HTMLElement {
  return el('div', 'pu-cx-tags pu-ink-soft', {}, list.map(tagName).join(t('common.sep')));
}

export function openCodex2D(opts: CodexSheetOptions, tab: CodexTab2D = 'enemies'): Sheet {
  const sheet = openSheet(t('codex.title'), { cls: 'pu-meta pu-codex', testid: 'codex', onClose: opts.onClose });
  const seen = opts.isSeen ?? (() => true);
  const foes: FoeEntry[] = [...allEnemyEntries(), eliteEntry()];
  const towers = allTowerEntries();
  let selected = foes[0].id as string;

  const tabs = el('div', 'pu-tabs pu-cx-tabs', { role: 'tablist' });
  const count = el('span', 'pu-cx-count pu-ink-soft');
  const grid = el('div', 'pu-cx-grid', { role: 'list' });
  const detail = el('div', 'pu-cx-detail pu-card', { 'data-testid': 'codex-detail' });
  const tabBtns = new Map<CodexTab2D, HTMLButtonElement>();
  for (const [id, key] of [
    ['enemies', 'codex.foes'],
    ['towers', 'codex.towers'],
  ] as const) {
    const b = plank(t(key), { kind: 'small', testid: `codex-tab-${id}` });
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => {
      if (tab === id) return;
      tab = id;
      selected = id === 'enemies' ? foes[0].id : towers[0].id;
      render();
    });
    tabBtns.set(id, b);
    tabs.append(b);
  }
  sheet.body.append(el('div', 'pu-cx-top', {}, tabs, count), el('div', 'pu-cx', {}, grid, detail));

  const tile = (id: string, label: string, url: string | null, locked: boolean, boss: boolean): HTMLButtonElement => {
    const b = el('button', `pu-cx-tile${id === selected ? ' active' : ''}${locked ? ' locked' : ''}${boss ? ' boss' : ''}`, {
      type: 'button',
      role: 'listitem',
      'data-testid': `codex-tile-${id}`,
      'aria-pressed': String(id === selected),
    });
    const face = el('span', 'pu-cx-medal');
    if (url) face.append(img(url, '', 'pu-cx-art'));
    else if (id === 'elite') face.append(img(KIT.star, '', 'pu-cx-art star'));
    b.append(face, el('span', 'pu-cx-name pu-ink', {}, locked ? '? ? ?' : label));
    b.addEventListener('click', () => {
      selected = id;
      render();
    });
    return b;
  };

  const head = (url: string | null, kicker: string, name: string, star = false): HTMLElement => {
    const face = el('span', 'pu-cx-medal big');
    if (url) face.append(img(url, '', 'pu-cx-art'));
    else if (star) face.append(img(KIT.star, '', 'pu-cx-art star'));
    return el('div', 'pu-cx-head', {}, face, el('div', '', {}, el('div', 'pu-cx-kicker pu-ink-soft', {}, kicker), el('div', 'pu-cx-title pu-ink', {}, name)));
  };

  const foeDetail = (e: FoeEntry): void => {
    if (!seen(e.id)) {
      detail.append(head(null, t('codex.notMet'), t('codex.unknown')), el('p', 'pu-cx-desc pu-ink-soft', {}, t('codex.unknownDesc')));
      return;
    }
    if (e.kind === 'elite') {
      detail.append(
        head(null, t('codex.kicker.variant'), t('codex.elite.name'), true),
        tags(e.tags),
        el('p', 'pu-cx-desc pu-ink', {}, t('codex.elite.desc')),
        enemyStats(e),
        note('medal', t('codex.howToStop'), t('codex.elite.counter')),
      );
      return;
    }
    const kicker = e.isBoss ? t('codex.kicker.boss') : e.flying ? t('codex.kicker.flyer') : t('codex.kicker.foe');
    detail.append(
      head(opts.enemyUrl(e.id), kicker, enemyName(e.id)),
      tags(e.tags),
      el('p', 'pu-cx-desc pu-ink', {}, enemyDesc(e.id)),
      enemyStats(e),
      note('medal', t('codex.howToStop'), enemyCounter(e.id)),
    );
  };

  const towerDetail = (id: TowerType): void => {
    const entry = towers.find((x) => x.id === id)!;
    const tiers = el('div', 'pu-cx-tiers');
    for (const tier of [1, 2, 3] as const) {
      tiers.append(
        el(
          'div',
          'pu-cx-tier',
          {},
          el('span', 'pu-ledger-num pu-letter', {}, ROMAN[tier - 1]),
          el('span', 'pu-ink-soft', {}, tierLine(id, tier)),
          el('span', 'pu-cx-cost pu-ink', {}, img(KIT.gold), String(getTowerTierStats(id, tier).upgradeCost)),
        ),
      );
    }
    detail.append(
      head(opts.towerUrl(id), t('codex.kicker.tower'), towerName(id)),
      tags(entry.tags),
      el('p', 'pu-cx-desc pu-ink', {}, towerDesc(id)),
      towerStats(id),
      note('trophy', t('codex.strongAt'), towerStrong(id)),
      note('lock', t('codex.watchOut'), towerWeak(id), 'warn'),
      el('div', 'pu-cx-sub pu-letter', {}, t('codex.tiers')),
      tiers,
      note('crown', t('codex.signature', { name: signatureName(id) }), signatureDesc(id)),
    );
  };

  const render = (): void => {
    for (const [id, b] of tabBtns) b.setAttribute('aria-selected', String(id === tab));
    const met = foes.filter((e) => seen(e.id)).length;
    count.textContent = tab === 'enemies' ? t('codex.met', { seen: met, n: foes.length }) : t('codex.towerCount', { n: towers.length });
    grid.replaceChildren();
    detail.replaceChildren();
    if (tab === 'enemies') {
      for (const e of foes) {
        const label = e.kind === 'elite' ? t('codex.elite.tile') : enemyName(e.id);
        grid.append(tile(e.id, label, e.kind === 'enemy' ? opts.enemyUrl(e.id) : null, !seen(e.id), e.kind === 'enemy' && e.isBoss));
      }
      const e = foes.find((x) => x.id === selected) ?? foes[0];
      foeDetail(e);
    } else {
      for (const tw of towers) grid.append(tile(tw.id, towerShortName(tw.id), opts.towerUrl(tw.id), false, false));
      towerDetail((towers.find((x) => x.id === selected) ?? towers[0]).id);
    }
    detail.scrollTop = 0;
  };
  render();
  requestAnimationFrame(() => tabBtns.get(tab)?.focus({ preventScroll: true }));
  return sheet;
}
