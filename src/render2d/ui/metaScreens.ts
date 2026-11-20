/**
 * Painted 2D views of the meta screens — Workshop, Logbook, Daily Squall, Settings — on top of the
 * 3D build's logic modules (src/data/workshop, src/game/progression + feats, src/data/daily,
 * src/platform/storage settings). Only the views are new; every rule comes from those modules.
 */
import { getMusicVolume, setMusicVolume } from '../../audio/musicPrefs.ts';
import type { GameSettings, ProgressData } from '../../core/types.ts';
import { challengesForLevel, type ChallengeId } from '../../data/challenges.ts';
import { liveStreak, utcDayNumber, type DailyChallenge } from '../../data/daily.ts';
import { endlessTier } from '../../data/endlessMutators.ts';
import { LEVELS_2D } from '../../data/levels2d/index.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { buyRank, maxRank, nextRankCost, rankOf, WORKSHOP_BRANCHES, WORKSHOP_UPGRADES, workshopTotalCost, type WorkshopUpgradeDef } from '../../data/workshop.ts';
import { featStatuses, type FeatIcon } from '../../game/feats.ts';
import { markFeatsSeen, unseenFeats } from './featSeen.ts';
import { isIslandMastered, starWallet } from '../../game/progression.ts';
import { isTouchDevice, loadSettings, saveSettings } from '../../platform/storage.ts';
import { isDesktopClient } from '../renderResolution.ts';
import { ABILITY_KEYS } from './abilities2d.ts';
import { HERO_KEYS } from './heroKeys.ts';
import { announceGraphicsChange, clampUiScale, loadGraphics, reapplyGraphicsSettings, saveGraphics, UI_SCALE_MAX, UI_SCALE_MIN, type EffectsDensity, type FpsCap, type GraphicsSettings } from './graphicsSettings.ts';
import { branchName, challengeDesc, challengeName, difficultyName, featDesc, featName, islandName, upgradeName, upgradeRankText } from '../../i18n/data.ts';
import { getLocale, LANGUAGE_NAMES, LOCALES, pct, setLocale, shortDate, t, type Locale, type MsgKey } from '../../i18n/index.ts';
import { reapplyLocaleSetting, saveLocaleSetting } from '../../i18n/localeSetting.ts';
import { el, glyph, img, KIT, medal, openSheet, plank, sealBadge, slider, starsRow, toggle, type Sheet } from './dom.ts';
import { endlessRecordText, tierColour } from './modeBits.ts';
import { difficultyWinsOf } from '../../data/difficulty.ts';
import { difficultySeal } from './difficulty2d.ts';
import { dailyForToday, dailyHref2D } from './modes2d.ts';
import { openCredits } from './credits2d.ts';
import { navigateWithVeil } from './transition2d.ts';
import { resetProgress2D, saveProgress2D } from './progress2d.ts';
import { openStore, ownsFullAdventure, storeEnabled } from './store2d.ts';

export interface MetaContext {
  progress: ProgressData;
  readonly levels: readonly LevelDef[];
  thumb(level: LevelDef): string | null;
  /** Called after anything changed the save (the map refreshes its stars / badges). */
  onChange(): void;
}

function tally(value: string | number, suffix: string): HTMLDivElement {
  return el('div', 'pu-tally pu-letter', { 'data-testid': 'pu-wallet' }, img(KIT.star), el('b', '', {}, String(value)), el('small', '', {}, suffix));
}

// --- Workshop ------------------------------------------------------------------------------------

export function openWorkshop(ctx: MetaContext): Sheet {
  const sheet = openSheet(t('ws.title'), { cls: 'pu-meta', testid: 'workshop2d' });
  let lastBought: string | null = null;
  let armedUntil = 0;
  const render = (): void => {
    const p = ctx.progress;
    const wallet = starWallet(p);
    sheet.body.innerHTML = '';
    const refund = plank(performance.now() < armedUntil ? t('ws.refundArmed', { n: wallet.spent }) : t('ws.refundAll'), { kind: 'small', testid: 'ws2d-refund' });
    refund.disabled = wallet.spent === 0;
    refund.addEventListener('click', () => {
      if (performance.now() < armedUntil) {
        p.workshop = {};
        armedUntil = 0;
        commit();
        return;
      }
      armedUntil = performance.now() + 3200;
      render();
      window.setTimeout(render, 3300);
    });
    const head = el('div', 'pu-meta-head', {}, tally(wallet.available, t('ws.toSpend')), el('div', 'pu-meta-note pu-ink-soft', {}, t('ws.note')), refund);
    const cols = el('div', 'pu-ws-cols');
    for (const branch of WORKSHOP_BRANCHES) {
      const col = el('section', 'pu-ws-col', {}, el('h3', 'pu-letter', {}, branchName(branch.id)));
      for (const def of WORKSHOP_UPGRADES) if (def.branch === branch.id) col.append(node(def, wallet.available));
      cols.append(col);
    }
    const foot = el(
      'div',
      'pu-meta-foot pu-ink-soft',
      {},
      wallet.earned === 0 ? t('ws.footEmpty') : t('ws.foot', { spent: wallet.spent, total: workshopTotalCost(), earned: wallet.earned }),
    );
    sheet.body.append(head, cols, foot);
  };
  const commit = (): void => {
    saveProgress2D(ctx.progress, ctx.levels);
    ctx.onChange();
    render();
  };
  const node = (def: WorkshopUpgradeDef, available: number): HTMLElement => {
    const p = ctx.progress;
    const rank = rankOf(p.workshop, def.id);
    const max = maxRank(def);
    const cost = nextRankCost(p.workshop, def.id);
    const n = el('div', `pu-ws-node pu-card${rank >= max ? ' maxed' : ''}${lastBought === def.id ? ' just-bought' : ''}`, { 'data-upgrade': def.id });
    const now = rank > 0 ? upgradeRankText(def, rank) : t('ws.notBuilt');
    const effect = el('div', 'pu-ws-effect pu-ink-soft', {}, now);
    if (rank < max) effect.append(' → ', el('span', 'next', {}, upgradeRankText(def, rank + 1)));
    const pips = el('span', 'pu-pips', { 'aria-label': t('ws.rank', { r: rank, max }) });
    for (let i = 0; i < max; i++) pips.append(img(i < rank ? KIT.pipFilled : KIT.pipEmpty, '', `pu-pip${i < rank ? ' on' : ''}`));
    let buy: HTMLButtonElement;
    if (cost === null) {
      buy = plank(t('ws.max'), { kind: 'small', testid: `ws2d-buy-${def.id}` });
      buy.disabled = true;
    } else {
      buy = plank(String(cost), { kind: 'small', testid: `ws2d-buy-${def.id}` });
      buy.prepend(img(KIT.star));
      (buy.firstChild as HTMLImageElement).style.cssText = 'width:1.2em;height:1.2em';
      buy.disabled = cost > available;
      buy.setAttribute('aria-label', t('ws.buyAria', { name: upgradeName(def), n: cost }));
      buy.addEventListener('click', () => {
        const next = buyRank(p.workshop, def.id, starWallet(p).available);
        if (!next) return;
        p.workshop = next;
        lastBought = def.id;
        commit();
      });
    }
    n.append(el('div', 'pu-ws-name', {}, upgradeName(def)), effect, el('div', 'pu-ws-row', {}, pips, buy));
    return n;
  };
  render();
  return sheet;
}

// --- Logbook -------------------------------------------------------------------------------------

/** Feat emblem: the painted `seal-<feat icon>` (every feat icon has its own wax seal). */
function seal(icon: FeatIcon): HTMLSpanElement {
  return sealBadge(icon);
}

export function openLogbook(ctx: MetaContext, tab?: 'islands' | 'feats', onClose?: () => void): Sheet {
  const sheet = openSheet(t('lb.title'), { cls: 'pu-meta', testid: 'logbook2d', onClose });
  // Feats earned since the last look carry a "New" tag (and open the board on their tab).
  const fresh = new Set(unseenFeats(ctx.progress, ctx.levels));
  let view: 'islands' | 'feats' = tab ?? (fresh.size > 0 ? 'feats' : 'islands');
  const render = (): void => {
    const p = ctx.progress;
    const levels = ctx.levels;
    if (view === 'feats') markFeatsSeen(p, levels);
    const wallet = starWallet(p);
    let badges = 0;
    let badgesMax = 0;
    let mastered = 0;
    let cleared = 0;
    let wins = 0;
    let medals = 0;
    const dw = difficultyWinsOf(p);
    const hardWins = dw.hard.filter((v) => v > 0).length;
    levels.forEach((lvl, i) => {
      medals += endlessTier(p.bestEndlessWaves[i] ?? 0, lvl.waves.length);
      const offered = challengesForLevel(lvl);
      badgesMax += offered.length;
      badges += offered.filter((id) => (p.challengeClears[i] ?? []).includes(id)).length;
      if (isIslandMastered(p, i, offered)) mastered++;
      if ((p.clears[i] ?? 0) > 0) cleared++;
      wins += p.clears[i] ?? 0;
    });
    sheet.body.innerHTML = '';
    const total = (icon: FeatIcon, value: string, label: string): HTMLElement =>
      el('div', 'pu-lb-total', { 'data-testid': `lb2d-total-${icon}` }, seal(icon), el('div', '', {}, el('strong', 'pu-ink', {}, value), el('span', 'pu-ink-soft', {}, label)));
    const trophy = total('trophy', String(wins), t('lb.victories'));
    if (hardWins > 0) {
      // "· 3 on Hard" after the victories label (large boards; phones keep the totals on one row).
      trophy.lastElementChild?.lastElementChild?.append(el('span', 'pu-lb-hard', { 'data-testid': 'lb2d-hard-wins' }, t('common.sep') + t('diff.lbHard', { n: hardWins })));
    }
    const totals = el(
      'div',
      'pu-lb-totals',
      {},
      total('star', `${wallet.campaign}/${levels.length * 3}`, t('lb.stars')),
      total('medal', `${badges}/${badgesMax}`, t('lb.badges')),
      total('crown', `${mastered}/${levels.length}`, t('lb.mastered')),
      trophy,
      total('daily', String(liveStreak(p.daily, utcDayNumber(Date.now()))), t('lb.streak', { n: p.daily.bestStreak })),
      total('endless', `${medals}/${levels.length * 3}`, t('lb.medals')),
    );
    const feats = featStatuses(p, levels);
    const earned = feats.filter((f) => f.earned).length;
    const tabs = el('div', 'pu-tabs', { role: 'tablist' });
    const mk = (id: 'islands' | 'feats', label: string): void => {
      const b = plank(label, { kind: 'small', testid: `lb2d-tab-${id}` });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(view === id));
      b.addEventListener('click', () => {
        view = id;
        render();
      });
      if (id === 'feats' && view !== 'feats' && fresh.size > 0) b.append(el('span', 'pu-dot pu-tab-dot', { 'aria-hidden': 'true' }));
      tabs.append(b);
    };
    mk('islands', t('lb.tabIslands'));
    mk('feats', t('lb.tabFeats', { e: earned, n: feats.length }));
    const list = el('div', 'pu-ledger');
    if (view === 'islands') {
      levels.forEach((lvl, i) => {
        const unlocked = i <= p.unlockedLevelIndex;
        const row = el('div', `pu-ledger-row${unlocked ? '' : ' locked'}`);
        const num = el('span', 'pu-ledger-num pu-letter', {}, String(i + 1));
        if (!unlocked) {
          row.append(num, el('span', 'pu-ledger-name pu-ink', {}, t('lb.uncharted'), el('small', 'pu-ink-soft', {}, t('lb.clearToSail', { name: islandName(levels[Math.max(0, i - 1)]) }))));
        } else {
          const lives = p.bestLives[i] ?? 0;
          const w = p.clears[i] ?? 0;
          const done = p.challengeClears[i] ?? [];
          const badges = el('span', 'pu-ledger-badges', { 'data-testid': `lb2d-badges-${lvl.id}` });
          for (const id of challengesForLevel(lvl)) {
            const got = done.includes(id);
            const b = ruleSeal(id);
            b.classList.toggle('off', !got);
            b.setAttribute('aria-hidden', 'false');
            b.setAttribute('role', 'img');
            b.setAttribute('aria-label', t(got ? 'lb.badgeAria' : 'lb.badgeAriaNot', { name: challengeName(id) }));
            b.title = t(got ? 'lb.badgeTitleEarned' : 'lb.badgeTitle', { name: challengeName(id), desc: challengeDesc(id) });
            badges.append(b);
          }
          const rec = endlessRecordText(p.bestEndlessWaves[i] ?? 0, lvl.waves.length);
          const endless = el(
            'span',
            `pu-rec pu-ledger-endless pu-ink${rec.tier > 0 ? '' : ' none'}`,
            { title: rec.tierName ? t('lb.endlessTitleMedal', { best: rec.best, tier: rec.tierName }) : t('lb.endlessTitle', { best: rec.best }), 'data-testid': `lb2d-endless-${lvl.id}` },
            glyph('endless'),
            (p.bestEndlessWaves[i] ?? 0) > lvl.waves.length ? t('lb.waveShort', { n: p.bestEndlessWaves[i] }) : '–',
          );
          if (rec.tier > 0) endless.style.setProperty('--tier', tierColour(rec.tier));
          row.append(
            num,
            el('span', 'pu-ledger-name pu-ink', {}, islandName(lvl), el('small', 'pu-ink-soft', {}, difficultyName(lvl.difficulty))),
            el(
              'span',
              `pu-ledger-stars`,
              {},
              starsRow(p.bestStars[i] ?? 0),
              // The Hard ribbon: lit once the isle was won on Hard.
              el(
                'span',
                `pu-ledger-hard${(dw.hard[i] ?? 0) > 0 ? '' : ' off'}`,
                { role: 'img', 'aria-label': (dw.hard[i] ?? 0) > 0 ? t('diff.hardRibbon') : t('diff.notWon', { d: t('diff.hard') }), title: (dw.hard[i] ?? 0) > 0 ? t('diff.hardRibbon') : t('diff.notWon', { d: t('diff.hard') }), 'data-testid': `lb2d-hard-${lvl.id}` },
                difficultySeal('hard'),
              ),
            ),
            badges,
            endless,
            el('span', 'pu-rec pu-ink', { title: t('lb.bestLives') }, glyph('heart'), lives > 0 ? String(lives) : '–'),
            el('span', 'pu-ink-soft', { title: t('lb.victoriesTitle') }, w > 0 ? t('lb.wins', { n: w }) : t('lb.notWon')),
          );
        }
        list.append(row);
      });
    } else {
      for (const f of feats) {
        const isNew = f.earned && fresh.has(f.def.id);
        const pct = Math.round((Math.min(f.current, f.target) / Math.max(1, f.target)) * 100);
        const bar = el('div', 'pu-bar', {}, el('i'), el('span', 'pu-letter', {}, `${Math.min(f.current, f.target)}/${f.target}`));
        (bar.firstChild as HTMLElement).style.setProperty('--p', `${pct}%`);
        list.append(
          el(
            'div',
            `pu-feat${f.earned ? '' : ' locked'}${isNew ? ' new' : ''}`,
            { 'data-testid': `lb2d-feat-${f.def.id}` },
            seal(f.def.icon),
            el(
              'div',
              '',
              {},
              el('div', 'pu-feat-name pu-ink', {}, featName(f.def), isNew ? el('span', 'pu-feat-new pu-letter', {}, t('lb.featNew')) : null),
              el('div', 'pu-feat-desc pu-ink-soft', {}, featDesc(f.def)),
            ),
            bar,
          ),
        );
      }
    }
    const foot = el(
      'div',
      'pu-meta-foot pu-ink-soft',
      {},
      view === 'feats'
        ? earned === 0
          ? t('lb.featsEmpty')
          : t('lb.featsFoot', { n: earned, total: feats.length })
        : wins === 0
          ? t('lb.empty')
          : t('lb.cleared', { n: cleared, total: levels.length }),
    );
    sheet.body.append(totals, tabs, list, foot);
  };
  render();
  return sheet;
}

// --- Daily Squall --------------------------------------------------------------------------------

/** Round seal for a challenge rule: the painted `seal-<challenge ID>` (its own backing included). */
export function ruleSeal(id: ChallengeId): HTMLSpanElement {
  return sealBadge(id);
}

/** Today's Daily over the 2D isles (null until one island is won). */
export function dailyFor2D(progress: ProgressData, nowMs: number, levels: readonly LevelDef[] = LEVELS_2D): DailyChallenge | null {
  return dailyForToday(nowMs, progress, levels);
}

export function openDaily(ctx: MetaContext, nowMs = Date.now()): Sheet {
  const sheet = openSheet(t('daily.title'), { cls: 'pu-meta', red: true, testid: 'daily2d' });
  const p = ctx.progress;
  const daily = dailyFor2D(p, nowMs, ctx.levels);
  if (!daily) {
    sheet.body.append(
      el('div', 'pu-daily-island', {}, seal('daily'), el('div', 'pu-ink', {}, t('daily.gathering'))),
      el('p', 'pu-meta-note pu-ink-soft', {}, t('daily.lockedNote')),
    );
    return sheet;
  }
  const level = ctx.levels[daily.levelIndex];
  const doneToday = p.daily.lastDay === daily.day;
  const streak = liveStreak(p.daily, daily.day);
  const day = shortDate(daily.day);
  const left = el(
    'div',
    '',
    {},
    el('div', 'pu-daily-island', {}, medal(ctx.thumb(level), 'calc(var(--s) * 8)'), el('div', '', {}, el('div', 'pu-ink', {}, islandName(level)), el('div', 'pu-ink-soft', {}, t('daily.meta', { difficulty: difficultyName(level.difficulty), day })))),
    el(
      'div',
      'pu-chips',
      {},
      el('div', 'pu-chip pu-ink', {}, el('strong', '', {}, doneToday ? '✓' : '+1★'), el('span', 'pu-ink-soft', {}, doneToday ? t('daily.wonToday') : t('daily.reward'))),
      el('div', 'pu-chip pu-ink', {}, el('strong', '', {}, String(streak)), el('span', 'pu-ink-soft', {}, t('daily.streak'))),
      el('div', 'pu-chip pu-ink', {}, el('strong', '', {}, String(p.daily.bestStreak)), el('span', 'pu-ink-soft', {}, t('daily.bestStreak'))),
      el('div', 'pu-chip pu-ink', {}, el('strong', '', {}, String(p.daily.total)), el('span', 'pu-ink-soft', {}, t('daily.won'))),
    ),
  );
  const rules = el('div', '');
  for (const id of daily.challenges) {
    rules.append(el('div', 'pu-rule', {}, ruleSeal(id), el('div', 'pu-ink', {}, challengeName(id), el('small', 'pu-ink-soft', {}, challengeDesc(id)))));
  }
  const start = plank(t('daily.setSail'), {
    kind: 'primary',
    icon: 'play',
    testid: 'daily2d-start',
    sub: doneToday ? t('daily.noReward') : t('daily.winOnce'),
  });
  start.addEventListener('click', () => {
    sheet.close();
    navigateWithVeil(dailyHref2D(level.id));
  });
  sheet.body.append(el('div', 'pu-daily-grid', {}, left, el('div', '', {}, rules)), el('div', 'pu-brief-actions', {}, start));
  return sheet;
}

// --- Settings ------------------------------------------------------------------------------------

/**
 * Language switch: one plank per language, each in its own name. Picking one stores it with the
 * settings and reloads the map with Settings open again (every screen is rebuilt in the new
 * language; the map's screens are built once, so a reload is the simplest correct refresh).
 */
function languagePicker(ctx: SettingsContext): HTMLElement {
  const box = el('div', 'pu-tabs pu-lang', { role: 'radiogroup', 'aria-label': t('set.language') });
  const cur = getLocale();
  for (const l of LOCALES) {
    const b = plank(LANGUAGE_NAMES[l], { kind: 'small', testid: `set2d-lang-${l}` });
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(l === cur));
    b.setAttribute('aria-selected', String(l === cur));
    b.setAttribute('lang', l);
    b.addEventListener('click', () => switchLocale(l, ctx));
    box.append(b);
  }
  return box;
}

function switchLocale(l: Locale, ctx: SettingsContext): void {
  saveLocaleSetting(l);
  if (l === getLocale()) return;
  setLocale(l);
  ctx.onChange();
  if (ctx.reloadTo) {
    location.assign(`${location.pathname}${ctx.reloadTo}`);
    return;
  }
  const q = new URLSearchParams(location.search);
  q.delete('lang');
  // In a run the island reloads (in the new language) with Settings open again.
  q.set(ctx.inGame ? 'settings' : 'screen', ctx.inGame ? '1' : 'settings');
  location.assign(`${location.pathname}?${q.toString()}`);
}

/**
 * What Settings needs: the island list (store row) and a change callback. `inGame` = opened over a
 * run (the HUD button / pause plate): no progress reset or store rows, and a language change
 * restarts the island (noted under the picker). `tab` = the section to open on (default General;
 * `?settab=` picks it for QA).
 */
export interface SettingsContext {
  readonly levels: readonly LevelDef[];
  onChange(): void;
  readonly inGame?: boolean;
  readonly onClose?: () => void;
  readonly tab?: SettingsTab;
  /** Query to reload with after a language switch (default: the map / the run with Settings open). */
  readonly reloadTo?: string;
}

export const SETTINGS_TABS = ['general', 'audio', 'graphics', 'controls'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

const TAB_LABEL: Readonly<Record<SettingsTab, MsgKey>> = {
  general: 'set.tabGeneral',
  audio: 'set.tabAudio',
  graphics: 'set.tabGraphics',
  controls: 'set.tabControls',
};

function isSettingsTab(v: unknown): v is SettingsTab {
  return typeof v === 'string' && (SETTINGS_TABS as readonly string[]).includes(v);
}

/**
 * A row of small planks, one checked (the language picker's look): Quality, Effects, FPS cap.
 * Picking one re-checks the row and calls `onPick`.
 */
function choice<T extends string | number>(options: readonly (readonly [T, string])[], current: T, aria: string, testid: string, onPick: (v: T) => void): HTMLElement {
  const box = el('div', 'pu-tabs pu-lang pu-choice', { role: 'radiogroup', 'aria-label': aria, 'data-testid': testid });
  const buttons: HTMLButtonElement[] = [];
  const mark = (v: T): void =>
    options.forEach(([o], i) => {
      buttons[i].setAttribute('aria-checked', String(o === v));
      buttons[i].setAttribute('aria-selected', String(o === v));
    });
  for (const [v, label] of options) {
    const b = plank(label, { kind: 'small', testid: `${testid}-${v}` });
    b.setAttribute('role', 'radio');
    b.addEventListener('click', () => {
      mark(v);
      onPick(v);
    });
    buttons.push(b);
    box.append(b);
  }
  mark(current);
  return box;
}

/** A painted key cap (Controls). */
function keyCap(label: string): HTMLElement {
  return el('kbd', 'pu-key pu-letter', {}, label);
}

/** A controller button cap: `face` A / B / X / Y round and coloured, the rest a dark pill. */
function padCap(label: string): HTMLElement {
  const face = ['A', 'B', 'X', 'Y'].includes(label);
  return el('kbd', `pu-key pu-letter pad${face ? ` face pad-${label.toLowerCase()}` : ''}`, {}, label);
}

function fullscreenSupported(): boolean {
  return typeof document !== 'undefined' && document.fullscreenEnabled === true && typeof document.documentElement.requestFullscreen === 'function';
}

export function openSettings(ctx: SettingsContext): Sheet {
  const sheet = openSheet(t('set.title'), { cls: `pu-meta pu-settings tabbed${ctx.inGame ? ' pu-settings-ingame' : ''}`, testid: 'settings2d', onClose: ctx.onClose });
  const s: GameSettings = loadSettings();
  const g: GraphicsSettings = loadGraphics();
  const desktop = isDesktopClient(new URLSearchParams(location.search));
  const touch = isTouchDevice();
  const save = (): void => {
    saveSettings(s);
    // saveSettings() drops fields it does not know: put the language and graphics back next to them.
    reapplyLocaleSetting();
    reapplyGraphicsSettings();
  };
  const saveGfx = (): void => {
    saveGraphics(g);
    announceGraphicsChange();
  };
  const row = (label: string, sub: string | null, control: HTMLElement, testid?: string): HTMLElement =>
    el('div', 'pu-set-row', { 'data-testid': testid }, el('div', 'pu-ink', {}, label, sub ? el('small', 'pu-ink-soft', {}, sub) : null), control);
  const flex = (...kids: HTMLElement[]): HTMLElement => {
    const b = el('div', 'pu-set-flex', {}, ...kids);
    return b;
  };

  // --- General ---------------------------------------------------------------------------------
  const general = (): HTMLElement[] => {
    let armed = 0;
    const reset = plank(t('set.reset'), { kind: 'small', testid: 'set2d-reset' });
    reset.addEventListener('click', () => {
      if (performance.now() < armed) {
        resetProgress2D();
        armed = 0;
        reset.querySelector('span')!.textContent = t('set.resetDone');
        reset.disabled = true;
        ctx.onChange();
        return;
      }
      armed = performance.now() + 3200;
      reset.querySelector('span')!.textContent = t('set.resetArmed');
      window.setTimeout(() => {
        if (!reset.disabled) reset.querySelector('span')!.textContent = t('set.reset');
      }, 3300);
    });
    // Interface size 90–130 %: the whole painted UI and the battle HUD follow (live).
    const sizeVal = el('span', 'pu-slider-val pu-ink', {}, pct(g.uiScale));
    const size = slider((g.uiScale - UI_SCALE_MIN) / (UI_SCALE_MAX - UI_SCALE_MIN), t('set.uiScale'), 'set2d-uiscale', (v) => {
      const k = clampUiScale(UI_SCALE_MIN + v * (UI_SCALE_MAX - UI_SCALE_MIN));
      if (k === g.uiScale) return;
      g.uiScale = k;
      sizeVal.textContent = pct(k);
      saveGfx();
    });
    const rows = [
      row(t('set.language'), ctx.inGame ? t('set.languageNoteInGame') : t('set.languageNote'), languagePicker(ctx)),
      row(t('set.uiScale'), t('set.uiScaleNote'), flex(size, sizeVal), 'set2d-uiscale-row'),
      row(
        t('set.dmg'),
        t('set.dmgNote'),
        toggle(s.damageNumbers, t('set.dmg'), 'set2d-dmg', (v) => {
          s.damageNumbers = v;
          save();
        }),
      ),
      row(
        t('set.haptics'),
        t('set.hapticsNote'),
        toggle(s.haptics, t('set.haptics'), 'set2d-haptics', (v) => {
          s.haptics = v;
          save();
        }),
      ),
    ];
    // First-play tips and new-foe notes come back (coach on the first island, New tags, toasts).
    const tips = plank(t('set.tipsAgain'), { kind: 'small', testid: 'set2d-tips' });
    tips.addEventListener('click', () => {
      try {
        localStorage.removeItem('skyhold2d_coach_v1'); // i18n-ignore (storage key)
        localStorage.removeItem('skyhold2d_foes_seen_v1'); // i18n-ignore (storage key)
      } catch {
        // private mode: nothing stored anyway
      }
      tips.querySelector('span')!.textContent = t('set.tipsAgainDone');
      tips.disabled = true;
    });
    rows.push(row(t('set.tips'), t('set.tipsNote'), tips));
    const credits = plank(t('set.creditsOpen'), { kind: 'small', testid: 'set2d-credits' });
    credits.addEventListener('click', () => openCredits(() => credits.focus({ preventScroll: true })));
    rows.push(row(t('credits.title'), t('set.creditsNote'), credits));
    if (ctx.inGame) return rows;
    // Mobile builds only: the store (Buy / Restore purchases must stay reachable after a purchase).
    if (storeEnabled()) {
      const shop = plank(t('set.storeOpen'), { kind: 'small', testid: 'set2d-store' });
      shop.addEventListener('click', () => openStore({ totalIslands: ctx.levels.length, onOwnedChange: () => ctx.onChange() }));
      rows.push(row(t('set.store'), ownsFullAdventure() ? t('set.storeOwned') : t('set.storeNote'), shop));
    }
    rows.push(row(t('set.progress'), t('set.progressNote'), reset));
    return rows;
  };

  // --- Audio -----------------------------------------------------------------------------------
  // The mixer (render2d/audio2d.ts) re-reads these settings after every click / key / slider drag,
  // so a change is heard at once (music on the map, the battle in a run).
  const audio = (): HTMLElement[] => {
    const mixRows: HTMLElement[] = [];
    const dimWhenMuted = (): void => {
      for (const r of mixRows) r.classList.toggle('off', s.muted);
    };
    const val = el('span', 'pu-slider-val pu-ink', {}, pct(s.masterVolume));
    const vol = slider(s.masterVolume, t('set.volumeAria'), 'set2d-volume', (v) => {
      s.masterVolume = Math.round(v * 100) / 100;
      val.textContent = pct(s.masterVolume);
      save();
    });
    const musicVal = el('span', 'pu-slider-val pu-ink', {}, pct(getMusicVolume()));
    const music = slider(getMusicVolume(), t('set.musicAria'), 'set2d-music', (v) => {
      setMusicVolume(Math.round(v * 100) / 100);
      musicVal.textContent = pct(getMusicVolume());
    });
    const volRow = row(t('set.volume'), t('set.volumeNote'), flex(vol, val));
    const musicRow = row(t('set.music'), t('set.musicNote'), flex(music, musicVal));
    mixRows.push(volRow, musicRow);
    dimWhenMuted();
    return [
      row(
        t('set.sound'),
        t('set.soundNote'),
        toggle(!s.muted, t('set.soundAria'), 'set2d-sound', (v) => {
          s.muted = !v;
          save();
          dimWhenMuted();
        }),
      ),
      volRow,
      musicRow,
    ];
  };

  // --- Graphics --------------------------------------------------------------------------------
  const graphics = (): HTMLElement[] => {
    const rows: HTMLElement[] = [];
    const quality = choice<GameSettings['quality']>(
      [
        ['auto', t('set.qAuto')],
        ['low', t('set.qLow')],
        ['medium', t('set.qMedium')],
        ['high', t('set.qHigh')],
      ],
      s.quality,
      t('set.quality'),
      'set2d-quality',
      (v) => {
        s.quality = v;
        save();
        announceGraphicsChange();
      },
    );
    rows.push(row(t('set.quality'), t('set.qualityNote'), quality));
    if (desktop) {
      // Render resolution: Auto (full) or 50–100 % of it.
      const shown = (): string => (g.renderScale === null ? t('set.qAuto') : pct(g.renderScale));
      const resVal = el('span', 'pu-slider-val pu-ink', {}, shown());
      const auto = plank(t('set.qAuto'), { kind: 'small', testid: 'set2d-res-auto' });
      auto.setAttribute('role', 'switch');
      const res = slider(((g.renderScale ?? 1) - 0.5) / 0.5, t('set.resolutionAria'), 'set2d-res', (v) => {
        g.renderScale = Math.round((0.5 + v * 0.5) * 20) / 20;
        paintRes();
        saveGfx();
      });
      const paintRes = (): void => {
        resVal.textContent = shown();
        auto.setAttribute('aria-checked', String(g.renderScale === null));
        auto.setAttribute('aria-selected', String(g.renderScale === null));
        res.classList.toggle('auto', g.renderScale === null);
      };
      auto.addEventListener('click', () => {
        g.renderScale = g.renderScale === null ? 1 : null;
        paintRes();
        saveGfx();
      });
      paintRes();
      const box = flex(el('div', 'pu-tabs pu-lang pu-choice', {}, auto), res, resVal);
      rows.push(row(t('set.resolution'), t('set.resolutionNote'), box, 'set2d-res-row'));
    }
    rows.push(
      row(
        t('set.effects'),
        t('set.effectsNote'),
        choice<EffectsDensity>(
          [
            ['low', t('set.fxLow')],
            ['normal', t('set.fxNormal')],
            ['high', t('set.fxHigh')],
          ],
          g.effects,
          t('set.effects'),
          'set2d-effects',
          (v) => {
            g.effects = v;
            saveGfx();
          },
        ),
      ),
      row(
        t('set.fpsCap'),
        t('set.fpsCapNote'),
        choice<FpsCap>(
          [
            [30, '30'],
            [60, '60'],
            [0, t('set.fpsUnlimited')],
          ],
          g.fpsCap,
          t('set.fpsCap'),
          'set2d-fpscap',
          (v) => {
            g.fpsCap = v;
            saveGfx();
          },
        ),
      ),
      row(
        t('set.fpsCounter'),
        t('set.fpsCounterNote'),
        toggle(g.showFps, t('set.fpsCounter'), 'set2d-fps', (v) => {
          g.showFps = v;
          saveGfx();
        }),
      ),
    );
    const shakeNote = el('small', 'pu-ink-soft', {}, g.reducedMotion ? t('set.shakeOffByMotion') : t('set.shakeNote'));
    const shakeRow = el(
      'div',
      'pu-set-row',
      {},
      el('div', 'pu-ink', {}, t('set.shake'), shakeNote),
      toggle(s.cameraShake, t('set.shake'), 'set2d-shake', (v) => {
        s.cameraShake = v;
        save();
        announceGraphicsChange();
      }),
    );
    const paintMotion = (): void => {
      shakeRow.classList.toggle('off', g.reducedMotion);
      shakeNote.textContent = g.reducedMotion ? t('set.shakeOffByMotion') : t('set.shakeNote');
    };
    paintMotion();
    rows.push(
      row(
        t('set.reducedMotion'),
        t('set.reducedMotionNote'),
        toggle(g.reducedMotion, t('set.reducedMotion'), 'set2d-motion', (v) => {
          g.reducedMotion = v;
          paintMotion();
          saveGfx();
        }),
      ),
      shakeRow,
    );
    if (desktop && fullscreenSupported()) {
      const fs = toggle(!!document.fullscreenElement, t('set.fullscreen'), 'set2d-fullscreen', (v) => {
        const done = v ? document.documentElement.requestFullscreen() : document.exitFullscreen();
        void done.catch(() => fs.setAttribute('aria-checked', String(!!document.fullscreenElement)));
      });
      const sync = (): void => {
        if (!fs.isConnected) {
          document.removeEventListener('fullscreenchange', sync);
          return;
        }
        fs.setAttribute('aria-checked', String(!!document.fullscreenElement));
      };
      document.addEventListener('fullscreenchange', sync);
      rows.push(row(t('set.fullscreen'), t('set.fullscreenNote'), fs));
    }
    return rows;
  };

  // --- Controls --------------------------------------------------------------------------------
  const controls = (): HTMLElement[] => {
    const keyRow = (caps: readonly string[], what: string): HTMLElement => el('div', 'pu-key-row', {}, el('span', 'pu-key-caps', {}, ...caps.map(keyCap)), el('span', 'pu-ink', {}, what));
    // Controller caps: round face buttons (A / B / X / Y in their usual colours), pill shoulders.
    const padRow = (caps: readonly string[], what: string): HTMLElement => el('div', 'pu-key-row', {}, el('span', 'pu-key-caps', {}, ...caps.map(padCap)), el('span', 'pu-ink', {}, what));
    const section = (title: string, ...items: HTMLElement[]): HTMLElement => el('section', 'pu-key-section', {}, el('h3', 'pu-letter', {}, title), el('div', 'pu-key-list', {}, ...items));
    const out: HTMLElement[] = [];
    if (touch) out.push(section(t('set.touch'), el('div', 'pu-key-row pu-ink', {}, t('touch.build')), el('div', 'pu-key-row pu-ink', {}, t('touch.hero')), el('div', 'pu-key-row pu-ink', {}, t('touch.ability')), el('div', 'pu-key-row pu-ink', {}, t('touch.cancel')), el('div', 'pu-key-row pu-ink', {}, t('touch.pan'))));
    out.push(
      section(
        t('set.keyboard'),
        keyRow([t('key.space')], t('key.pause')),
        keyRow(['1'], t('key.speed1')),
        keyRow(['2'], t('key.speed2')),
        keyRow(['3'], t('key.speed3')),
        keyRow(['N'], t('key.wave')),
        keyRow([ABILITY_KEYS.meteor], t('key.meteor')),
        keyRow([ABILITY_KEYS.overcharge], t('key.overcharge')),
        keyRow([HERO_KEYS.select], t('key.heroSelect')),
        keyRow([HERO_KEYS.skill0], t('key.heroSkill1')),
        keyRow([HERO_KEYS.skill1], t('key.heroSkill2')),
        keyRow([t('key.esc')], t('key.cancel')),
        keyRow(['↑', '↓', '←', '→'], t('key.cursor')),
        keyRow([t('key.enter')], t('key.cursorPress')),
        keyRow([t('key.shift'), '↑', '↓', '←', '→'], t('key.pan')),
      ),
      // Mouse + replay under the keyboard list, menus and the controller in the second column.
      ...(!touch || desktop ? [section(t('set.mouse'), keyRow([t('key.rightClick')], t('key.cancelAim')), keyRow([t('key.rightClick')], t('key.heroMove')), keyRow([t('key.drag')], t('key.pan')), keyRow([t('key.scroll')], t('key.pan')))] : []),
      section(t('set.replayKeys'), keyRow([t('key.space')], t('key.pause')), keyRow(['1', '2', '4'], t('key.replaySpeed')), keyRow([t('key.esc')], t('key.replayLeave'))),
      section(
        t('set.menuKeys'),
        keyRow(['↑', '↓', '←', '→'], t('key.navMove')),
        keyRow(['W', 'A', 'S', 'D'], t('key.navMove')),
        keyRow([t('key.enter'), t('key.space')], t('key.navPress')),
        keyRow([t('key.esc')], t('key.navBack')),
      ),
      section(
        t('set.gamepad'),
        padRow([t('pad.dpad'), t('pad.stick')], t('key.navMove')),
        padRow(['A'], t('key.navPress')),
        padRow(['B'], t('key.navBack')),
        padRow(['LB', 'RB'], t('key.navTabs')),
        padRow([t('pad.start')], t('key.pause')),
      ),
      section(
        t('set.gamepadRun'),
        padRow([t('pad.dpad'), t('pad.stick')], t('key.cursor')),
        padRow(['A'], t('key.cursorPress')),
        padRow(['B'], t('key.navBack')),
        padRow(['X'], t('key.wave')),
        padRow(['Y'], t('key.heroSelect')),
        padRow(['LB'], t('key.meteor')),
        padRow(['RB'], t('key.overcharge')),
        padRow(['LT'], t('key.heroSkill1')),
        padRow(['RT'], t('key.heroSkill2')),
        padRow([t('pad.start')], t('key.pause')),
      ),
    );
    return [el('div', 'pu-key-grid', {}, ...out)];
  };

  // --- tabs ------------------------------------------------------------------------------------
  const build: Readonly<Record<SettingsTab, () => HTMLElement[]>> = { general, audio, graphics, controls };
  const fromQuery = new URLSearchParams(location.search).get('settab');
  let tab: SettingsTab = ctx.tab ?? (isSettingsTab(fromQuery) ? fromQuery : 'general');
  const tabs = el('div', 'pu-tabs pu-set-tabs', { role: 'tablist', 'data-testid': 'set2d-tabs' });
  const tabButtons = SETTINGS_TABS.map((id) => {
    const b = plank(t(TAB_LABEL[id]), { kind: 'small', testid: `set2d-tab-${id}` });
    b.setAttribute('role', 'tab');
    b.addEventListener('click', () => show(id));
    tabs.append(b);
    return b;
  });
  sheet.sheet.insertBefore(tabs, sheet.body);
  const show = (id: SettingsTab): void => {
    tab = id;
    SETTINGS_TABS.forEach((x, i) => tabButtons[i].setAttribute('aria-selected', String(x === id)));
    sheet.body.innerHTML = '';
    sheet.body.dataset.tab = id;
    sheet.body.scrollTop = 0;
    sheet.body.append(...build[id]());
  };
  show(tab);
  return sheet;
}
