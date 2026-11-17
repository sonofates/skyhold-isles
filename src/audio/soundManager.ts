import type { EventBus } from '../core/eventBus.ts';
import type { GameSettings, TowerType } from '../core/types.ts';
import { ENEMY_DEFS } from '../data/enemies.ts';
import { MusicEngine } from './music/musicEngine.ts';
import type { MusicScene } from './music/sequencer.ts';
import { getMusicVolume, onMusicVolumeChange } from './musicPrefs.ts';

export class SoundManager {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private masterGain: GainNode | null = null;
  private settings: GameSettings;
  private readonly lastPlayedMs = new Map<string, number>();
  /** Per-call voicing set by playFire/playImpact: random pitch jitter, tier pitch multiplier, tier volume. */
  private jitter = 0;
  private pitchMul = 1;
  private volMul = 1;

  /** Procedural soundtrack + ambience (created with the AudioContext on the first user gesture). */
  private music: MusicEngine | null = null;
  private musicLevelId: string | null = null;
  private musicScene: MusicScene = 'menu';
  private musicDucked = false;
  private readonly unsubMusicVolume: () => void;

  constructor(initialSettings: GameSettings) {
    this.settings = { ...initialSettings };
    this.unsubMusicVolume = onMusicVolumeChange(() => this.syncMusic());
  }

  unlock(): void {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return;
      this.ctx = new AudioCtx();
      this.masterGain = this.ctx.createGain();
      this.applyVolume();
      // Soft limiter so dense late waves (many towers + impacts at once) never clip.
      const limiter = this.ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.knee.value = 12;
      limiter.ratio.value = 6;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.15;
      this.masterGain.connect(limiter);
      limiter.connect(this.ctx.destination);
      this.noiseBuffer = this.createNoiseBuffer(this.ctx);
      this.music = new MusicEngine(this.ctx, this.masterGain, this.noiseBuffer);
      this.syncMusic();
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
  }

  /**
   * Which island tune to play and the scene: `menu` (showcase), `build` (calm, between waves), `wave`, `boss`, `end`.
   * Call with `build` when a level loads and `menu` when leaving play, so a scene never outlives its level.
   */
  setMusicContext(levelId: string | null, scene: MusicScene): void {
    this.musicLevelId = levelId ?? this.musicLevelId;
    this.musicScene = scene;
    this.syncMusic();
  }

  /** Pause menu / modals: duck the music under the UI. */
  setMusicDucked(ducked: boolean): void {
    if (ducked === this.musicDucked) return;
    this.musicDucked = ducked;
    this.syncMusic();
  }

  private setMusicScene(scene: MusicScene): void {
    this.musicScene = scene;
    this.syncMusic();
  }

  /** Push level / scene / volume to the engine and start or stop it (silent = no timer, no nodes ticking). */
  private syncMusic(): void {
    const m = this.music;
    if (!m) return;
    const audible = !this.settings.muted && this.settings.masterVolume > 0.01 && getMusicVolume() > 0.005;
    m.setVolume(getMusicVolume());
    m.setDucked(this.musicDucked);
    m.setTarget(this.musicLevelId, this.musicScene);
    m.setActive(audible);
  }

  /** Silence audio while the page is hidden (phone locked / tab switched). */
  suspendForBackground(): void {
    this.music?.pause();
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resumeFromBackground(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
    this.music?.resume();
  }

  updateSettings(next: GameSettings): void {
    this.settings = { ...next };
    this.applyVolume();
    this.syncMusic();
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
    const pm = this.pitchMul * (this.jitter > 0 ? 1 + (Math.random() * 2 - 1) * this.jitter : 1);
    startFreq *= pm;
    endFreq *= pm;
    volume *= this.volMul;
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

  playTowerUpgrade(tier = 2): void {
    if (!this.canPlay('upgrade', 50)) return;
    this.tone('triangle', 392, 523, 0.11, 0.22, 0);
    this.tone('triangle', 523, 659, 0.12, 0.22, 0.07);
    this.tone('sine', 659, 784, 0.18, 0.2, 0.14);
    if (tier >= 3) {
      // Final tier: extra rising sparkle on top of the chime.
      this.tone('sine', 784, 1046, 0.16, 0.16, 0.2);
      this.tone('triangle', 1046, 1318, 0.28, 0.14, 0.26);
      this.noiseBurst(5200, 0.12, 0.05);
    }
  }

  playBrittleCrack(): void {
    if (!this.canPlay('brittle', 60)) return;
    this.tone('triangle', 2100, 1500, 0.05, 0.1, 0);
    this.noiseBurst(6500, 0.05, 0.07);
  }

  playTowerSell(): void {
    if (!this.canPlay('sell', 50)) return;
    this.tone('sine', 980, 1280, 0.08, 0.18, 0);
    this.tone('sine', 740, 880, 0.11, 0.16, 0.06);
  }

  /** Voices a tower sound: +-jitter random detune, higher tiers sound deeper and slightly louder. */
  private voice(tier: number, jitter: number): void {
    this.jitter = jitter;
    this.pitchMul = 1 - (tier - 1) * 0.07;
    this.volMul = 1 + (tier - 1) * 0.1;
  }

  private resetVoice(): void {
    this.jitter = 0;
    this.pitchMul = 1;
    this.volMul = 1;
  }

  playFire(type: TowerType, tier = 1, special = false): void {
    this.voice(tier, 0.07);
    this.fireSound(type);
    if (special) this.specialLayer(type);
    this.resetVoice();
  }

  /** Extra layer on tier-signature shots (archer volley, tesla overload). */
  private specialLayer(type: TowerType): void {
    if (type === 'archer') {
      this.tone('triangle', 600, 230, 0.07, 0.12, 0.045);
      this.tone('triangle', 660, 250, 0.07, 0.1, 0.09);
    } else if (type === 'tesla') {
      this.tone('sawtooth', 220, 90, 0.2, 0.16);
      this.tone('sine', 1500, 400, 0.14, 0.1, 0.02);
      this.noiseBurst(4200, 0.14, 0.14);
    }
  }

  private fireSound(type: TowerType): void {
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
    this.jitter = 0.08;
    this.impactSound(type);
    this.resetVoice();
  }

  private impactSound(type: TowerType): void {
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

  playIgnite(): void {
    if (!this.canPlay('ignite', 150)) return;
    this.jitter = 0.08;
    this.noiseBurst(2400, 0.28, 0.1);
    this.tone('sawtooth', 180, 90, 0.18, 0.06);
    this.resetVoice();
  }

  playBeaconPulse(): void {
    if (!this.canPlay('beacon_pulse', 700)) return;
    this.tone('sine', 880, 1175, 0.18, 0.05);
    this.tone('sine', 1320, 1568, 0.2, 0.03, 0.06);
  }

  playGoldCoin(): void {
    if (!this.canPlay('coin', 95)) return;
    this.jitter = 0.06;
    this.tone('sine', 1046, 1396, 0.08, 0.12);
    this.resetVoice();
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

  // ---- Enemy archetype cues (quiet, throttled: these fire often in late waves) ----

  /** Aegis Warden barrier pulse: soft rising shimmer. */
  playWardPulse(): void {
    if (!this.canPlay('ward_pulse', 350)) return;
    this.tone('sine', 660, 990, 0.18, 0.07, 0);
    this.tone('sine', 990, 1320, 0.16, 0.04, 0.05);
  }

  /** A barrier shattered: short glassy crack. */
  playShieldBroken(): void {
    if (!this.canPlay('shield_broken', 90)) return;
    this.tone('triangle', 1800, 900, 0.08, 0.1, 0);
    this.noiseBurst(5000, 0.06, 0.06);
  }

  /** Loam Burrower digs in (low thump) or pops back out (dirt spray). */
  playBurrow(burrowed: boolean): void {
    if (burrowed) {
      if (!this.canPlay('burrow_in', 140)) return;
      this.tone('sine', 120, 55, 0.16, 0.14, 0);
      this.noiseBurst(420, 0.16, 0.1);
    } else {
      if (!this.canPlay('burrow_out', 140)) return;
      this.tone('sine', 90, 160, 0.12, 0.12, 0);
      this.noiseBurst(760, 0.12, 0.1);
    }
  }

  /** Rift Blinker teleport: quick up-down zip. */
  playBlink(): void {
    if (!this.canPlay('blink', 110)) return;
    this.tone('sine', 400, 1600, 0.07, 0.08, 0);
    this.tone('sine', 1600, 600, 0.08, 0.06, 0.05);
  }

  /** Cloud Hauler goes down and drops its raiders: falling whoosh. */
  playCarrierDrop(): void {
    if (!this.canPlay('carrier_drop', 200)) return;
    this.tone('triangle', 700, 250, 0.25, 0.12, 0);
    this.noiseBurst(1500, 0.2, 0.08);
  }

  /** Basalt Golem armor cracked by chill: stony crunch (lower than the frost brittle tick). */
  playArmorCracked(): void {
    if (!this.canPlay('armor_cracked', 120)) return;
    this.noiseBurst(900, 0.14, 0.16);
    this.tone('square', 260, 120, 0.08, 0.07, 0);
  }

  /** Tempest Colossus phase change: 1 = Stormwall (rising swell), 2 = enrage (heavy roar). */
  playBossPhase(phase: number): void {
    // One slot per phase: a single burst tick can cross both thresholds, and the enrage roar must not be dropped.
    if (!this.canPlay(phase >= 2 ? 'boss_phase_2' : 'boss_phase_1', 400)) return;
    if (phase >= 2) {
      this.tone('sawtooth', 260, 60, 0.5, 0.2, 0);
      this.tone('sine', 130, 40, 0.55, 0.24, 0.04);
      this.noiseBurst(1000, 0.4, 0.18);
    } else {
      this.tone('sawtooth', 110, 220, 0.5, 0.14, 0);
      this.tone('sine', 220, 440, 0.5, 0.12, 0.08);
      this.tone('sine', 330, 660, 0.45, 0.08, 0.16);
    }
  }

  /** Gloam Hexer starts channelling: eerie wobble so the player can react. */
  playHexCharge(): void {
    if (!this.canPlay('hex_charge', 250)) return;
    this.tone('sine', 520, 780, 0.5, 0.07, 0);
    this.tone('triangle', 780, 520, 0.5, 0.05, 0.1);
  }

  /** The hex landed and a tower is silenced: descending zap. */
  playTowerHexed(): void {
    if (!this.canPlay('tower_hexed', 150)) return;
    this.tone('sawtooth', 900, 180, 0.22, 0.12, 0);
    this.tone('sine', 300, 120, 0.26, 0.1, 0.03);
  }

  bindEvents(events: EventBus): () => void {
    const unsubs = [
      events.on('towerBuilt', () => this.playTowerBuild()),
      events.on('towerUpgraded', (e) => this.playTowerUpgrade(e.tier)),
      events.on('towerSold', () => this.playTowerSell()),
      events.on('beaconPulse', () => this.playBeaconPulse()),
      events.on('brittleCrack', () => this.playBrittleCrack()),
      events.on('groundZone', () => this.playIgnite()),
      events.on('towerFired', (e) => this.playFire(e.type, e.tier, e.special === true)),
      events.on('projectileImpact', (e) => this.playImpact(e.towerType)),
      events.on('enemyKilled', () => this.playGoldCoin()),
      events.on('enemyLeaked', () => this.playEnemyLeak()),
      events.on('enemySplit', () => this.playEnemySplit()),
      events.on('bossPulse', () => this.playBossPulse()),
      events.on('bossSummon', () => this.playBossSummon()),
      events.on('wardPulse', () => this.playWardPulse()),
      events.on('shieldBroken', () => this.playShieldBroken()),
      events.on('enemyBurrow', (e) => this.playBurrow(e.burrowed)),
      events.on('enemyBlink', () => this.playBlink()),
      events.on('carrierDrop', () => this.playCarrierDrop()),
      events.on('armorCracked', () => this.playArmorCracked()),
      events.on('bossPhase', (e) => this.playBossPhase(e.phase)),
      events.on('hexCharge', () => this.playHexCharge()),
      events.on('towerHexed', () => this.playTowerHexed()),
      events.on('abilityTargeted', () => this.playAbilityTarget()),
      events.on('meteorImpact', () => this.playMeteorImpact()),
      events.on('overchargeActivated', () => this.playOvercharge()),
      events.on('waveStarted', () => {
        this.playWaveStart();
        this.setMusicScene('wave');
      }),
      events.on('waveCompleted', () => this.setMusicScene('build')),
      events.on('enemySpawned', (e) => {
        if (!ENEMY_DEFS[e.enemyType].isBoss || this.musicScene === 'boss') return;
        this.setMusicScene('boss');
        this.music?.stinger();
      }),
      events.on('gameWon', () => {
        this.playOutcome(true);
        this.setMusicScene('end');
      }),
      events.on('gameLost', () => {
        this.playOutcome(false);
        this.setMusicScene('end');
      }),
    ];
    return () => {
      for (let i = 0; i < unsubs.length; i++) unsubs[i]();
    };
  }

  /** Victory star stamp: a rising bell per star (index 0..2), the third one brighter. */
  playStarChime(index: number): void {
    if (!this.canPlay(`star${index}`, 120)) return;
    const base = [659, 784, 988][Math.max(0, Math.min(2, index))];
    this.tone('triangle', base, base * 1.02, 0.22, 0.24);
    this.tone('sine', base * 2, base * 2, 0.32, 0.1, 0.03);
    if (index >= 2) this.tone('sine', base * 1.5, base * 2, 0.4, 0.12, 0.08);
  }

  /** Meta screens (Workshop / challenge toggles): soft confirm blip. */
  playUiConfirm(): void {
    if (!this.canPlay('ui_confirm', 60)) return;
    this.tone('triangle', 523, 784, 0.12, 0.18);
    this.tone('sine', 1046, 1046, 0.14, 0.08, 0.05);
  }

  /** Meta screens: refund / toggle-off. */
  playUiBack(): void {
    if (!this.canPlay('ui_back', 60)) return;
    this.tone('triangle', 523, 349, 0.14, 0.16);
  }

  dispose(): void {
    this.unsubMusicVolume();
    this.music?.dispose();
    this.music = null;
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
      this.masterGain = null;
      this.noiseBuffer = null;
    }
  }
}
