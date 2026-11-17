import type { GameSettings, QualityLevel } from '../core/types.ts';
import { getMusicVolume, setMusicVolume } from '../audio/musicPrefs.ts';
import { UI_ICON_SVGS } from './icons.ts';
import { ResetProgressRow } from './resetProgress.ts';
import { SaveCodePanel, type SaveCodeCallbacks } from './saveCodePanel.ts';

export interface SettingsModalCallbacks {
  onChange: (next: GameSettings) => void;
  onRestart?: () => void;
  onQuitToMenu?: () => void;
  /** Restarts the first-run tour on island 1. */
  onReplayTutorial?: () => void;
  onClose: () => void;
  /** Menu-only "Reset progress" (confirmed in-place). */
  onResetProgress?: () => void;
  /** Menu-only "Save code" (copy / merge-load the campaign save). */
  saveCode?: SaveCodeCallbacks;
}

function settingLabel(text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = 'setting-label';
  el.textContent = text;
  return el;
}

export class SettingsModal {
  private readonly backdrop: HTMLDivElement;
  private readonly volumeInput: HTMLInputElement;
  private readonly volumeLabel: HTMLSpanElement;
  private readonly musicInput: HTMLInputElement;
  private readonly musicLabel: HTMLSpanElement;
  private readonly muteInput: HTMLInputElement;
  private readonly shakeInput: HTMLInputElement;
  private readonly dmgInput: HTMLInputElement;
  private readonly hapticsInput: HTMLInputElement;
  private readonly qualityBtns = new Map<QualityLevel, HTMLButtonElement>();
  private readonly restartBtn: HTMLButtonElement;
  private readonly quitBtn: HTMLButtonElement;
  private readonly closeBtn: HTMLButtonElement;
  private readonly resetRow: ResetProgressRow | null;
  private readonly saveCodePanel: SaveCodePanel | null;
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
    card.className = 'modal-card settings-card gx gx-slate';

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = 'Settings';

    // Master volume slider
    const volRow = document.createElement('label');
    volRow.className = 'setting-row';
    const volLeft = document.createElement('span');
    volLeft.className = 'setting-label';
    volLeft.innerHTML = `<span class="setting-icon">${UI_ICON_SVGS.sound}</span>Volume`;
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

    // Music volume (own localStorage key, see audio/musicPrefs)
    const musicRow = document.createElement('label');
    musicRow.className = 'setting-row';
    musicRow.append(settingLabel('Music'));
    this.musicLabel = document.createElement('span');
    this.musicLabel.className = 'setting-val';
    this.musicInput = document.createElement('input');
    this.musicInput.type = 'range';
    this.musicInput.min = '0';
    this.musicInput.max = '100';
    this.musicInput.className = 'setting-slider';
    this.musicInput.setAttribute('data-testid', 'music-volume');
    this.musicInput.addEventListener('input', () => {
      setMusicVolume(Number(this.musicInput.value) / 100);
      this.syncInputs();
    });
    const musicWrap = document.createElement('div');
    musicWrap.className = 'setting-slider-wrap';
    musicWrap.append(this.musicInput, this.musicLabel);
    musicRow.append(musicWrap);

    // Mute toggle
    const muteRow = document.createElement('label');
    muteRow.className = 'setting-row setting-toggle';
    this.muteInput = document.createElement('input');
    this.muteInput.type = 'checkbox';
    this.muteInput.addEventListener('change', () => {
      this.settings = { ...this.settings, muted: this.muteInput.checked };
      callbacks.onChange(this.settings);
    });
    muteRow.append(settingLabel('Mute'), this.muteInput);

    // Camera Shake toggle
    const shakeRow = document.createElement('label');
    shakeRow.className = 'setting-row setting-toggle';
    this.shakeInput = document.createElement('input');
    this.shakeInput.type = 'checkbox';
    this.shakeInput.addEventListener('change', () => {
      this.settings = { ...this.settings, cameraShake: this.shakeInput.checked };
      callbacks.onChange(this.settings);
    });
    shakeRow.append(settingLabel('Camera shake'), this.shakeInput);

    // Floating Damage Numbers toggle
    const dmgRow = document.createElement('label');
    dmgRow.className = 'setting-row setting-toggle';
    this.dmgInput = document.createElement('input');
    this.dmgInput.type = 'checkbox';
    this.dmgInput.addEventListener('change', () => {
      this.settings = { ...this.settings, damageNumbers: this.dmgInput.checked };
      callbacks.onChange(this.settings);
    });
    dmgRow.append(settingLabel('Damage numbers'), this.dmgInput);

    // Quality setting (Auto / High / Medium / Low)
    const qualRow = document.createElement('div');
    qualRow.className = 'setting-row';
    const qualLabel = document.createElement('span');
    qualLabel.className = 'setting-label';
    qualLabel.textContent = 'Quality';
    const qualWrap = document.createElement('div');
    qualWrap.className = 'setting-seg';
    const setQuality = (quality: QualityLevel): void => {
      this.settings = { ...this.settings, quality };
      this.syncInputs();
      callbacks.onChange(this.settings);
    };
    const qualityChoices: Array<[QualityLevel, string]> = [
      ['auto', 'Auto'],
      ['high', 'High'],
      ['medium', 'Med'],
      ['low', 'Low'],
    ];
    for (const [value, text] of qualityChoices) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'setting-seg-btn gx gx-slate-btn';
      btn.textContent = text;
      btn.setAttribute('data-quality', value);
      btn.addEventListener('click', () => setQuality(value));
      this.qualityBtns.set(value, btn);
      qualWrap.append(btn);
    }
    qualRow.append(qualLabel, qualWrap);

    // Haptics toggle (only where the Vibration API exists)
    const hapticsRow = document.createElement('label');
    hapticsRow.className = 'setting-row setting-toggle';
    this.hapticsInput = document.createElement('input');
    this.hapticsInput.type = 'checkbox';
    this.hapticsInput.addEventListener('change', () => {
      this.settings = { ...this.settings, haptics: this.hapticsInput.checked };
      callbacks.onChange(this.settings);
    });
    hapticsRow.append(settingLabel('Haptics'), this.hapticsInput);
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
      hapticsRow.classList.add('hidden');
    }

    let tutorialRow: HTMLButtonElement | null = null;
    if (callbacks.onReplayTutorial) {
      tutorialRow = document.createElement('button');
      tutorialRow.type = 'button';
      tutorialRow.className = 'btn-secondary gx gx-slate-btn setting-tutorial-btn';
      tutorialRow.setAttribute('data-testid', 'btn-replay-tutorial');
      tutorialRow.innerHTML = '<span class="btn-label">Replay tutorial</span>';
      tutorialRow.addEventListener('click', () => callbacks.onReplayTutorial?.());
    }

    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    this.restartBtn = document.createElement('button');
    this.restartBtn.type = 'button';
    this.restartBtn.className = 'btn-secondary gx gx-slate-btn';
    this.restartBtn.innerHTML = `<span class="btn-icon">${UI_ICON_SVGS.restart}</span><span class="btn-label">Restart</span>`;
    this.restartBtn.addEventListener('click', () => callbacks.onRestart?.());
    if (!callbacks.onRestart) this.restartBtn.classList.add('hidden');

    this.quitBtn = document.createElement('button');
    this.quitBtn.type = 'button';
    this.quitBtn.className = 'btn-secondary gx gx-slate-btn';
    this.quitBtn.innerHTML = `<span class="btn-icon">${UI_ICON_SVGS.home}</span><span class="btn-label">Menu</span>`;
    this.quitBtn.addEventListener('click', () => callbacks.onQuitToMenu?.());
    if (!callbacks.onQuitToMenu) this.quitBtn.classList.add('hidden');

    this.closeBtn = document.createElement('button');
    this.closeBtn.type = 'button';
    this.closeBtn.className = 'btn-primary gx gx-green';
    this.closeBtn.textContent = 'Back';
    this.closeBtn.addEventListener('click', () => callbacks.onClose());

    actions.append(this.restartBtn, this.quitBtn, this.closeBtn);
    card.append(title, volRow, musicRow, muteRow, shakeRow, dmgRow, hapticsRow, qualRow);
    if (tutorialRow) card.appendChild(tutorialRow);
    card.appendChild(actions);
    this.backdrop.appendChild(card);
    parent.appendChild(this.backdrop);
    this.syncInputs();

    // Menu-only "Reset progress" (campaign area; kept at the end to stay clear of settings rows).
    this.saveCodePanel = callbacks.saveCode ? new SaveCodePanel(callbacks.saveCode) : null;
    if (this.saveCodePanel) card.appendChild(this.saveCodePanel.el);
    const onReset = callbacks.onResetProgress;
    this.resetRow = onReset ? new ResetProgressRow(onReset) : null;
    if (this.resetRow) card.appendChild(this.resetRow.el);
  }

  private syncInputs(): void {
    const pct = Math.round(this.settings.masterVolume * 100);
    this.volumeInput.value = String(pct);
    this.volumeLabel.textContent = `${pct}%`;
    this.volumeInput.style.setProperty('--pct', `${pct}%`);
    const musicPct = Math.round(getMusicVolume() * 100);
    this.musicInput.value = String(musicPct);
    this.musicLabel.textContent = `${musicPct}%`;
    this.musicInput.style.setProperty('--pct', `${musicPct}%`);
    this.muteInput.checked = this.settings.muted;
    this.shakeInput.checked = this.settings.cameraShake;
    this.dmgInput.checked = this.settings.damageNumbers;
    this.hapticsInput.checked = this.settings.haptics;
    for (const [value, btn] of this.qualityBtns) {
      btn.classList.toggle('active', this.settings.quality === value);
    }
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
    this.resetRow?.setVisible(open && !inGame);
    this.saveCodePanel?.setVisible(open && !inGame);
    this.backdrop.classList.toggle('hidden', !open);
  }

  isOpen(): boolean {
    return this.open;
  }

  dispose(): void {
    this.backdrop.remove();
  }
}
