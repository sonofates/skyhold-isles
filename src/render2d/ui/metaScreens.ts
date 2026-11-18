/**
 * Painted 2D views of the meta screens — Workshop, Logbook, Daily Squall, Settings — on top of the
 * 3D build's logic modules (src/data/workshop, src/game/progression + feats, src/data/daily,
 * src/platform/storage settings). Only the views are new; every rule comes from those modules.
 */
import type { GameSettings, ProgressData } from '../../core/types.ts';
import { CHALLENGES, challengesForLevel, type ChallengeId } from '../../data/challenges.ts';
import { liveStreak, utcDayNumber, type DailyChallenge } from '../../data/daily.ts';
import { endlessTier } from '../../data/endlessMutators.ts';
import { LEVELS_2D } from '../../data/levels2d/index.ts';
import type { LevelDef } from '../../data/levels/types.ts';
import { buyRank, maxRank, nextRankCost, rankOf, WORKSHOP_BRANCHES, WORKSHOP_UPGRADES, workshopTotalCost, type WorkshopUpgradeDef } from '../../data/workshop.ts';
import { featStatuses, type FeatIcon } from '../../game/feats.ts';
import { isIslandMastered, starWallet } from '../../game/progression.ts';
import { loadSettings, saveSettings } from '../../platform/storage.ts';
import { ART, el, glyph, img, KIT, medal, openSheet, plank, slider, starsRow, toggle, type Sheet } from './dom.ts';
import { endlessRecordText, tierColour } from './modeBits.ts';
import { dailyForToday, dailyHref2D } from './modes2d.ts';
import type { IconName } from './paintedIcons.ts';
import { resetProgress2D, saveProgress2D } from './progress2d.ts';

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
  const sheet = openSheet('Workshop', { cls: 'pu-meta', testid: 'workshop2d' });
  let lastBought: string | null = null;
  let armedUntil = 0;
  const render = (): void => {
    const p = ctx.progress;
    const wallet = starWallet(p);
    sheet.body.innerHTML = '';
    const refund = plank(performance.now() < armedUntil ? `Tap again · refund ${wallet.spent}★` : 'Refund all', { kind: 'small', testid: 'ws2d-refund' });
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
    const head = el('div', 'pu-meta-head', {}, tally(wallet.available, 'to spend'), el('div', 'pu-meta-note pu-ink-soft', {}, 'Spend stars on lasting upgrades. Refund any time.'), refund);
    const cols = el('div', 'pu-ws-cols');
    for (const branch of WORKSHOP_BRANCHES) {
      const col = el('section', 'pu-ws-col', {}, el('h3', 'pu-letter', {}, branch.name));
      for (const def of WORKSHOP_UPGRADES) if (def.branch === branch.id) col.append(node(def, wallet.available));
      cols.append(col);
    }
    const foot = el(
      'div',
      'pu-meta-foot pu-ink-soft',
      {},
      wallet.earned === 0 ? 'Win islands to earn stars: up to 3★ each, challenges and dailies add more.' : `${wallet.spent}/${workshopTotalCost()}★ invested · ${wallet.earned}★ earned`,
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
    const now = rank > 0 ? def.rankText[rank - 1] : 'Not built';
    const effect = el('div', 'pu-ws-effect pu-ink-soft', {}, now);
    if (rank < max) effect.append(' → ', el('span', 'next', {}, def.rankText[rank]));
    const pips = el('span', 'pu-pips', { 'aria-label': `Rank ${rank} of ${max}` });
    for (let i = 0; i < max; i++) pips.append(el('span', `pu-pip${i < rank ? ' on' : ''}`));
    let buy: HTMLButtonElement;
    if (cost === null) {
      buy = plank('Max', { kind: 'small', testid: `ws2d-buy-${def.id}` });
      buy.disabled = true;
    } else {
      buy = plank(String(cost), { kind: 'small', testid: `ws2d-buy-${def.id}` });
      buy.prepend(img(KIT.star));
      (buy.firstChild as HTMLImageElement).style.cssText = 'width:1.2em;height:1.2em';
      buy.disabled = cost > available;
      buy.setAttribute('aria-label', `Upgrade ${def.name} for ${cost} stars`);
      buy.addEventListener('click', () => {
        const next = buyRank(p.workshop, def.id, starWallet(p).available);
        if (!next) return;
        p.workshop = next;
        lastBought = def.id;
        commit();
      });
    }
    n.append(el('div', 'pu-ws-name', {}, def.name), effect, el('div', 'pu-ws-row', {}, pips, buy));
    return n;
  };
  render();
  return sheet;
}

// --- Logbook -------------------------------------------------------------------------------------

const FEAT_ICON: Record<FeatIcon, IconName | 'star'> = {
  star: 'star',
  islands: 'islands',
  medal: 'medal',
  crown: 'crown',
  endless: 'endless',
  daily: 'daily',
  trophy: 'trophy',
};

function seal(icon: IconName | 'star'): HTMLSpanElement {
  const s = el('span', 'pu-round', { 'aria-hidden': 'true' });
  if (icon === 'star') {
    const i = img(KIT.star);
    i.style.cssText = 'width:58%;height:58%';
    s.append(i);
  } else s.append(glyph(icon));
  return s;
}

export function openLogbook(ctx: MetaContext, tab: 'islands' | 'feats' = 'islands'): Sheet {
  const sheet = openSheet('Logbook', { cls: 'pu-meta', testid: 'logbook2d' });
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
    const total = (icon: IconName | 'star', value: string, label: string): HTMLElement =>
      el('div', 'pu-lb-total', { 'data-testid': `lb2d-total-${icon}` }, seal(icon), el('div', '', {}, el('strong', 'pu-ink', {}, value), el('span', 'pu-ink-soft', {}, label)));
    const totals = el(
      'div',
      'pu-lb-totals',
      {},
      total('star', `${wallet.campaign}/${levels.length * 3}`, 'stars'),
      total('medal', `${badges}/${badgesMax}`, 'badges'),
      total('crown', `${mastered}/${levels.length}`, 'mastered'),
      total('trophy', String(wins), 'victories'),
      total('daily', String(liveStreak(p.daily, utcDayNumber(Date.now()))), `day streak · best ${p.daily.bestStreak}`),
      total('endless', `${medals}/${levels.length * 3}`, 'endless medals'),
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
    mk('islands', 'Islands');
    mk('feats', `Feats ${earned}/${feats.length}`);
    const list = el('div', 'pu-ledger');
    if (tab === 'islands') {
      levels.forEach((lvl, i) => {
        const unlocked = i <= p.unlockedLevelIndex;
        const row = el('div', `pu-ledger-row${unlocked ? '' : ' locked'}`);
        const num = el('span', 'pu-ledger-num pu-letter', {}, String(i + 1));
        if (!unlocked) {
          row.append(num, el('span', 'pu-ledger-name pu-ink', {}, 'Uncharted isle', el('small', 'pu-ink-soft', {}, `Clear ${levels[Math.max(0, i - 1)].name} to sail here`)));
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
            b.setAttribute('aria-label', `${CHALLENGES[id].name}: ${got ? 'badge earned' : 'not yet'}`);
            b.title = `${CHALLENGES[id].name} — ${CHALLENGES[id].description}${got ? ' (badge earned)' : ''}`;
            badges.append(b);
          }
          const rec = endlessRecordText(p.bestEndlessWaves[i] ?? 0, lvl.waves.length);
          const endless = el(
            'span',
            `pu-rec pu-ledger-endless pu-ink${rec.tier > 0 ? '' : ' none'}`,
            { title: `Endless best: ${rec.best}${rec.tierName ? ` (${rec.tierName} medal)` : ''}`, 'data-testid': `lb2d-endless-${lvl.id}` },
            glyph('endless'),
            (p.bestEndlessWaves[i] ?? 0) > lvl.waves.length ? `W${p.bestEndlessWaves[i]}` : '–',
          );
          if (rec.tier > 0) endless.style.setProperty('--tier', tierColour(rec.tier));
          row.append(
            num,
            el('span', 'pu-ledger-name pu-ink', {}, lvl.name, el('small', 'pu-ink-soft', {}, lvl.difficulty)),
            starsRow(p.bestStars[i] ?? 0),
            badges,
            endless,
            el('span', 'pu-rec pu-ink', { title: 'Best lives left' }, glyph('heart'), lives > 0 ? String(lives) : '–'),
            el('span', 'pu-ink-soft', { title: 'Victories' }, w > 0 ? `${w}× won` : 'not won'),
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
            seal(FEAT_ICON[f.def.icon]),
            el('div', '', {}, el('div', 'pu-feat-name pu-ink', {}, f.def.name), el('div', 'pu-feat-desc pu-ink-soft', {}, f.def.description)),
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
          ? 'Feats are long voyages: they unlock as your records grow.'
          : `${earned} of ${feats.length} feats earned`
        : wins === 0
          ? 'Your victories and records will be written here.'
          : `${cleared}/${levels.length} isles cleared`,
    );
    sheet.body.append(totals, tabs, list, foot);
  };
  render();
  return sheet;
}

// --- Daily Squall --------------------------------------------------------------------------------

const RULE_ICON: Partial<Record<ChallengeId, IconName>> = {
  galeForce: 'wave',
  ironTide: 'heart',
  glassSanctuary: 'heart',
  silentSkies: 'lock',
  championHost: 'crown',
};

/** Round seal for a challenge rule: the banned tower crossed out, a purse, or a rule glyph. */
export function ruleSeal(id: ChallengeId): HTMLSpanElement {
  const def = CHALLENGES[id];
  const s = el('span', 'pu-round', { 'aria-hidden': 'true' });
  if (def.bannedIcon) {
    const i = img(`${ART}tower-${def.bannedIcon}-t1.webp`);
    i.style.cssText = 'width:64%;height:64%;object-fit:contain;filter:grayscale(.3)';
    const slash = el('span');
    slash.style.cssText = 'position:absolute;left:18%;right:18%;top:47%;height:9%;background:#c8341f;transform:rotate(-40deg);border-radius:3px;box-shadow:0 0 0 2px #3a2412';
    s.append(i, slash);
  } else if (id === 'thinPurse') {
    const i = img(KIT.gold);
    i.style.cssText = 'width:52%;height:52%;object-fit:contain';
    s.append(i);
  } else s.append(glyph(RULE_ICON[id] ?? 'medal'));
  return s;
}

/** Today's Daily over the 2D isles (null until one island is won). */
export function dailyFor2D(progress: ProgressData, nowMs: number, levels: readonly LevelDef[] = LEVELS_2D): DailyChallenge | null {
  return dailyForToday(nowMs, progress, levels);
}

export function openDaily(ctx: MetaContext, nowMs = Date.now()): Sheet {
  const sheet = openSheet('Daily Squall', { cls: 'pu-meta', red: true, testid: 'daily2d' });
  const p = ctx.progress;
  const daily = dailyFor2D(p, nowMs, ctx.levels);
  if (!daily) {
    sheet.body.append(
      el('div', 'pu-daily-island', {}, seal('daily'), el('div', 'pu-ink', {}, 'The squall is gathering')),
      el('p', 'pu-meta-note pu-ink-soft', {}, 'Win your first island to open the Daily Squall: one island and two challenge rules, new every day, the same for every captain.'),
    );
    return sheet;
  }
  const level = ctx.levels[daily.levelIndex];
  const doneToday = p.daily.lastDay === daily.day;
  const streak = liveStreak(p.daily, daily.day);
  const day = new Date(daily.day * 86_400_000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  const left = el(
    'div',
    '',
    {},
    el('div', 'pu-daily-island', {}, medal(ctx.thumb(level), 'calc(var(--s) * 8)'), el('div', '', {}, el('div', 'pu-ink', {}, level.name), el('div', 'pu-ink-soft', {}, `${level.difficulty} · ${day} (UTC)`))),
    el(
      'div',
      'pu-chips',
      {},
      el('div', 'pu-chip pu-ink', {}, el('strong', '', {}, doneToday ? '✓' : '+1★'), el('span', 'pu-ink-soft', {}, doneToday ? 'won today' : 'reward')),
      el('div', 'pu-chip pu-ink', {}, el('strong', '', {}, String(streak)), el('span', 'pu-ink-soft', {}, 'day streak')),
      el('div', 'pu-chip pu-ink', {}, el('strong', '', {}, String(p.daily.bestStreak)), el('span', 'pu-ink-soft', {}, 'best streak')),
      el('div', 'pu-chip pu-ink', {}, el('strong', '', {}, String(p.daily.total)), el('span', 'pu-ink-soft', {}, 'won')),
    ),
  );
  const rules = el('div', '');
  for (const id of daily.challenges) {
    const def = CHALLENGES[id];
    rules.append(el('div', 'pu-rule', {}, ruleSeal(id), el('div', 'pu-ink', {}, def.name, el('small', 'pu-ink-soft', {}, def.description))));
  }
  const start = plank('Set sail', {
    kind: 'primary',
    icon: 'play',
    testid: 'daily2d-start',
    sub: doneToday ? 'No reward until tomorrow' : 'Win once today for +1★',
  });
  start.addEventListener('click', () => {
    sheet.close();
    location.assign(dailyHref2D(level.id));
  });
  sheet.body.append(el('div', 'pu-daily-grid', {}, left, el('div', '', {}, rules)), el('div', 'pu-brief-actions', {}, start));
  return sheet;
}

// --- Settings ------------------------------------------------------------------------------------

export function openSettings(ctx: MetaContext): Sheet {
  const sheet = openSheet('Settings', { cls: 'pu-meta', testid: 'settings2d' });
  const s: GameSettings = loadSettings();
  const save = (): void => saveSettings(s);
  const row = (label: string, sub: string | null, control: HTMLElement): HTMLElement =>
    el('div', 'pu-set-row', {}, el('div', 'pu-ink', {}, label, sub ? el('small', 'pu-ink-soft', {}, sub) : null), control);
  const quiet = (r: HTMLElement): HTMLElement => {
    r.classList.add('quiet');
    r.setAttribute('data-testid', 'set2d-quiet');
    const mute = glyph('mute');
    mute.classList.add('pu-set-mute');
    const label = r.firstElementChild!;
    label.insertBefore(mute, label.querySelector('small'));
    return r;
  };
  const val = el('span', 'pu-slider-val pu-ink', {}, `${Math.round(s.masterVolume * 100)}%`);
  const vol = slider(s.masterVolume, 'Master volume', 'set2d-volume', (v) => {
    s.masterVolume = Math.round(v * 100) / 100;
    val.textContent = `${Math.round(s.masterVolume * 100)}%`;
    save();
  });
  const volBox = el('div', '', {}, vol, val);
  volBox.style.cssText = 'display:flex;align-items:center;gap:calc(var(--s) * 1)';
  let armed = 0;
  const reset = plank('Reset isles progress', { kind: 'small', testid: 'set2d-reset' });
  reset.addEventListener('click', () => {
    if (performance.now() < armed) {
      resetProgress2D();
      armed = 0;
      reset.querySelector('span')!.textContent = 'Progress erased';
      reset.disabled = true;
      ctx.onChange();
      return;
    }
    armed = performance.now() + 3200;
    reset.querySelector('span')!.textContent = 'Tap again to erase';
    window.setTimeout(() => {
      if (!reset.disabled) reset.querySelector('span')!.textContent = 'Reset isles progress';
    }, 3300);
  });
  // The painted isles have no sound player yet: volume / sound are kept (the 3D isles use them)
  // but labelled as such. Shake, damage numbers and vibration work in the painted isles.
  sheet.body.append(
    quiet(row('Volume', 'No sound in the painted isles yet', volBox)),
    quiet(row(
      'Sound',
      'Kept for when painted-isle sound arrives',
      toggle(!s.muted, 'Sound on', 'set2d-sound', (v) => {
        s.muted = !v;
        save();
      }),
    )),
    row(
      'Screen shake',
      'Big hits rattle the view',
      toggle(s.cameraShake, 'Screen shake', 'set2d-shake', (v) => {
        s.cameraShake = v;
        save();
      }),
    ),
    row(
      'Damage numbers',
      'Show hit numbers over foes',
      toggle(s.damageNumbers, 'Damage numbers', 'set2d-dmg', (v) => {
        s.damageNumbers = v;
        save();
      }),
    ),
    row(
      'Vibration',
      'Taps and hits on phones',
      toggle(s.haptics, 'Vibration', 'set2d-haptics', (v) => {
        s.haptics = v;
        save();
      }),
    ),
    row('Painted isles progress', 'Stars, unlocks and Workshop of the 2D isles', reset),
  );
  return sheet;
}
