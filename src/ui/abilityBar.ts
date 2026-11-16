import type { AbilityId } from '../core/types.ts';
import { ABILITY_DEFS, ABILITY_IDS } from '../data/abilities.ts';
import { UI_ICON_SVGS } from './icons.ts';

export interface AbilityBarState {
  readonly activeAbility: AbilityId | null;
  readonly meteorCooldown: number;
  readonly meteorMaxCooldown: number;
  readonly overchargeCooldown: number;
  readonly overchargeMaxCooldown: number;
  readonly overchargeRemaining: number;
  readonly overchargeDuration?: number;
  readonly disabled?: boolean;
}

interface AbilitySlotEls {
  readonly btn: HTMLButtonElement;
  readonly statusEl: HTMLSpanElement;
  readonly fillEl: HTMLDivElement;
  readonly cdBadgeEl: HTMLSpanElement;
}

export class AbilityBar {
  private readonly rootEl: HTMLDivElement;
  private readonly slots = new Map<AbilityId, AbilitySlotEls>();
  private lastStateKey = '';

  constructor(parent: HTMLElement, onActivateAbility: (id: AbilityId) => void) {
    this.rootEl = document.createElement('div');
    this.rootEl.className = 'ability-bar ui-interactive';

    const shortLabels: Record<AbilityId, string> = {
      meteor: 'Meteor',
      overcharge: 'Overcharge',
    };

    for (let i = 0; i < ABILITY_IDS.length; i++) {
      const id = ABILITY_IDS[i];
      const def = ABILITY_DEFS[id];

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ability-card gx gx-slate-btn is-ready';
      btn.title = `${def.name} (${def.hotkey}) — ${def.shortDesc}`;
      btn.setAttribute('data-ability', id);
      btn.setAttribute('data-testid', `btn-ability-${id}`);

      const fillEl = document.createElement('div');
      fillEl.className = 'ability-cd-fill';

      const hotkeyEl = document.createElement('span');
      hotkeyEl.className = 'ability-hotkey desktop-only';
      hotkeyEl.textContent = def.hotkey;

      const cdBadgeEl = document.createElement('span');
      cdBadgeEl.className = 'ability-cd-badge hidden';

      const iconEl = document.createElement('div');
      iconEl.className = 'ability-icon';
      iconEl.innerHTML = id === 'meteor' ? UI_ICON_SVGS.meteor : UI_ICON_SVGS.overcharge;

      const nameEl = document.createElement('div');
      nameEl.className = 'ability-name';
      nameEl.textContent = shortLabels[id];

      const statusEl = document.createElement('span');
      statusEl.className = 'ability-status';
      statusEl.textContent = 'Ready';

      btn.append(fillEl, hotkeyEl, cdBadgeEl, iconEl, nameEl, statusEl);
      btn.addEventListener('click', () => onActivateAbility(id));

      this.slots.set(id, { btn, statusEl, fillEl, cdBadgeEl });
      this.rootEl.appendChild(btn);
    }

    parent.appendChild(this.rootEl);
  }

  update(state: AbilityBarState): void {
    const meteorCeil = Math.max(0, Math.ceil(state.meteorCooldown));
    const overchargeCeil = Math.max(0, Math.ceil(state.overchargeCooldown));
    const buffCeil = Math.max(0, Math.ceil(state.overchargeRemaining));
    const meteorPct =
      state.meteorMaxCooldown > 0
        ? Math.max(0, Math.min(100, Math.round((state.meteorCooldown / state.meteorMaxCooldown) * 100)))
        : 0;
    const overchargePct =
      state.overchargeMaxCooldown > 0
        ? Math.max(
            0,
            Math.min(100, Math.round((state.overchargeCooldown / state.overchargeMaxCooldown) * 100)),
          )
        : 0;
    const overchargeDuration = state.overchargeDuration ?? ABILITY_DEFS.overcharge.durationSec;
    const buffPct =
      overchargeDuration > 0
        ? Math.max(0, Math.min(100, Math.round((state.overchargeRemaining / overchargeDuration) * 100)))
        : 0;
    const disabled = Boolean(state.disabled);

    const key = `${state.activeAbility ?? 'none'}|${meteorCeil}|${meteorPct}|${overchargeCeil}|${overchargePct}|${buffCeil}|${buffPct}|${disabled ? 1 : 0}`;
    if (key === this.lastStateKey) return;
    this.lastStateKey = key;

    this.syncSlot('meteor', {
      cooldown: state.meteorCooldown,
      cooldownCeil: meteorCeil,
      cooldownPct: meteorPct,
      isTargeting: state.activeAbility === 'meteor',
      isBuffActive: false,
      buffCeil: 0,
      buffPct: 0,
      disabled,
    });

    this.syncSlot('overcharge', {
      cooldown: state.overchargeCooldown,
      cooldownCeil: overchargeCeil,
      cooldownPct: overchargePct,
      isTargeting: false,
      isBuffActive: state.overchargeRemaining > 0,
      buffCeil,
      buffPct,
      disabled,
    });
  }

  private syncSlot(
    id: AbilityId,
    view: {
      cooldown: number;
      cooldownCeil: number;
      cooldownPct: number;
      isTargeting: boolean;
      isBuffActive: boolean;
      buffCeil: number;
      buffPct: number;
      disabled: boolean;
    },
  ): void {
    const slot = this.slots.get(id);
    if (!slot) return;

    const onCooldown = view.cooldown > 0;
    const isReady = !onCooldown && !view.disabled;

    slot.btn.disabled = onCooldown || view.disabled;
    slot.btn.classList.toggle('is-ready', isReady);
    slot.btn.classList.toggle('on-cooldown', onCooldown);
    slot.btn.classList.toggle('is-disabled', view.disabled);
    slot.btn.classList.toggle('is-targeting', view.isTargeting && isReady);
    slot.btn.classList.toggle('is-buff-active', view.isBuffActive);

    if (view.isBuffActive) {
      slot.fillEl.style.setProperty('--cd', String(view.buffPct));
      slot.cdBadgeEl.textContent = onCooldown ? `${view.cooldownCeil}s` : '';
      slot.cdBadgeEl.classList.toggle('hidden', !onCooldown);
      slot.statusEl.textContent = `${view.buffCeil}s`;
    } else if (onCooldown) {
      slot.fillEl.style.setProperty('--cd', String(view.cooldownPct));
      slot.cdBadgeEl.textContent = `${view.cooldownCeil}s`;
      slot.cdBadgeEl.classList.remove('hidden');
      slot.statusEl.textContent = `${view.cooldownCeil}s`;
    } else if (view.isTargeting) {
      slot.fillEl.style.setProperty('--cd', '0');
      slot.cdBadgeEl.textContent = '';
      slot.cdBadgeEl.classList.add('hidden');
      slot.statusEl.textContent = 'Aim';
    } else {
      slot.fillEl.style.setProperty('--cd', '0');
      slot.cdBadgeEl.textContent = '';
      slot.cdBadgeEl.classList.add('hidden');
      slot.statusEl.textContent = 'Ready';
    }
  }

  setVisible(visible: boolean): void {
    this.rootEl.classList.toggle('hidden', !visible);
  }

  dispose(): void {
    this.rootEl.remove();
  }
}
