/**
 * The painted ability bar of a 2D run (Meteor Strike, Overcharge) and its aiming.
 *
 * - Bar: two medallion buttons in the HUD dock's tray (hudDock.ts: one row at the bottom centre),
 *   behind the hero group, with a dark recharge sweep + seconds, a gold "ready" glow, the
 *   Overcharge surge ring while it lasts, a key chip on desktops (Q / W) and a parchment tooltip on
 *   hover / focus (rules text from src/data/abilities.ts). Disabled look when the run's rules forbid
 *   abilities, dimmed before the first wave and (Overcharge) with no tower built.
 * - Aiming: tap / click / key → Meteor shows its area circle under the pointer (touch: under the
 *   finger, cast on release), Overcharge lights every tower and casts on a tower tap. A second tap
 *   on the button, Esc or a right click cancels. Input is caught on the canvas's parent in the
 *   capture phase, so game2d.ts needs no hook: while aiming, its plot taps never see the pointer.
 * - FX: abilityFx.ts, driven by the sim's own events (`abilityTargeted`, `meteorImpact`,
 *   `overchargeActivated`); sounds come from the shared SoundManager bindings of those events.
 */
import { Assets, Texture } from 'pixi.js';
import { PAD_BADGE } from './padBadges.ts';
import type { AbilityId } from '../../core/types.ts';
import { ABILITY_DEFS } from '../../data/abilities.ts';
import type { EventBus } from '../../core/eventBus.ts';
import { t } from '../../i18n/index.ts';
import { haptics } from '../../platform/haptics.ts';
import { AbilityFx, ABILITY_ART_KEYS, type AbilityArt, type AbilityArtKey, type FxTower } from '../abilityFx.ts';
import type { Game2D } from '../game2d.ts';
import { addHudKeepOut } from '../uiKit.ts';
import type { Rect } from '../uiLayout.ts';
import { TRAY_PAD } from '../hudDock.ts';
import {
  ABILITY_IDS,
  ABILITY_KEYS,
  abilityDesc,
  abilityName,
  abilitySlotView,
  secsLabel,
  slotStatus,
  type AbilitySlotView,
} from './abilities2d.ts';
import { anySheetOpen, el, img, KIT } from './dom.ts';
import './abilityBar2d.css';

const ICON_SVG: Readonly<Record<AbilityId, string>> = {
  meteor:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><defs>' +
    '<radialGradient id="ab-mr" cx=".38" cy=".36" r=".7"><stop offset="0" stop-color="#ffe29a"/><stop offset=".45" stop-color="#d5631f"/><stop offset="1" stop-color="#4a2410"/></radialGradient>' +
    '<linearGradient id="ab-mt" x1="0" y1="1" x2="1" y2="0"><stop offset="0" stop-color="#fff2b0"/><stop offset=".45" stop-color="#ff8a2a"/><stop offset="1" stop-color="#ff4a12" stop-opacity="0"/></linearGradient></defs>' +
    '<path d="M16 40C28 30 42 16 60 3C51 20 41 33 30 50Z" fill="url(#ab-mt)"/>' +
    '<path d="M10 30C22 24 33 15 46 5C40 18 32 28 22 40Z" fill="url(#ab-mt)" opacity=".65"/>' +
    '<path d="M28 52C34 44 46 32 58 22C52 34 44 44 36 56Z" fill="url(#ab-mt)" opacity=".55"/>' +
    '<path d="M9 44l5-10 10-3 9 6 1 10-7 9-11 1-7-6z" fill="url(#ab-mr)" stroke="#2a1408" stroke-width="3" stroke-linejoin="round"/>' +
    '<path d="M15 41l5-2M19 50l4-1" stroke="#3a1a08" stroke-width="2.4" stroke-linecap="round"/></svg>',
  overcharge:
    '<svg viewBox="0 0 64 64" aria-hidden="true"><defs>' +
    '<radialGradient id="ab-og"><stop offset="0" stop-color="#e8fbff" stop-opacity=".95"/><stop offset=".6" stop-color="#7fdcff" stop-opacity=".45"/><stop offset="1" stop-color="#5ad0ff" stop-opacity="0"/></radialGradient>' +
    '<linearGradient id="ab-ob" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fffbe2"/><stop offset=".55" stop-color="#ffd23a"/><stop offset="1" stop-color="#e0880f"/></linearGradient></defs>' +
    '<circle cx="32" cy="33" r="27" fill="url(#ab-og)"/>' +
    '<path d="M37 4L15 36h14l-6 24 26-36H35z" fill="url(#ab-ob)" stroke="#3a2412" stroke-width="3.4" stroke-linejoin="round"/>' +
    '<path d="M8 22l6 2M56 40l-6-2M10 46l6-3M54 16l-6 3" stroke="#bff2ff" stroke-width="3" stroke-linecap="round"/></svg>',
};

interface Slot {
  readonly id: AbilityId;
  readonly btn: HTMLButtonElement;
  readonly frame: HTMLImageElement;
  readonly icon: HTMLSpanElement;
  readonly sweep: HTMLSpanElement;
  readonly surge: HTMLSpanElement;
  readonly secs: HTMLSpanElement;
  key: string;
  view: AbilitySlotView | null;
}

export interface AbilityBar2D {
  /** Per frame (real seconds). */
  frame(dt: number): void;
  /** Hidden with the end panel / story panels. */
  setVisible(visible: boolean): void;
  readonly aiming: AbilityId | null;
  /** QA: aim (as a tap on the button / key would), or cancel. */
  aim(id: AbilityId | null): void;
  /** QA: the screen box of the bar, its buttons and the aim state. */
  debug(): Record<string, unknown>;
}

export interface AbilityBarOptions {
  /** Fine pointer + hover (desktop): key chips and hover tooltips. */
  readonly desktop: boolean;
  /** Painted pieces (manifest `abilities.*`) when present. */
  readonly art?: Promise<Partial<Record<AbilityArtKey, string>>>;
  readonly baseUrl?: string;
  /** A group laid out in front of the ability buttons (the hero HUD); its size is in the dock (hudDock.ts). */
  readonly lead?: { readonly el: HTMLElement };
  /** An ability started aiming (the hero HUD drops its own aim). */
  readonly onAimStart?: () => void;
}

/**
 * `abilities` section of the raw art manifest (the parsed one keeps only the game's keys). Accepts
 * the flat keys (`meteorIcon`, …) and the nested layout the art landed with
 * (`abilities.meteor.icon`, `abilities.overcharge.icon`).
 */
export async function abilityArtFiles(baseUrl: string): Promise<Partial<Record<AbilityArtKey, string>>> {
  try {
    const res = await fetch(`${baseUrl}manifest.json`);
    if (!res.ok) return {};
    const raw = (await res.json()) as { abilities?: Record<string, unknown> };
    const out: Partial<Record<AbilityArtKey, string>> = {};
    for (const k of ABILITY_ART_KEYS) {
      const v = raw.abilities?.[k];
      if (typeof v === 'string' && v) out[k] = v;
    }
    const nested = (id: string, key: string): string | null => {
      const sec = raw.abilities?.[id];
      const v = sec && typeof sec === 'object' ? (sec as Record<string, unknown>)[key] : undefined;
      return typeof v === 'string' && v ? v : null;
    };
    out.meteorIcon ??= nested('meteor', 'icon') ?? undefined;
    out.overchargeIcon ??= nested('overcharge', 'icon') ?? undefined;
    if (!out.meteorIcon) delete out.meteorIcon;
    if (!out.overchargeIcon) delete out.overchargeIcon;
    return out;
  } catch {
    return {};
  }
}

export function mountAbilityBar2D(game: Game2D, opts: AbilityBarOptions): AbilityBar2D {
  const canvas = game.app.canvas;
  const stage = canvas.parentElement ?? document.body;
  const fx = new AbilityFx({
    map: game.map,
    layers: game.layers,
    tex: game.tex,
    fx: game.fx,
    towerBox: (id) => game.towers.spriteRect(id),
  });

  // --- DOM -----------------------------------------------------------------------------------
  const root = el('div', `pu pu-abilities${opts.desktop ? ' desktop' : ''}`, { role: 'toolbar', 'aria-label': t('ab.bar'), 'data-testid': 'ab2d-bar' });
  const tip = el('div', 'pu-ab-tip', { role: 'tooltip', id: 'ab2d-tip', hidden: true });
  const hint = el('div', 'pu pu-ab-hint', { 'data-testid': 'ab2d-hint', hidden: true, 'aria-live': 'polite' });
  const slots: Slot[] = ABILITY_IDS.map((id) => {
    const btn = el('button', 'pu-ab', { type: 'button', 'data-ability': id, 'data-testid': `ab2d-${id}`, 'aria-describedby': 'ab2d-tip' });
    const frame = img(KIT.medallion, '', 'pu-ab-frame');
    const icon = el('span', 'pu-ab-icon');
    icon.innerHTML = ICON_SVG[id];
    const sweep = el('span', 'pu-ab-sweep');
    const surge = el('span', 'pu-ab-surge');
    const secs = el('span', 'pu-ab-secs pu-letter');
    const cancel = el('span', 'pu-ab-cancel', { 'aria-hidden': 'true' }, '✕');
    btn.append(frame, icon, sweep, surge, secs, cancel);
    if (opts.desktop) btn.append(el('span', 'pu-ab-key pu-letter', { 'aria-hidden': 'true', 'data-pad': PAD_BADGE[id] }, ABILITY_KEYS[id]));
    return { id, btn, frame, icon, sweep, surge, secs, key: '', view: null };
  });
  if (opts.lead) root.append(opts.lead.el);
  for (const s of slots) root.append(s.btn);
  root.append(tip);
  document.body.append(root, hint);

  // Painted icons replace the procedural ones once Codex's art is in the manifest.
  void opts.art?.then(async (files) => {
    const base = opts.baseUrl ?? '/art2d/';
    for (const s of slots) {
      const f = files[s.id === 'meteor' ? 'meteorIcon' : 'overchargeIcon'];
      if (!f) continue;
      const pic = img(base + f, '', 'pu-ab-art');
      pic.addEventListener('load', () => {
        s.icon.innerHTML = '';
        s.icon.append(pic);
      });
    }
    const load = async (k: AbilityArtKey): Promise<Texture | undefined> => {
      const f = files[k];
      if (!f) return undefined;
      try {
        const tex = await Assets.load<Texture>({ src: base + f, data: { autoGenerateMipmaps: true } });
        return tex && tex !== Texture.EMPTY ? tex : undefined;
      } catch {
        return undefined;
      }
    };
    const [meteorRock, meteorCrater, overchargeAura, targetRing] = await Promise.all([load('meteorRock'), load('meteorCrater'), load('overchargeAura'), load('targetRing')]);
    const art: AbilityArt = { meteorRock, meteorCrater, overchargeAura, targetRing };
    fx.setArt(art);
  });

  let visible = true;
  let box: Rect = { x: 0, y: 0, w: 0, h: 0 };
  let spot: { x: number; y: number; layout: 'row'; form: string } | null = null;
  let edge = false;
  let d = 60;
  /**
   * The tray's slot in the HUD dock (hudDock.ts): one row at the bottom centre on every screen,
   * slid along the bottom on an island where the centre would cover a plot / road / castle.
   */
  const place = (): void => {
    const k = game.dock;
    d = k.d;
    const gap = k.gap;
    spot = { x: k.tray.x, y: k.tray.y, layout: k.trayLayout, form: k.form };
    root.classList.remove('vertical', 'block', 'stack', 'edge');
    root.classList.toggle('tray', true);
    edge = false;
    root.style.removeProperty('--blockw');
    root.style.setProperty('--d', `${d}px`);
    root.style.setProperty('--gap', `${gap}px`);
    // The row sits TRAY_PAD × d inside the slot; the painted backing fills the slot (css).
    const inset = Math.round(d * TRAY_PAD);
    root.style.left = `${Math.round(k.tray.x) + inset}px`;
    root.style.top = `${Math.round(k.tray.y) + inset}px`;
    box = { x: k.tray.x, y: k.tray.y, w: k.tray.w, h: k.tray.h };
    root.style.setProperty('--short', `${Math.round(k.tray.h)}px`);
    placeHint();
  };
  const placeHint = (): void => {
    if (hint.hidden) return;
    const hw = hint.offsetWidth;
    const hh = hint.offsetHeight;
    const gap = 10;
    let x = box.x + box.w / 2 - hw / 2;
    let y = box.y - gap - hh;
    if (edge) {
      // Beside the column, towards the middle of the screen.
      x = box.x + box.w / 2 < window.innerWidth / 2 ? box.x + box.w + gap : box.x - gap - hw;
      y = box.y + box.h - hh;
    }
    hint.style.left = `${Math.round(Math.max(6, Math.min(window.innerWidth - hw - 6, x)))}px`;
    hint.style.top = `${Math.round(Math.max(6, y))}px`;
  };
  // After the HUD's own layout (game.resize runs on the renderer's resize first).
  game.app.renderer.on('resize', () => requestAnimationFrame(place));
  place();
  const keepOut = (): Rect | null => (visible ? { x: box.x - 6, y: box.y - 6, w: box.w + 12, h: box.h + 12 } : null);
  addHudKeepOut(keepOut);

  // --- tooltip -------------------------------------------------------------------------------
  let tipFor: AbilityId | null = null;
  const showTip = (id: AbilityId | null): void => {
    tipFor = id;
    if (!id) {
      tip.hidden = true;
      return;
    }
    const s = slots.find((q) => q.id === id)!;
    const v = abilitySlotView(game.world, id);
    tip.innerHTML = '';
    const head = el('div', 'pu-ab-tip-head pu-ink', {}, abilityName(id));
    if (opts.desktop) head.append(el('span', 'pu-ab-tip-key pu-letter', {}, t('ab.key', { key: ABILITY_KEYS[id] })));
    tip.append(
      head,
      el('div', 'pu-ab-tip-desc pu-ink-soft', {}, abilityDesc(id, game.world.waveSystem.currentWaveOneBased)),
      el('div', 'pu-ab-tip-foot pu-ink', {}, t('ab.cooldown', { n: Math.round(v.maxCooldown) }), el('b', '', {}, slotStatus(v))),
    );
    tip.hidden = false;
    // Above the button (beside it for the edge column), kept on screen.
    const b = s.btn.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x = b.left + b.width / 2 - tw / 2;
    let y = b.top - 10 - th;
    if (edge) {
      x = b.left + b.width / 2 < window.innerWidth / 2 ? b.right + 10 : b.left - 10 - tw;
      y = b.bottom - th;
    }
    tip.style.left = `${Math.round(Math.max(6, Math.min(window.innerWidth - tw - 6, x)))}px`;
    tip.style.top = `${Math.round(Math.max(6, y))}px`;
  };
  for (const s of slots) {
    s.btn.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'mouse') showTip(s.id);
    });
    s.btn.addEventListener('pointerleave', () => showTip(null));
    s.btn.addEventListener('focus', () => showTip(s.id));
    s.btn.addEventListener('blur', () => showTip(null));
  }

  // --- aiming --------------------------------------------------------------------------------
  let aiming: AbilityId | null = null;
  let hoverTower = -1;
  let lastPointer: { x: number; y: number } | null = null;
  let down: { x: number; y: number; id: number } | null = null;
  let originTower = -1;
  let synthetic = false;

  const local = (e: PointerEvent | MouseEvent): { x: number; y: number } => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const towersFx = (): FxTower[] => game.world.towers.map((tw) => ({ id: tw.id, x: tw.x, z: tw.z }));
  const insideMap = (p: { x: number; y: number }): boolean => {
    const m = game.map;
    const mx = (p.x - m.fit.offsetX) / m.fit.scale;
    const my = (p.y - m.fit.offsetY) / m.fit.scale;
    return mx >= 0 && my >= 0 && mx <= m.imageW && my <= m.imageH;
  };
  const towerAt = (p: { x: number; y: number }): number => {
    const w = game.world;
    const m = game.map;
    let plot = w.grid.findPlotAt(m.worldXFromScreen(p.x), m.worldZFromScreen(p.y), 1.25);
    if (plot === -1) plot = game.towers.plotAtSprite((p.x - m.fit.offsetX) / m.fit.scale, (p.y - m.fit.offsetY) / m.fit.scale, w.towers);
    return plot === -1 ? -1 : w.grid.getTowerIdAt(plot, 0);
  };
  const preview = (p: { x: number; y: number } | null): void => {
    if (aiming === 'meteor') {
      const at = p ?? { x: game.app.screen.width / 2, y: game.app.screen.height * 0.45 };
      fx.showMeteorAim(game.map.worldXFromScreen(at.x), game.map.worldZFromScreen(at.y), ABILITY_DEFS.meteor.radius, insideMap(at));
    } else if (aiming === 'overcharge') {
      hoverTower = p ? towerAt(p) : -1;
      fx.showTowerHighlights(towersFx(), hoverTower);
      canvas.style.cursor = hoverTower !== -1 ? 'pointer' : 'crosshair';
    }
  };
  const showHint = (): void => {
    if (!aiming) {
      hint.hidden = true;
      return;
    }
    const mouse = opts.desktop;
    const aimText = aiming === 'meteor' ? t(mouse ? 'ab.aimMeteorMouse' : 'ab.aimMeteor') : t(mouse ? 'ab.aimOverchargeMouse' : 'ab.aimOvercharge');
    hint.innerHTML = '';
    // Keyboard / pad in use (navFocus `pu-kbd`): the second line explains the cursor.
    const pad = document.documentElement.classList.contains('pu-kbd');
    hint.append(el('div', 'pu-ink', {}, aimText), el('small', 'pu-ink-soft', {}, t(pad ? 'hero.aimHintPad' : mouse ? 'ab.cancelMouse' : 'ab.cancelTouch')));
    hint.hidden = false;
    placeHint();
  };
  const setAim = (id: AbilityId | null): void => {
    if (id && aiming !== id) {
      opts.onAimStart?.();
      game.setHeroSelected(false);
      // Close the build ring through game2d's own Esc shortcut (its ring / selection are private).
      synthetic = true;
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      synthetic = false;
    }
    aiming = id;
    down = null;
    root.dataset.aiming = id ?? '';
    for (const s of slots) s.btn.classList.toggle('is-aiming', s.id === id);
    if (!id) {
      fx.hideAim();
      fx.hideHighlights();
      hoverTower = -1;
      canvas.style.cursor = '';
    } else {
      if (id === 'meteor') fx.hideHighlights();
      else fx.hideAim();
      preview(lastPointer && insideMap(lastPointer) ? lastPointer : null);
      if (id === 'meteor') canvas.style.cursor = 'crosshair';
    }
    showHint();
  };
  const canAim = (id: AbilityId): boolean => {
    if (!visible || game.end.visible || game.stepper.paused || anySheetOpen()) return false;
    return abilitySlotView(game.world, id).state === 'ready';
  };
  const press = (id: AbilityId): void => {
    if (aiming === id) {
      setAim(null);
      return;
    }
    if (!canAim(id)) {
      const s = slots.find((q) => q.id === id)!;
      s.btn.classList.remove('nope');
      void s.btn.offsetWidth;
      s.btn.classList.add('nope');
      if (!opts.desktop) {
        showTip(id);
        window.setTimeout(() => {
          if (tipFor === id) showTip(null);
        }, 1800);
      }
      return;
    }
    setAim(id);
  };
  for (const s of slots) {
    s.btn.addEventListener('click', (e) => {
      // A pointer press leaves no focus ring behind (keyboard focus keeps it).
      if (e.detail > 0) s.btn.blur();
      press(s.id);
    });
  }

  const commit = (p: { x: number; y: number }): void => {
    if (aiming === 'meteor') {
      if (!insideMap(p)) return;
      // Through the game's command layer (recorded for the replay); same castMeteor2D rules.
      if (game.castAbility('meteor', game.map.worldXFromScreen(p.x), game.map.worldZFromScreen(p.y))) {
        haptics.pulse('tap');
        setAim(null);
      }
    } else if (aiming === 'overcharge') {
      const id = towerAt(p);
      if (id === -1) {
        hint.classList.remove('nudge');
        void hint.offsetWidth;
        hint.classList.add('nudge');
        return;
      }
      originTower = id;
      if (game.castAbility('overcharge')) {
        haptics.pulse('tap');
        setAim(null);
      }
      originTower = -1;
    }
  };

  const stop = (e: Event): void => {
    e.stopPropagation();
    e.preventDefault();
  };
  stage.addEventListener(
    'pointerdown',
    (e) => {
      if (!aiming || e.target !== canvas) return;
      if (e.button === 2) {
        setAim(null);
        stop(e);
        return;
      }
      const p = local(e);
      // The HUD's pause / speed / horn keep working: a tap there drops the aim and goes through.
      if (game.hud.hit(p.x, p.y)) {
        setAim(null);
        return;
      }
      down = { x: p.x, y: p.y, id: e.pointerId };
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
      if (e.pointerType === 'mouse' || down) lastPointer = p;
      if (!aiming) return;
      if (e.pointerType === 'mouse' || (down && down.id === e.pointerId)) preview(p);
      e.stopPropagation();
    },
    { capture: true },
  );
  stage.addEventListener(
    'pointerup',
    (e) => {
      if (!aiming || !down || down.id !== e.pointerId) return;
      const p = local(e);
      down = null;
      stop(e);
      commit(p);
    },
    { capture: true },
  );
  stage.addEventListener('pointercancel', () => (down = null), { capture: true });
  stage.addEventListener('contextmenu', (e) => {
    if (aiming) {
      setAim(null);
      e.preventDefault();
    }
  });
  window.addEventListener(
    'keydown',
    (e) => {
      if (synthetic || anySheetOpen() || game.replaying || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'Escape') {
        // Handled: game2d's Esc must not also open the pause menu.
        if (aiming) {
          setAim(null);
          e.preventDefault();
        }
        return;
      }
      if (e.repeat) return;
      const k = e.key.toUpperCase();
      const id = ABILITY_IDS.find((a) => ABILITY_KEYS[a] === k);
      if (id) {
        e.preventDefault();
        press(id);
      }
    },
    { capture: true },
  );

  // --- sim events → FX ---------------------------------------------------------------------
  let bound: EventBus | null = null;
  let unbind: (() => void)[] = [];
  const bind = (): void => {
    for (const u of unbind) u();
    bound = game.events;
    fx.clear();
    setAim(null);
    unbind = [
      bound.on('abilityTargeted', (e) => {
        if (e.abilityId === 'meteor') fx.meteorCast(e.x, e.z, e.radius, ABILITY_DEFS.meteor.impactDelaySec);
      }),
      bound.on('meteorImpact', (e) => fx.meteorImpact(e.x, e.z, e.radius)),
      bound.on('overchargeActivated', () => fx.overchargeCast(towersFx(), originTower)),
    ];
  };

  // --- per-frame state -----------------------------------------------------------------------
  const sync = (s: Slot, v: AbilitySlotView, paused: boolean): void => {
    const secs = v.state === 'cooldown' ? Math.ceil(v.cooldown) : 0;
    const key = `${v.state}|${secs}|${Math.round(v.cooldownFrac * 200)}|${Math.round(v.activeFrac * 200)}|${paused ? 1 : 0}`;
    if (key === s.key) return;
    const was = s.view?.state;
    s.key = key;
    s.view = v;
    s.btn.dataset.state = v.state;
    s.btn.classList.toggle('paused', paused);
    s.btn.classList.toggle('surging', v.active > 0);
    s.frame.src = v.state === 'ready' && !paused ? KIT.medallionHi : KIT.medallion;
    s.sweep.style.setProperty('--cd', v.state === 'cooldown' ? v.cooldownFrac.toFixed(3) : '0');
    s.surge.style.setProperty('--act', v.activeFrac.toFixed(3));
    s.secs.textContent = v.state === 'cooldown' ? secsLabel(v.cooldown) : '';
    s.btn.disabled = v.state === 'disabled' || v.state === 'over';
    s.btn.setAttribute('aria-label', t('ab.btnAria', { name: abilityName(s.id), state: slotStatus(v) }));
    if (was === 'cooldown' && v.state === 'ready') {
      s.btn.classList.remove('ready-pop');
      void s.btn.offsetWidth;
      s.btn.classList.add('ready-pop');
    }
    if (tipFor === s.id) showTip(s.id);
  };

  let lastDt = 0;
  return {
    frame(dt: number): void {
      if (game.events !== bound) bind();
      const paused = game.stepper.paused;
      const simDt = paused ? 0 : dt * game.stepper.speed;
      lastDt = dt;
      for (const s of slots) sync(s, abilitySlotView(game.world, s.id), paused);
      if (aiming && (!canAimStill(aiming) || paused)) setAim(null);
      if (aiming === 'overcharge') fx.showTowerHighlights(towersFx(), hoverTower);
      fx.update(dt, simDt, game.world.abilitySystem.getOverchargeRemaining(), towersFx());
    },
    setVisible(v: boolean): void {
      if (v === visible) return;
      visible = v;
      root.hidden = !v;
      if (!v) {
        setAim(null);
        showTip(null);
      }
    },
    get aiming() {
      return aiming;
    },
    aim(id: AbilityId | null): void {
      if (id === null) setAim(null);
      else press(id);
    },
    debug(): Record<string, unknown> {
      const r = (e: Element): Rect => {
        const b = e.getBoundingClientRect();
        return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
      };
      return {
        visible,
        aiming,
        bar: r(root),
        spot,
        d,
        box,
        buttons: Object.fromEntries(slots.map((s) => [s.id, { ...r(s.btn), state: s.view?.state ?? null, secs: s.secs.textContent }])),
        hint: hint.hidden ? null : hint.textContent,
        tip: tip.hidden ? null : tip.textContent,
        fx: fx.debug(),
        dt: lastDt,
      };
    },
  };

  function canAimStill(id: AbilityId): boolean {
    return visible && !game.end.visible && abilitySlotView(game.world, id).state === 'ready';
  }
}
