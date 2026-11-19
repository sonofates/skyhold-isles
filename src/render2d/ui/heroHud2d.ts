/**
 * In-game hero HUD: the hero's painted portrait medallion (HP ring, level badge, respawn timer while
 * down, gold glow while selected) and its two active-skill buttons (painted icons in the kit
 * medallion, recharge sweep + seconds, key chips E / R), placed in front of the global ability bar
 * (ui/abilityBar2d.ts lays both out as one bar). Tooltips read the data text (EN + TR).
 *
 * Input (documented in docs/handoff-opus-heroes-ui.md):
 * - Portrait tap / H: select the hero (game2d.ts then takes map taps as move orders); again: drop it.
 * - Skill button / E / R: a self skill (Rally Banner) casts at once; a targeted one starts aiming —
 *   the preview follows the pointer (touch: the finger, cast on release); a tap on the map casts at
 *   that point (the sim pulls it back into the skill's reach). Cancel: the button again, Esc, right
 *   click. Aiming here and aiming a global ability cancel each other; both drop a hero selection.
 * - While aiming, the pointer is caught in the capture phase on the canvas's parent (the same way
 *   the ability bar does it), so game2d's plot / hero taps never see it.
 */
import type { HeroId, HeroSkillSlot } from '../../core/types.ts';
import { HERO_DEFS } from '../../data/heroes.ts';
import type { HeroRuntimeState } from '../../sim/heroSystem.ts';
import { heroName, heroPassiveDesc, heroPassiveName, heroSkillDesc, heroSkillName, heroTitle } from '../../i18n/data.ts';
import { num, t } from '../../i18n/index.ts';
import { haptics } from '../../platform/haptics.ts';
import type { Game2D } from '../game2d.ts';
import { clampToReach, heroAimShape, overhaulPicks } from '../heroInput.ts';
import type { HeroAimSpec } from '../heroLayer.ts';
import { anySheetOpen, el, img, KIT } from './dom.ts';
import { secsLabel } from './abilities2d.ts';
import { heroPortraitUrl, heroSkillUrl, levelBadge, type HeroArtFiles } from './heroBits.ts';
import { HERO_KEYS } from './heroKeys.ts';
import './heroHud2d.css';

export { HERO_KEYS };

/** Width (or height, in a column) of the hero group at button size `d` and spacing `gap`. */
export function heroGroupLong(d: number, gap: number): number {
  return Math.round(d * 1.5 + d * 2 + d * 0.12 + gap * 3);
}

export type HeroSkillViewState = 'ready' | 'cooldown' | 'down' | 'over' | 'paused';

/** Button state of a hero skill from the sim snapshot (pure). */
export function heroSkillState(h: Pick<HeroRuntimeState, 'alive'>, s: { readonly ready: boolean; readonly usable: boolean }, ongoing: boolean): HeroSkillViewState {
  if (!ongoing) return 'over';
  if (!h.alive) return 'down';
  return s.ready ? 'ready' : 'cooldown';
}

interface SkillSlot {
  readonly slot: HeroSkillSlot;
  readonly btn: HTMLButtonElement;
  readonly frame: HTMLImageElement;
  readonly icon: HTMLSpanElement;
  readonly sweep: HTMLSpanElement;
  readonly secs: HTMLSpanElement;
  key: string;
  state: HeroSkillViewState | null;
}

export interface HeroHud2D {
  /** The group element (the ability bar puts it in front of its own buttons). */
  readonly el: HTMLElement;
  frame(dt: number): void;
  setVisible(v: boolean): void;
  readonly aiming: HeroSkillSlot | null;
  /** Start / stop aiming as a button press would (QA), or cast a self skill. */
  aim(slot: HeroSkillSlot | null): void;
  /** Cast at a world point now (QA / tests); false when the sim refused. */
  castAt(slot: HeroSkillSlot, x: number, z: number): boolean;
  debug(): Record<string, unknown>;
}

export interface HeroHudOptions {
  readonly desktop: boolean;
  readonly files: Promise<HeroArtFiles>;
  /** A hero skill started aiming (the ability bar drops its own aim). */
  readonly onAimStart: () => void;
}

export function createHeroHud2D(game: Game2D, opts: HeroHudOptions): HeroHud2D | null {
  const first = game.world.hero;
  if (!first) return null;
  const heroId: HeroId = first.heroId;
  const def = HERO_DEFS[heroId];
  const canvas = game.app.canvas;
  const stage = canvas.parentElement ?? document.body;

  // --- DOM ---------------------------------------------------------------------------------------
  const group = el('div', 'pu-hero-group', { 'data-testid': 'hero2d-hud', 'data-hero': heroId });
  const port = el('button', 'pu-hero-port', { type: 'button', 'data-testid': 'hero2d-portrait', 'aria-describedby': 'hero2d-tip', 'aria-pressed': 'false' });
  const portImg = el('span', 'pu-hero-port-img');
  const hpRing = el('span', 'pu-hero-hp');
  const lvl = levelBadge(first.level, 'pu-hero-port-lvl');
  const down = el('span', 'pu-hero-down pu-letter');
  port.append(hpRing, portImg, down, lvl);
  if (opts.desktop) port.append(el('span', 'pu-ab-key pu-letter', { 'aria-hidden': 'true' }, HERO_KEYS.select));
  const slots: SkillSlot[] = ([0, 1] as const).map((slot) => {
    const btn = el('button', 'pu-ab pu-hs', { type: 'button', 'data-testid': `hero2d-skill${slot}`, 'data-slot': slot, 'aria-describedby': 'hero2d-tip' });
    const frame = img(KIT.medallion, '', 'pu-ab-frame');
    const icon = el('span', 'pu-ab-icon pu-hs-icon');
    const sweep = el('span', 'pu-ab-sweep');
    const secs = el('span', 'pu-ab-secs pu-letter');
    const cancel = el('span', 'pu-ab-cancel', { 'aria-hidden': 'true' }, '✕');
    btn.append(frame, icon, sweep, secs, cancel);
    if (opts.desktop) btn.append(el('span', 'pu-ab-key pu-letter', { 'aria-hidden': 'true' }, slot === 0 ? HERO_KEYS.skill0 : HERO_KEYS.skill1));
    return { slot, btn, frame, icon, sweep, secs, key: '', state: null };
  });
  const divider = el('span', 'pu-hero-divider', { 'aria-hidden': 'true' });
  group.append(port, slots[0].btn, slots[1].btn, divider);
  const tip = el('div', 'pu pu-ab-tip pu-hero-tip', { role: 'tooltip', id: 'hero2d-tip', hidden: true });
  const hint = el('div', 'pu pu-ab-hint', { 'data-testid': 'hero2d-hint', hidden: true, 'aria-live': 'polite' });
  document.body.append(tip, hint);

  void opts.files.then((files) => {
    const p = heroPortraitUrl(files, heroId);
    if (p) portImg.append(img(p, '', 'pu-hero-port-art'));
    for (const s of slots) {
      const u = heroSkillUrl(files, heroId, s.slot);
      if (u) s.icon.append(img(u, '', 'pu-ab-art'));
    }
  });

  let visible = true;
  let aiming: HeroSkillSlot | null = null;
  let lastPointer: { x: number; y: number } | null = null;
  let downAt: { id: number } | null = null;

  // --- tooltip -----------------------------------------------------------------------------------
  type TipFor = HeroSkillSlot | 'hero' | null;
  let tipFor: TipFor = null;
  const showTip = (what: TipFor): void => {
    tipFor = what;
    if (what === null) {
      tip.hidden = true;
      return;
    }
    const h = game.getHeroState();
    if (!h) return;
    tip.innerHTML = '';
    const anchor = what === 'hero' ? port : slots[what].btn;
    if (what === 'hero') {
      const head = el('div', 'pu-ab-tip-head pu-ink', {}, heroName(heroId));
      if (opts.desktop) head.append(el('span', 'pu-ab-tip-key pu-letter', {}, t('ab.key', { key: HERO_KEYS.select })));
      tip.append(
        head,
        el('div', 'pu-hero-tip-sub pu-ink-soft', {}, t('hero.levelTitle', { n: h.level, title: heroTitle(heroId) })),
        el('div', 'pu-ab-tip-desc pu-ink-soft', {}, el('b', 'pu-ink', {}, `${heroPassiveName(heroId)}: `), heroPassiveDesc(heroId)),
        el(
          'div',
          'pu-ab-tip-foot pu-ink',
          {},
          t('hero.hp', { hp: num(h.hp), max: num(h.maxHp) }),
          el('b', '', {}, h.alive ? t(opts.desktop ? 'hero.selectMouse' : 'hero.selectTouch') : t('hero.respawnIn', { n: Math.ceil(h.respawnRemaining) })),
        ),
      );
    } else {
      const s = h.skills[what];
      const act = def.actives[what];
      const head = el('div', 'pu-ab-tip-head pu-ink', {}, heroSkillName(heroId, what));
      if (opts.desktop) head.append(el('span', 'pu-ab-tip-key pu-letter', {}, t('ab.key', { key: what === 0 ? HERO_KEYS.skill0 : HERO_KEYS.skill1 })));
      const st = heroSkillState(h, s, game.world.outcome === 'ongoing');
      const status = st === 'ready' ? t('ab.ready') : st === 'cooldown' ? secsLabel(s.cooldown) : st === 'down' ? t('hero.skillDown') : '';
      const res = game.world.hero?.stats.actives[what];
      const bits: string[] = [];
      if (res && res.damage > 0) bits.push(t('hero.statDamage', { n: num(res.damage) }));
      if (res && res.durationSec > 0) bits.push(t('hero.statDuration', { n: num(Math.round(res.durationSec * 10) / 10) }));
      tip.append(
        head,
        el('div', 'pu-ab-tip-desc pu-ink-soft', {}, heroSkillDesc(heroId, what)),
        ...(bits.length > 0 ? [el('div', 'pu-hero-tip-sub pu-ink', {}, bits.join(t('common.sep')))] : []),
        el('div', 'pu-ab-tip-foot pu-ink', {}, t('ab.cooldown', { n: Math.round(s.maxCooldown) }), el('b', '', {}, act.targetMode === 'self' ? `${status}${status ? t('common.sep') : ''}${t('hero.selfCast')}` : status)),
      );
    }
    tip.hidden = false;
    const b = anchor.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const vertical = group.parentElement?.classList.contains('edge') ?? false;
    let x = b.left + b.width / 2 - tw / 2;
    let y = b.top - 10 - th;
    if (vertical) {
      x = b.left + b.width / 2 < window.innerWidth / 2 ? b.right + 10 : b.left - 10 - tw;
      y = Math.min(window.innerHeight - th - 6, b.top);
    }
    tip.style.left = `${Math.round(Math.max(6, Math.min(window.innerWidth - tw - 6, x)))}px`;
    tip.style.top = `${Math.round(Math.max(6, y))}px`;
  };
  const hoverTip = (b: HTMLElement, what: TipFor): void => {
    b.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') showTip(what);
    });
    b.addEventListener('pointerleave', () => showTip(null));
    b.addEventListener('focus', () => showTip(what));
    b.addEventListener('blur', () => showTip(null));
  };
  hoverTip(port, 'hero');
  for (const s of slots) hoverTip(s.btn, s.slot);
  const flashTip = (what: TipFor): void => {
    if (opts.desktop) return;
    showTip(what);
    window.setTimeout(() => {
      if (tipFor === what) showTip(null);
    }, 1800);
  };

  // --- aiming ------------------------------------------------------------------------------------
  const local = (e: PointerEvent | MouseEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const insideMap = (p: { x: number; y: number }): boolean => {
    const m = game.map;
    const mx = (p.x - m.fit.offsetX) / m.fit.scale;
    const my = (p.y - m.fit.offsetY) / m.fit.scale;
    return mx >= 0 && my >= 0 && mx <= m.imageW && my <= m.imageH;
  };
  const specAt = (slot: HeroSkillSlot, p: { x: number; y: number } | null): HeroAimSpec | null => {
    const h = game.world.hero;
    if (!h) return null;
    const act = h.stats.actives[slot];
    const shape = heroAimShape(act.kind);
    let wx: number;
    let wz: number;
    if (p) {
      wx = game.map.worldXFromScreen(p.x);
      wz = game.map.worldZFromScreen(p.y);
    } else {
      wx = h.x + Math.sin(h.yaw) * Math.min(2, act.range);
      wz = h.z + Math.cos(h.yaw) * Math.min(2, act.range);
    }
    const c = clampToReach(h.x, h.z, wx, wz, act.range);
    const valid = !p || insideMap(p);
    if (shape === 'towers') {
      const { candidates, picked } = overhaulPicks(game.world.towers, c.x, c.z, h.x, h.z, act.range, act.count);
      return {
        shape,
        tx: c.x,
        tz: c.z,
        radius: act.radius,
        range: act.range,
        valid: valid && candidates.length > 0,
        towers: candidates.map((tw) => ({ x: tw.x, z: tw.z, picked: picked.includes(tw) })),
      };
    }
    return { shape, tx: c.x, tz: c.z, radius: act.radius, range: act.range, valid };
  };
  const preview = (p: { x: number; y: number } | null): void => {
    if (aiming === null) return;
    game.heroes.showAim(specAt(aiming, p));
  };
  let hintFor = '';
  const showHint = (): void => {
    const moving = aiming === null && game.heroSelected && visible;
    const key = aiming !== null ? `aim${aiming}` : moving ? 'move' : '';
    if (key === hintFor && (key === '' || !hint.hidden)) return;
    hintFor = key;
    if (!key) {
      hint.hidden = true;
      return;
    }
    const verb = t(opts.desktop ? 'hero.verbClick' : 'hero.verbTap');
    hint.innerHTML = '';
    if (aiming !== null) {
      const kind = def.actives[aiming].kind;
      const what = kind === 'overhaul' ? 'hero.aimTower' : kind === 'shieldBash' || kind === 'wispBurst' ? 'hero.aimDir' : 'hero.aimPoint';
      hint.append(el('div', 'pu-ink', {}, t(what, { skill: heroSkillName(heroId, aiming), verb })), el('small', 'pu-ink-soft', {}, t(opts.desktop ? 'ab.cancelMouse' : 'ab.cancelTouch')));
    } else {
      hint.append(el('div', 'pu-ink', {}, t('hero.moveHint', { name: heroName(heroId).split(' ')[0], verb })), el('small', 'pu-ink-soft', {}, t(opts.desktop ? 'hero.moveHintMouse' : 'hero.moveHintTouch')));
    }
    hint.hidden = false;
    const b = group.getBoundingClientRect();
    const hw = hint.offsetWidth;
    const hh = hint.offsetHeight;
    let x = b.left + b.width / 2 - hw / 2;
    let y = b.top - 10 - hh;
    if (group.parentElement?.classList.contains('edge')) {
      x = b.left + b.width / 2 < window.innerWidth / 2 ? b.right + 10 : b.left - 10 - hw;
      y = b.top;
    }
    hint.style.left = `${Math.round(Math.max(6, Math.min(window.innerWidth - hw - 6, x)))}px`;
    hint.style.top = `${Math.round(Math.max(6, y))}px`;
  };
  const nudge = (): void => {
    hint.classList.remove('nudge');
    void hint.offsetWidth;
    hint.classList.add('nudge');
  };
  const setAim = (slot: HeroSkillSlot | null): void => {
    if (slot !== null && aiming !== slot) {
      opts.onAimStart();
      game.setHeroSelected(false);
    }
    aiming = slot;
    downAt = null;
    for (const s of slots) s.btn.classList.toggle('is-aiming', s.slot === slot);
    group.dataset.aiming = slot === null ? '' : String(slot);
    if (slot === null) {
      game.heroes.showAim(null);
      canvas.style.cursor = '';
    } else {
      preview(lastPointer && insideMap(lastPointer) ? lastPointer : null);
      canvas.style.cursor = 'crosshair';
    }
    showHint();
  };
  const ready = (slot: HeroSkillSlot): boolean => {
    const h = game.getHeroState();
    if (!h || !visible || game.end.visible || game.stepper.paused || anySheetOpen()) return false;
    return heroSkillState(h, h.skills[slot], game.world.outcome === 'ongoing') === 'ready';
  };
  const nope = (slot: HeroSkillSlot): void => {
    const b = slots[slot].btn;
    b.classList.remove('nope');
    void b.offsetWidth;
    b.classList.add('nope');
    flashTip(slot);
  };
  const castAt = (slot: HeroSkillSlot, x: number, z: number): boolean => {
    const ok = game.castHeroSkill(slot, x, z);
    if (ok) haptics.pulse('tap');
    return ok;
  };
  const press = (slot: HeroSkillSlot): void => {
    if (aiming === slot) {
      setAim(null);
      return;
    }
    if (!ready(slot)) {
      nope(slot);
      return;
    }
    if (def.actives[slot].targetMode === 'self') {
      if (aiming !== null) setAim(null);
      opts.onAimStart();
      if (game.castHeroSkill(slot)) haptics.pulse('tap');
      else nope(slot);
      return;
    }
    setAim(slot);
  };
  for (const s of slots) {
    s.btn.addEventListener('click', (e) => {
      if (e.detail > 0) s.btn.blur();
      press(s.slot);
    });
  }
  port.addEventListener('click', (e) => {
    if (e.detail > 0) port.blur();
    const h = game.getHeroState();
    if (!h || !h.alive || game.stepper.paused || game.end.visible) {
      port.classList.remove('nope');
      void port.offsetWidth;
      port.classList.add('nope');
      flashTip('hero');
      return;
    }
    if (aiming !== null) setAim(null);
    opts.onAimStart();
    game.setHeroSelected(!game.heroSelected);
    haptics.pulse('tap');
  });

  const commit = (p: { x: number; y: number }): void => {
    if (aiming === null) return;
    const spec = specAt(aiming, p);
    if (!spec || !spec.valid) {
      nudge();
      return;
    }
    if (castAt(aiming, game.map.worldXFromScreen(p.x), game.map.worldZFromScreen(p.y))) setAim(null);
    else {
      // e.g. Thunder Call / Hunter's Mark with no foe near the point: keep aiming.
      hint.firstElementChild?.replaceChildren(t('hero.noTarget'));
      nudge();
    }
  };
  const stop = (e: Event): void => {
    e.stopPropagation();
    e.preventDefault();
  };
  stage.addEventListener(
    'pointerdown',
    (e) => {
      if (aiming === null || e.target !== canvas) return;
      if (e.button === 2) {
        setAim(null);
        stop(e);
        return;
      }
      const p = local(e);
      if (game.hud.hit(p.x, p.y)) {
        setAim(null);
        return;
      }
      downAt = { id: e.pointerId };
      lastPointer = p;
      preview(p);
      stop(e);
    },
    { capture: true },
  );
  stage.addEventListener(
    'pointermove',
    (e) => {
      if (e.target !== canvas) return;
      const p = local(e);
      if (e.pointerType === 'mouse' || downAt) lastPointer = p;
      if (aiming === null) return;
      if (e.pointerType === 'mouse' || (downAt && downAt.id === e.pointerId)) preview(p);
      e.stopPropagation();
    },
    { capture: true },
  );
  stage.addEventListener(
    'pointerup',
    (e) => {
      if (aiming === null || !downAt || downAt.id !== e.pointerId) return;
      downAt = null;
      stop(e);
      commit(local(e));
    },
    { capture: true },
  );
  stage.addEventListener('pointercancel', () => (downAt = null), { capture: true });
  stage.addEventListener('contextmenu', (e) => {
    if (aiming !== null) {
      setAim(null);
      e.preventDefault();
    }
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if (anySheetOpen() || game.replaying || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        if (aiming !== null) setAim(null);
        return;
      }
      if (e.repeat) return;
      const k = e.key.toUpperCase();
      if (k === HERO_KEYS.skill0 || k === HERO_KEYS.skill1) {
        e.preventDefault();
        press(k === HERO_KEYS.skill0 ? 0 : 1);
      }
    },
    { capture: true },
  );
  game.onHeroSelect = (on) => {
    port.classList.toggle('selected', on);
    port.setAttribute('aria-pressed', String(on));
    showHint();
  };

  // --- per frame ---------------------------------------------------------------------------------
  let portKey = '';
  const syncPortrait = (h: HeroRuntimeState, paused: boolean): void => {
    const frac = h.maxHp > 0 ? h.hp / h.maxHp : 0;
    const left = Math.ceil(h.respawnRemaining);
    const key = `${h.alive ? 1 : 0}|${Math.round(frac * 100)}|${left}|${h.level}|${paused ? 1 : 0}`;
    if (key === portKey) return;
    portKey = key;
    port.classList.toggle('dead', !h.alive);
    port.classList.toggle('paused', paused);
    hpRing.style.setProperty('--hp', (h.alive ? frac : h.respawnMax > 0 ? 1 - h.respawnRemaining / h.respawnMax : 0).toFixed(3));
    hpRing.style.setProperty('--hpc', !h.alive ? '#9fb4c8' : frac > 0.55 ? '#7bd04a' : frac > 0.28 ? '#f2c23a' : '#e0503a');
    down.textContent = h.alive ? '' : secsLabel(left);
    lvl.textContent = String(h.level);
    port.setAttribute(
      'aria-label',
      h.alive ? t('hero.portAria', { name: heroName(heroId), hp: num(h.hp), max: num(h.maxHp) }) : t('hero.portDownAria', { name: heroName(heroId), n: left }),
    );
    if (tipFor === 'hero') showTip('hero');
  };
  const syncSkill = (s: SkillSlot, h: HeroRuntimeState, paused: boolean): void => {
    const sk = h.skills[s.slot];
    const st = heroSkillState(h, sk, game.world.outcome === 'ongoing');
    const frac = sk.maxCooldown > 0 ? sk.cooldown / sk.maxCooldown : 0;
    const key = `${st}|${Math.ceil(sk.cooldown)}|${Math.round(frac * 200)}|${paused ? 1 : 0}`;
    if (key === s.key) return;
    const was = s.state;
    s.key = key;
    s.state = st;
    s.btn.dataset.state = st === 'down' ? 'waiting' : st === 'over' ? 'disabled' : st;
    s.btn.classList.toggle('paused', paused);
    s.btn.classList.toggle('hero-down', st === 'down');
    s.frame.src = st === 'ready' && !paused ? KIT.medallionHi : KIT.medallion;
    s.sweep.style.setProperty('--cd', st === 'cooldown' ? frac.toFixed(3) : '0');
    s.secs.textContent = st === 'cooldown' ? secsLabel(sk.cooldown) : '';
    s.btn.disabled = st === 'over';
    s.btn.setAttribute('aria-label', t('ab.btnAria', { name: heroSkillName(heroId, s.slot), state: st === 'ready' ? t('ab.ready') : st === 'cooldown' ? secsLabel(sk.cooldown) : t('hero.skillDown') }));
    if (was === 'cooldown' && st === 'ready') {
      s.btn.classList.remove('ready-pop');
      void s.btn.offsetWidth;
      s.btn.classList.add('ready-pop');
    }
    if (tipFor === s.slot) showTip(s.slot);
  };

  return {
    el: group,
    frame(): void {
      const h = game.getHeroState();
      if (!h) return;
      const paused = game.stepper.paused;
      syncPortrait(h, paused);
      for (const s of slots) syncSkill(s, h, paused);
      if (aiming !== null) {
        if (!ready(aiming)) setAim(null);
        else if (lastPointer && opts.desktop) preview(lastPointer);
        else preview(lastPointer && downAt ? lastPointer : null);
      }
    },
    setVisible(v: boolean): void {
      if (v === visible) return;
      visible = v;
      if (!v) {
        setAim(null);
        showTip(null);
      }
      showHint();
    },
    get aiming() {
      return aiming;
    },
    aim(slot: HeroSkillSlot | null): void {
      if (slot === null) setAim(null);
      else press(slot);
    },
    castAt,
    debug(): Record<string, unknown> {
      const r = (e: Element): { x: number; y: number; w: number; h: number } => {
        const b = e.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      return {
        hero: heroId,
        aiming,
        portrait: { ...r(port), selected: port.classList.contains('selected'), dead: port.classList.contains('dead'), timer: down.textContent },
        skills: slots.map((s) => ({ ...r(s.btn), state: s.state, secs: s.secs.textContent })),
        hint: hint.hidden ? null : hint.textContent,
        tip: tip.hidden ? null : tip.textContent,
      };
    },
  };
}
