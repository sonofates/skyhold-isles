import type { GameSettings, QualityLevel } from '../core/types.ts';

export interface SettingsModalCallbacks {
  onChange: (next: GameSettings) => void;
  onRestart?: () => void;
  onQuitToMenu?: () => void;
  onClose: () => void;
}

export class SettingsModal {
  private readonly backdrop: HTMLDivElement;
  private readonly volumeInput: HTMLInputElement;
  private readonly volumeLabel: HTMLSpanElement;
  private readonly muteInput: HTMLInputElement;
  private readonly shakeInput: HTMLInputElement;
  private readonly dmgInput: HTMLInputElement;
  private readonly qualityHighBtn: HTMLButtonElement;
  private readonly qualityLowBtn: HTMLButtonElement;
  private readonly restartBtn: HTMLButtonElement;
  private readonly quitBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private settings: GameSettings;
  private open = false;

  constructor(parent: HTMLElement, initial: GameSettings, callbacks: SettingsModalCallbacks) {
    this.settings = { ...initial };

    this.backdrop = document.createElement('div');
    this.backdrop.className = 'modal-backdrop hidden ui-interactive';
    this.backdrop.addEventListener('click', (e) => {
      if (e.target === this.backdrop) callbacks.onClose();
    });

    const card = document.createElement('div');
    card.className = 'modal-card settings-card';

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = 'Game Settings';

    // Master volume slider
    const volRow = document.createElement('label');
    volRow.className = 'setting-row';
    const volLeft = document.createElement('span');
    volLeft.textContent = 'Master Volume';
    this.volumeLabel = document.createElement('span');
    this.volumeLabel.className = 'setting-val';
    this.volumeInput = document.createElement('input');
    this.volumeInput.type = 'range';
    this.volumeInput.min = '0';
    this.volumeInput.max = '100';
    this.volumeInput.className = 'setting-slider';
    this.volumeInput.addEventListener('input', () => {
      this.settings = { ...this.settings, masterVolume: Number(this.volumeInput.value) / 100 };
      this.syncInputs();
      callbacks.onChange(this.settings);
    });
    const volWrap = document.createElement('div');
    volWrap.className = 'setting-slider-wrap';
    volWrap.append(this.volumeInput, this.volumeLabel);
    volRow.append(volLeft, volWrap);

    // Mute toggle
    const muteRow = document.createElement('label');
    muteRow.className = 'setting-row setting-toggle';
    this.muteInput = document.createElement('input');
    this.muteInput.type = 'checkbox';
    this.muteInput.addEventListener('change', () => {
      this.settings = { ...this.settings, muted: this.muteInput.checked };
      callbacks.onChange(this.settings);
    });
    muteRow.append('Mute Audio', this.muteInput);

    // Camera Shake toggle
    const shakeRow = document.createElement('label');
    shakeRow.className = 'setting-row setting-toggle';
    this.shakeInput = document.createElement('input');
    this.shakeInput.type = 'checkbox';
    this.shakeInput.addEventListener('change', () => {
      this.settings = { ...this.settings, cameraShake: this.shakeInput.checked };
      callbacks.onChange(this.settings);
    });
    shakeRow.append('Camera Shake', this.shakeInput);

    // Floating Damage Numbers toggle
    const dmgRow = document.createElement('label');
    dmgRow.className = 'setting-row setting-toggle';
    this.dmgInput = document.createElement('input');
    this.dmgInput.type = 'checkbox';
    this.dmgInput.addEventListener('change', () => {
      this.settings = { ...this.settings, damageNumbers: this.dmgInput.checked };
      callbacks.onChange(this.settings);
    });
    dmgRow.append('Damage Numbers', this.dmgInput);

    // Quality setting (High vs Low)
    const qualRow = document.createElement('div');
    qualRow.className = 'setting-row';
    const qualLabel = document.createElement('span');
    qualLabel.textContent = 'Quality';
    const qualWrap = document.createElement('div');
    qualWrap.className = 'setting-seg';
    const setQuality = (quality: QualityLevel): void => {
      this.settings = { ...this.settings, quality };
      this.syncInputs();
      callbacks.onChange(this.settings);
    };
    this.qualityHighBtn = document.createElement('button');
    this.qualityHighBtn.type = 'button';
    this.qualityHighBtn.className = 'setting-seg-btn';
    this.qualityHighBtn.textContent = 'High';
    this.qualityHighBtn.addEventListener('click', () => setQuality('high'));
    this.qualityLowBtn = document.createElement('button');
    this.qualityLowBtn.type = 'button';
    this.qualityLowBtn.className = 'setting-seg-btn';
    this.qualityLowBtn.textContent = 'Low';
    this.qualityLowBtn.addEventListener('click', () => setQuality('low'));
    qualWrap.append(this.qualityHighBtn, this.qualityLowBtn);
    qualRow.append(qualLabel, qualWrap);

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    this.restartBtn = document.createElement('button');
    this.restartBtn.type = 'button';
    this.restartBtn.className = 'btn-secondary';
    this.restartBtn.textContent = 'Restart Level';
    this.restartBtn.addEventListener('click', () => callbacks.onRestart?.());
    if (!callbacks.onRestart) this.restartBtn.classList.add('hidden');

    this.quitBtn = document.createElement('button');
    this.quitBtn.type = 'button';
    this.quitBtn.className = 'btn-secondary';
    this.quitBtn.textContent = 'Main Menu';
    this.quitBtn.addEventListener('click', () => callbacks.onQuitToMenu?.());
    if (!callbacks.onQuitToMenu) this.quitBtn.classList.add('hidden');

    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'btn-primary';
    this.closeBtn.textContent = 'Resume';
    this.closeBtn.addEventListener('click', () => callbacks.onClose());

    actions.append(this.restartBtn, this.quitBtn, this.closeBtn);
    card.append(title, volRow, muteRow, shakeRow, dmgRow, qualRow, actions);
    this.backdrop.appendChild(card);
    parent.appendChild(this.backdrop);
    this.syncInputs();
  }

  private syncInputs(): void {
    const pct = Math.round(this.settings.masterVolume * 100);
    this.volumeInput.value = String(pct);
    this.volumeLabel.textContent = `${pct}%`;
    this.muteInput.checked = this.settings.muted;
    this.shakeInput.checked = this.settings.cameraShake;
    this.dmgInput.checked = this.settings.damageNumbers;
    this.qualityHighBtn.classList.toggle('active', this.settings.quality === 'high');
    this.qualityLowBtn.classList.toggle('active', this.settings.quality === 'low');
  }

  setOpen(open: boolean, settings?: GameSettings, inGame = true): void {
    this.open = open;
    if (settings) {
      this.settings = { ...settings };
      this.syncInputs();
    }
    this.restartBtn.classList.toggle('hidden', !inGame);
    this.quitBtn.classList.toggle('hidden', !inGame);
    this.closeBtn.textContent = inGame ? 'Back' : 'Done';
    this.backdrop.classList.toggle('hidden', !open);
  }

  isOpen(): boolean {
    return this.open;
  }

  dispose(): void {
    this.backdrop.remove();
  }
}
