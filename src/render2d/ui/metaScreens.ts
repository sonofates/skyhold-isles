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
import { isIslandMastered, starWallet } from '../../game/progression.ts';
import { loadSettings, saveSettings } from '../../platform/storage.ts';
import { branchName, challengeDesc, challengeName, difficultyName, featDesc, featName, islandName, upgradeName, upgradeRankText } from '../../i18n/data.ts';
import { getLocale, LANGUAGE_NAMES, LOCALES, pct, setLocale, shortDate, t, type Locale } from '../../i18n/index.ts';
import { reapplyLocaleSetting, saveLocaleSetting } from '../../i18n/localeSetting.ts';
import { el, glyph, img, KIT, medal, openSheet, plank, sealBadge, slider, starsRow, toggle, type Sheet } from './dom.ts';
import { endlessRecordText, tierColour } from './modeBits.ts';
import { dailyForToday, dailyHref2D } from './modes2d.ts';
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

export function openLogbook(ctx: MetaContext, tab: 'islands' | 'feats' = 'islands'): Sheet {
  const sheet = openSheet(t('lb.title'), { cls: 'pu-meta', testid: 'logbook2d' });
  const render = (): void => {
    const p = ctx.progress;
    const levels = ctx.levels;
    const wallet = starWallet(p);
    let badges = 0;
    let badgesMax = 0;
    let mastered = 0;
    let cleared = 0;
    let wins = 0;
    let medals = 0;
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
    const totals = el(
      'div',
      'pu-lb-totals',
      {},
      total('star', `${wallet.campaign}/${levels.length * 3}`, t('lb.stars')),
      total('medal', `${badges}/${badgesMax}`, t('lb.badges')),
      total('crown', `${mastered}/${levels.length}`, t('lb.mastered')),
      total('trophy', String(wins), t('lb.victories')),
      total('daily', String(liveStreak(p.daily, utcDayNumber(Date.now()))), t('lb.streak', { n: p.daily.bestStreak })),
      total('endless', `${medals}/${levels.length * 3}`, t('lb.medals')),
    );
    const feats = featStatuses(p, levels);
    const earned = feats.filter((f) => f.earned).length;
    const tabs = el('div', 'pu-tabs', { role: 'tablist' });
    const mk = (id: 'islands' | 'feats', label: string): void => {
      const b = plank(label, { kind: 'small', testid: `lb2d-tab-${id}` });
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(tab === id));
      b.addEventListener('click', () => {
        tab = id;
        render();
      });
      tabs.append(b);
    };
    mk('islands', t('lb.tabIslands'));
    mk('feats', t('lb.tabFeats', { e: earned, n: feats.length }));
    const list = el('div', 'pu-ledger');
    if (tab === 'islands') {
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
            starsRow(p.bestStars[i] ?? 0),
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
        const pct = Math.round((Math.min(f.current, f.target) / Math.max(1, f.target)) * 100);
        const bar = el('div', 'pu-bar', {}, el('i'), el('span', 'pu-letter', {}, `${Math.min(f.current, f.target)}/${f.target}`));
        (bar.firstChild as HTMLElement).style.setProperty('--p', `${pct}%`);
        list.append(
          el(
            'div',
            `pu-feat${f.earned ? '' : ' locked'}`,
            {},
            seal(f.def.icon),
            el('div', '', {}, el('div', 'pu-feat-name pu-ink', {}, featName(f.def)), el('div', 'pu-feat-desc pu-ink-soft', {}, featDesc(f.def))),
            bar,
          ),
        );
      }
    }
    const foot = el(
      'div',
      'pu-meta-foot pu-ink-soft',
      {},
      tab === 'feats'
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
    location.assign(dailyHref2D(level.id));
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
  const q = new URLSearchParams(location.search);
  q.delete('lang');
  // In a run the island reloads (in the new language) with Settings open again.
  q.set(ctx.inGame ? 'settings' : 'screen', ctx.inGame ? '1' : 'settings');
  location.assign(`${location.pathname}?${q.toString()}`);
}

/**
 * What Settings needs: the island list (store row) and a change callback. `inGame` = opened over a
 * run (the HUD button / pause plate): no progress reset or store rows, and a language change
 * restarts the island (noted under the picker).
 */
export interface SettingsContext {
  readonly levels: readonly LevelDef[];
  onChange(): void;
  readonly inGame?: boolean;
  readonly onClose?: () => void;
}

export function openSettings(ctx: SettingsContext): Sheet {
  const sheet = openSheet(t('set.title'), { cls: `pu-meta pu-settings${ctx.inGame ? ' pu-settings-ingame' : ''}`, testid: 'settings2d', onClose: ctx.onClose });
  const s: GameSettings = loadSettings();
  const save = (): void => {
    saveSettings(s);
    // saveSettings() drops fields it does not know: put the language back next to them.
    reapplyLocaleSetting();
  };
  const row = (label: string, sub: string | null, control: HTMLElement): HTMLElement =>
    el('div', 'pu-set-row', {}, el('div', 'pu-ink', {}, label, sub ? el('small', 'pu-ink-soft', {}, sub) : null), control);
  // Sound: the mixer (render2d/audio2d.ts) re-reads these settings after every click / key /
  // slider drag, so a change is heard at once (music on the map, the battle in a run).
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
  const musicBox = el('div', '', {}, music, musicVal);
  musicBox.style.cssText = 'display:flex;align-items:center;gap:calc(var(--s) * 1)';
  const volBox = el('div', '', {}, vol, val);
  volBox.style.cssText = 'display:flex;align-items:center;gap:calc(var(--s) * 1)';
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
  const volRow = row(t('set.volume'), t('set.volumeNote'), volBox);
  const musicRow = row(t('set.music'), t('set.musicNote'), musicBox);
  mixRows.push(volRow, musicRow);
  dimWhenMuted();
  sheet.body.append(
    row(t('set.language'), ctx.inGame ? t('set.languageNoteInGame') : t('set.languageNote'), languagePicker(ctx)),
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
    row(
      t('set.shake'),
      t('set.shakeNote'),
      toggle(s.cameraShake, t('set.shake'), 'set2d-shake', (v) => {
        s.cameraShake = v;
        save();
      }),
    ),
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
  );
  if (ctx.inGame) return sheet;
  // Mobile builds only: the store (Buy / Restore purchases must stay reachable after a purchase).
  if (storeEnabled()) {
    const shop = plank(t('set.storeOpen'), { kind: 'small', testid: 'set2d-store' });
    shop.addEventListener('click', () => openStore({ totalIslands: ctx.levels.length, onOwnedChange: () => ctx.onChange() }));
    sheet.body.append(row(t('set.store'), ownsFullAdventure() ? t('set.storeOwned') : t('set.storeNote'), shop));
  }
  sheet.body.append(row(t('set.progress'), t('set.progressNote'), reset));
  return sheet;
}
