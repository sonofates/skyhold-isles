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

const STYLE_ELEMENT_ID = 'skyhold-ability-bar-styles';

function ensureAbilityBarStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ELEMENT_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ELEMENT_ID;
  style.textContent = `
.ability-bar {
  position: absolute;
  bottom: 14px;
  left: 14px;
  display: flex;
  align-items: stretch;
  gap: 8px;
  padding: 8px;
  background: var(--ui-bg, rgba(248, 244, 232, 0.94));
  border: 1px solid var(--ui-border, rgba(72, 69, 115, 0.16));
  border-radius: 20px;
  box-shadow: var(--ui-shadow, 0 10px 28px rgba(72, 69, 115, 0.18));
  backdrop-filter: blur(10px);
  z-index: 20;
}

.ability-card {
  position: relative;
  overflow: hidden;
  min-width: 98px;
  padding: 7px 9px 6px;
  border-radius: 14px;
  border: 2px solid rgba(72, 69, 115, 0.14);
  background: var(--pal-cream, #f8f4e8);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  cursor: pointer;
  transition: transform 0.12s ease, border-color 0.14s ease, box-shadow 0.14s ease, opacity 0.14s ease;
}

.ability-card.is-ready:hover {
  transform: translateY(-2px);
  border-color: var(--pal-gold, #f6bd41);
  box-shadow: 0 5px 12px rgba(246, 189, 65, 0.28);
}

.ability-card.is-targeting {
  border-color: var(--pal-coral, #e85d5d);
  background: #fff7f4;
  transform: translateY(-4px);
  box-shadow: 0 0 0 3px rgba(232, 93, 93, 0.25), 0 8px 18px rgba(232, 93, 93, 0.34);
}

.ability-card.is-buff-active {
  border-color: var(--pal-gold, #f6bd41);
  background: #fffbef;
  box-shadow: 0 0 0 3px rgba(246, 189, 65, 0.28), 0 6px 16px rgba(246, 189, 65, 0.32);
}

.ability-card.on-cooldown {
  opacity: 0.72;
  cursor: not-allowed;
}

.ability-card.is-disabled:not(.on-cooldown) {
  opacity: 0.5;
  cursor: not-allowed;
}

.ability-cd-fill {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 0%;
  background: rgba(72, 69, 115, 0.2);
  pointer-events: none;
  transition: height 0.1s linear;
}

.ability-card.is-buff-active .ability-cd-fill {
  background: linear-gradient(180deg, rgba(246, 189, 65, 0.12), rgba(246, 189, 65, 0.32));
}

.ability-hotkey {
  position: absolute;
  top: 4px;
  left: 6px;
  z-index: 2;
  font-size: 10px;
  font-weight: 800;
  color: var(--ui-dark-soft, rgba(72, 69, 115, 0.72));
}

.ability-cd-badge {
  position: absolute;
  top: 4px;
  right: 5px;
  z-index: 2;
  padding: 1px 5px;
  border-radius: 999px;
  background: var(--pal-indigo, #484573);
  color: var(--pal-cream, #f8f4e8);
  font-family: var(--font-mono, monospace);
  font-size: 9.5px;
  font-weight: 800;
  line-height: 1.25;
}

.ability-cd-badge.hidden {
  display: none;
}

.ability-icon {
  position: relative;
  z-index: 1;
  width: 28px;
  height: 28px;
}

.ability-icon svg {
  width: 100%;
  height: 100%;
}

.ability-name {
  position: relative;
  z-index: 1;
  font-size: 11px;
  font-weight: 800;
  line-height: 1.1;
  white-space: nowrap;
}

.ability-status {
  position: relative;
  z-index: 1;
  font-size: 10px;
  font-weight: 800;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(126, 200, 80, 0.22);
  color: var(--pal-foliage-dark, #4d9440);
  white-space: nowrap;
}

.ability-card.is-targeting .ability-status {
  background: rgba(232, 93, 93, 0.18);
  color: #a92f2f;
}

.ability-card.is-buff-active .ability-status {
  background: rgba(246, 189, 65, 0.34);
  color: #7d5200;
}

.ability-card.on-cooldown .ability-status {
  background: rgba(72, 69, 115, 0.12);
  color: var(--ui-dark-soft, rgba(72, 69, 115, 0.72));
}

@media (max-width: 1080px) {
  .ability-bar {
    bottom: 108px;
    left: 10px;
    padding: 6px;
    gap: 6px;
  }

  .ability-card {
    min-width: 86px;
    padding: 6px 7px 5px;
  }
}
`;
  document.head.appendChild(style);
}

export class AbilityBar {
  private readonly rootEl: HTMLDivElement;
  private readonly slots = new Map<AbilityId, AbilitySlotEls>();
  private lastStateKey = '';

  constructor(parent: HTMLElement, onActivateAbility: (id: AbilityId) => void) {
    ensureAbilityBarStyles();

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
      btn.className = 'ability-card is-ready';
      btn.title = `${def.name} (${def.hotkey}) — ${def.shortDesc}`;
      btn.setAttribute('data-ability', id);
      btn.setAttribute('data-testid', `btn-ability-${id}`);

      const fillEl = document.createElement('div');
      fillEl.className = 'ability-cd-fill';

      const hotkeyEl = document.createElement('span');
      hotkeyEl.className = 'ability-hotkey';
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
      slot.fillEl.style.height = `${view.buffPct}%`;
      slot.cdBadgeEl.textContent = onCooldown ? `${view.cooldownCeil}s` : '';
      slot.cdBadgeEl.classList.toggle('hidden', !onCooldown);
      slot.statusEl.textContent = `Active ${view.buffCeil}s`;
    } else if (onCooldown) {
      slot.fillEl.style.height = `${view.cooldownPct}%`;
      slot.cdBadgeEl.textContent = `${view.cooldownCeil}s`;
      slot.cdBadgeEl.classList.remove('hidden');
      slot.statusEl.textContent = `${view.cooldownCeil}s`;
    } else if (view.isTargeting) {
      slot.fillEl.style.height = '0%';
      slot.cdBadgeEl.textContent = '';
      slot.cdBadgeEl.classList.add('hidden');
      slot.statusEl.textContent = 'Aim Target';
    } else {
      slot.fillEl.style.height = '0%';
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
