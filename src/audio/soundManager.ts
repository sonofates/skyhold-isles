import type { EventBus } from '../core/eventBus.ts';
import type { GameSettings, TowerType } from '../core/types.ts';

export class SoundManager {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private masterGain: GainNode | null = null;
  private settings: GameSettings;
  private readonly lastPlayedMs = new Map<string, number>();

  constructor(initialSettings: GameSettings) {
    this.settings = { ...initialSettings };
  }

  unlock(): void {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.applyVolume();
      this.masterGain.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  updateSettings(next: GameSettings): void {
    this.settings = { ...next };
    this.applyVolume();
  }

  private applyVolume(): void {
    if (!this.masterGain || !this.ctx) return;
    const gain = this.settings.muted ? 0 : Math.max(0, Math.min(1, this.settings.masterVolume)) * 0.45;
    this.masterGain.gain.setValueAtTime(gain, this.ctx.currentTime);
  }

  private canPlay(tag: string, minIntervalMs: number): boolean {
    if (!this.ctx || !this.masterGain || this.ctx.state !== 'running') return false;
    if (this.settings.muted || this.settings.masterVolume <= 0.01) return false;
    const now = performance.now();
    const prev = this.lastPlayedMs.get(tag) ?? 0;
    if (now - prev < minIntervalMs) return false;
    this.lastPlayedMs.set(tag, now);
    return true;
  }

  private createNoiseBuffer(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.4);
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private tone(
    type: OscillatorType,
    startFreq: number,
    endFreq: number,
    durationSec: number,
    volume: number,
    delaySec = 0,
  ): void {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime + delaySec;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now + durationSec);
    g.gain.setValueAtTime(0.0001, now);
    g.gain.linearRampToValueAtTime(volume, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);
    osc.connect(g);
    g.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + durationSec + 0.02);
  }

  private noiseBurst(filterFreq: number, durationSec: number, volume: number): void {
    if (!this.ctx || !this.masterGain || !this.noiseBuffer) return;
    const now = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(filterFreq, now);
    filter.frequency.exponentialRampToValueAtTime(Math.max(80, filterFreq * 0.2), now + durationSec);

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(volume, now);
    g.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

    src.connect(filter);
    filter.connect(g);
    g.connect(this.masterGain);
    src.start(now);
    src.stop(now + durationSec + 0.02);
  }

  playTowerBuild(): void {
    if (!this.canPlay('build', 40)) return;
    this.tone('triangle', 150, 85, 0.14, 0.32);
    this.tone('sine', 330, 495, 0.12, 0.16, 0.04);
  }

  playTowerUpgrade(): void {
    if (!this.canPlay('upgrade', 50)) return;
    this.tone('triangle', 392, 523, 0.11, 0.22, 0);
    this.tone('triangle', 523, 659, 0.12, 0.22, 0.07);
    this.tone('sine', 659, 784, 0.18, 0.2, 0.14);
  }

  playTowerSell(): void {
    if (!this.canPlay('sell', 50)) return;
    this.tone('sine', 980, 1280, 0.08, 0.18, 0);
    this.tone('sine', 740, 880, 0.11, 0.16, 0.06);
  }

  playFire(type: TowerType): void {
    switch (type) {
      case 'archer':
        if (!this.canPlay('fire_archer', 65)) return;
        this.tone('triangle', 540, 210, 0.07, 0.14);
        break;
      case 'cannon':
        if (!this.canPlay('fire_cannon', 90)) return;
        this.tone('sine', 160, 46, 0.22, 0.34);
        this.noiseBurst(900, 0.16, 0.22);
        break;
      case 'frost':
        if (!this.canPlay('fire_frost', 80)) return;
        this.tone('sine', 920, 1340, 0.11, 0.12);
        break;
      case 'tesla':
        if (!this.canPlay('fire_tesla', 85)) return;
        this.tone('sawtooth', 780, 240, 0.11, 0.14);
        this.noiseBurst(2800, 0.08, 0.12);
        break;
      case 'mortar':
        if (!this.canPlay('fire_mortar', 140)) return;
        this.tone('sine', 110, 38, 0.28, 0.36);
        this.noiseBurst(620, 0.22, 0.25);
        break;
      case 'ballista':
        if (!this.canPlay('fire_ballista', 110)) return;
        this.tone('triangle', 300, 90, 0.16, 0.26);
        this.tone('sawtooth', 1400, 500, 0.06, 0.07);
        this.noiseBurst(3200, 0.07, 0.1);
        break;
      case 'beacon':
        break;
    }
  }

  playImpact(type: TowerType): void {
    if (type === 'cannon' || type === 'mortar') {
      if (!this.canPlay(`impact_${type}`, 90)) return;
      this.tone('sine', type === 'mortar' ? 105 : 130, 34, type === 'mortar' ? 0.34 : 0.22, 0.36);
      this.noiseBurst(type === 'mortar' ? 560 : 820, type === 'mortar' ? 0.3 : 0.2, 0.3);
    } else if (type === 'frost') {
      if (!this.canPlay('impact_frost', 110)) return;
      this.tone('sine', 1180, 1560, 0.09, 0.09);
    } else if (type === 'ballista') {
      if (!this.canPlay('impact_ballista', 90)) return;
      this.tone('square', 220, 70, 0.07, 0.12);
      this.noiseBurst(1800, 0.06, 0.12);
    }
  }

  playBeaconPulse(): void {
    if (!this.canPlay('beacon_pulse', 700)) return;
    this.tone('sine', 880, 1175, 0.18, 0.05);
    this.tone('sine', 1320, 1568, 0.2, 0.03, 0.06);
  }

  playGoldCoin(): void {
    if (!this.canPlay('coin', 95)) return;
    this.tone('sine', 1046, 1396, 0.08, 0.12);
  }

  playWaveStart(): void {
    if (!this.canPlay('wave', 200)) return;
    this.tone('triangle', 261, 261, 0.15, 0.2, 0);
    this.tone('triangle', 329, 329, 0.15, 0.2, 0.09);
    this.tone('triangle', 392, 523, 0.26, 0.22, 0.18);
  }

  playEnemyLeak(): void {
    if (!this.canPlay('leak', 120)) return;
    this.tone('sawtooth', 190, 95, 0.2, 0.2);
  }

  playOutcome(won: boolean): void {
    if (!this.canPlay('outcome', 400)) return;
    if (won) {
      this.tone('triangle', 392, 392, 0.14, 0.22, 0);
      this.tone('triangle', 494, 494, 0.14, 0.22, 0.1);
      this.tone('triangle', 587, 587, 0.14, 0.22, 0.2);
      this.tone('triangle', 784, 784, 0.36, 0.25, 0.3);
    } else {
      this.tone('sawtooth', 260, 220, 0.2, 0.18, 0);
      this.tone('sawtooth', 200, 140, 0.36, 0.2, 0.18);
    }
  }

  playAbilityTarget(): void {
    if (!this.canPlay('ability_target', 80)) return;
    this.tone('triangle', 640, 220, 0.24, 0.16, 0);
    this.noiseBurst(1600, 0.2, 0.12);
  }

  playMeteorImpact(): void {
    if (!this.canPlay('meteor_impact', 150)) return;
    this.tone('sine', 125, 32, 0.42, 0.4, 0);
    this.tone('triangle', 220, 55, 0.28, 0.22, 0.02);
    this.noiseBurst(850, 0.36, 0.32);
  }

  playOvercharge(): void {
    if (!this.canPlay('overcharge', 200)) return;
    this.tone('triangle', 330, 660, 0.16, 0.18, 0);
    this.tone('sine', 495, 990, 0.2, 0.16, 0.05);
    this.tone('sine', 660, 1320, 0.24, 0.15, 0.1);
  }

  playBossPulse(): void {
    if (!this.canPlay('boss_pulse', 200)) return;
    this.tone('sawtooth', 320, 72, 0.32, 0.18, 0);
    this.tone('sine', 160, 48, 0.36, 0.24, 0.03);
    this.noiseBurst(1200, 0.16, 0.14);
  }

  playBossSummon(): void {
    if (!this.canPlay('boss_summon', 200)) return;
    this.tone('sawtooth', 146, 196, 0.22, 0.16, 0);
    this.tone('triangle', 220, 293, 0.28, 0.18, 0.1);
  }

  playEnemySplit(): void {
    if (!this.canPlay('enemy_split', 75)) return;
    this.tone('triangle', 480, 760, 0.08, 0.13, 0);
    this.tone('sine', 720, 1080, 0.09, 0.11, 0.04);
  }

  bindEvents(events: EventBus): () => void {
    const unsubs = [
      events.on('towerBuilt', () => this.playTowerBuild()),
      events.on('towerUpgraded', () => this.playTowerUpgrade()),
      events.on('towerSold', () => this.playTowerSell()),
      events.on('beaconPulse', () => this.playBeaconPulse()),
      events.on('towerFired', (e) => this.playFire(e.type)),
      events.on('projectileImpact', (e) => this.playImpact(e.towerType)),
      events.on('enemyKilled', () => this.playGoldCoin()),
      events.on('enemyLeaked', () => this.playEnemyLeak()),
      events.on('enemySplit', () => this.playEnemySplit()),
      events.on('bossPulse', () => this.playBossPulse()),
      events.on('bossSummon', () => this.playBossSummon()),
      events.on('abilityTargeted', () => this.playAbilityTarget()),
      events.on('meteorImpact', () => this.playMeteorImpact()),
      events.on('overchargeActivated', () => this.playOvercharge()),
      events.on('waveStarted', () => this.playWaveStart()),
      events.on('gameWon', () => this.playOutcome(true)),
      events.on('gameLost', () => this.playOutcome(false)),
    ];
    return () => {
      for (let i = 0; i < unsubs.length; i++) unsubs[i]();
    };
  }

  dispose(): void {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.masterGain = null;
      this.noiseBuffer = null;
    }
  }
}
