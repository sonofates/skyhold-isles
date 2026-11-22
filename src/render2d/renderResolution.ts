/**
 * Canvas resolution for the 2D game. Desktops are capped at 2× (a 2560-wide window at 3× would be
 * ~30 M device px for no visible gain). Phones and small tablets render at their full density (up to
 * 3×) as long as the canvas stays within a device-pixel budget, so a DPR 2.6–3 phone is drawn sharp
 * instead of being upscaled 1.3–1.5× by the browser.
 */
export const PHONE_PIXEL_BUDGET = 4_200_000;

function highResolution(cssW: number, cssH: number, dpr: number, override?: number): number {
  if (override && override > 0) return Math.min(4, override);
  const d = dpr > 0 ? dpr : 1;
  const area = Math.max(1, cssW) * Math.max(1, cssH);
  const full = Math.min(d, 3);
  if (full > 2 && area * full * full <= PHONE_PIXEL_BUDGET) return full;
  // over budget: the largest density that fits the budget, never below 2× (or the device's own)
  const fit = Math.sqrt(PHONE_PIXEL_BUDGET / area);
  return Math.min(d, Math.max(2, Math.min(full, fit)));
}

export type QualityTier = 'low' | 'med' | 'high';

export function qualityOverride(value: string | null): QualityTier | null {
  return value === 'low' || value === 'med' || value === 'high' ? value : null;
}

// Used at Pixi initialization too, so an explicit tier picks the correct map bake on first load.
const initialTier = typeof location === 'undefined' ? null : qualityOverride(new URLSearchParams(location.search).get('quality'));

/**
 * Player graphics preferences (Settings → Graphics, set by `ui/graphicsSettings.ts` through
 * `setGraphicsPrefs`). Neutral by default, so nothing changes until the player picks something.
 */
export interface GraphicsPrefs {
  /** Player-locked tier (Quality preset); null = Auto (the frame-time governor decides). */
  readonly lock: QualityTier | null;
  /** Canvas resolution scale, 0.5..1 (Render resolution; 1 = Auto / full). */
  readonly renderScale: number;
  /** Frame-rate cap in fps (0 = none): the governor judges frames against the cap, not 60 fps. */
  readonly fpsCap: number;
}

export const NEUTRAL_GRAPHICS_PREFS: GraphicsPrefs = { lock: null, renderScale: 1, fpsCap: 0 };
let prefs: GraphicsPrefs = NEUTRAL_GRAPHICS_PREFS;
let prefsRev = 0;

/** Applies new graphics preferences; running `AdaptiveQuality`s pick them up on their next `observe`. */
export function setGraphicsPrefs(p: GraphicsPrefs): void {
  prefs = { lock: p.lock, renderScale: Math.max(0.5, Math.min(1, Number.isFinite(p.renderScale) ? p.renderScale : 1)), fpsCap: Math.max(0, p.fpsCap || 0) };
  prefsRev++;
}

export function graphicsPrefs(): GraphicsPrefs {
  return prefs;
}

export function renderResolution(w: number, h: number, dpr: number, override?: number, tier: QualityTier = initialTier ?? 'high'): number {
  const high = highResolution(w, h, dpr, override);
  if (tier === 'high') return high * prefs.renderScale;
  const medium = tier === 'med';
  const pixelBudget = medium ? 1_050_000 : 250_000;
  return Math.min(high, medium ? 1.5 : 0.8, Math.sqrt(pixelBudget / Math.max(1, w * h))) * prefs.renderScale;
}

/** Detects software WebGL rasterizers (ANGLE SwiftShader, LLVMpipe, Basic Render Driver). */
export function isSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext | null | undefined): boolean {
  if (!gl) return false;
  try {
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const unmasked = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) ?? '') : '';
    const base = String(gl.getParameter(gl.RENDERER) ?? '');
    return /swiftshader|llvmpipe|softpipe|software rasterizer|basic render driver/i.test(`${unmasked} ${base}`);
  } catch {
    return false;
  }
}

let cachedSoftwareWebGL: boolean | null = null;

/** Probes a temporary 1×1 WebGL context before Pixi init so software renderers can skip 4× MSAA. */
export function detectSoftwareWebGL(): boolean {
  if (cachedSoftwareWebGL !== null) return cachedSoftwareWebGL;
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const attrs: WebGLContextAttributes = { antialias: false, depth: false, stencil: false };
    const gl = (canvas.getContext('webgl2', attrs) ?? canvas.getContext('webgl', attrs)) as
      | WebGLRenderingContext
      | WebGL2RenderingContext
      | null;
    const software = isSoftwareRenderer(gl);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    cachedSoftwareWebGL = software;
    return software;
  } catch {
    cachedSoftwareWebGL = false;
    return false;
  }
}

/**
 * Desktop-class client: a fine, hovering primary pointer (mouse / trackpad), i.e. not a phone or
 * tablet. `?desktop=1|0` forces it (QA). Desktops keep the full canvas resolution whatever the
 * quality tier (see AdaptiveQuality): the tier only trims effects there.
 */
export function isDesktopClient(query?: URLSearchParams): boolean {
  const forced = query?.get('desktop');
  if (forced === '1') return true;
  if (forced === '0') return false;
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  const mq = (q: string): boolean => window.matchMedia(q).matches;
  return mq('(pointer: fine)') && mq('(hover: hover)') && !mq('(pointer: coarse)');
}

/** Desktop emergency framebuffer scale, only after several seconds under DESKTOP_BAD_FPS. */
export const DESKTOP_EMERGENCY_SCALE = 0.75;
/** Desktop: below this frame rate (1 s window average) for DESKTOP_BAD_WINDOWS windows the
 * framebuffer may shrink; it grows back after DESKTOP_GOOD_WINDOWS windows above DESKTOP_GOOD_FPS. */
export const DESKTOP_BAD_FPS = 20;
export const DESKTOP_BAD_WINDOWS = 4;
export const DESKTOP_GOOD_FPS = 40;
export const DESKTOP_GOOD_WINDOWS = 5;
/** Desktop: effects tier climbs back one step after this many smooth (>= ~57 fps) windows. */
const DESKTOP_TIER_UP_WINDOWS = 10;
/** Desktop: at most this many emergency drops (and tier climbs) per visit, so it never oscillates. */
const DESKTOP_MAX_CYCLES = 2;

/** Mobile: reduced framebuffer scale when a sustained low-tier workload still misses 30 fps. */
export const MOBILE_LOW_SCALE = 0.65 / 0.8;
/** Mobile: initial warm-up grace after boot / level start so upload & shader-compile hitches don't drop the tier. */
export const MOBILE_BOOT_GRACE_MS = 6000;
/** Mobile: grace after resume / tab-visible / resize so wake & backing-store hitches don't drop the tier. */
export const MOBILE_RESUME_GRACE_MS = 3000;
/** Mobile: short settle grace after a tier/scale step-up or late texture/video upload. */
export const MOBILE_SETTLE_GRACE_MS = 1500;
/** Mobile: safety cap on holding grace while async texture warmup is pending. */
export const MOBILE_MAX_WARMUP_MS = 12_000;
/** Mobile: 1 s window average below this (~57 fps) counts toward tier recovery (hysteresis vs 19 ms down). */
export const MOBILE_GOOD_MS = 17.5;
/** Mobile: 1 s window average below this (~45 fps) counts toward resolutionScale recovery (hysteresis vs 33.3 ms down). */
export const MOBILE_SCALE_GOOD_MS = 22;
/** Mobile: consecutive smooth 1 s windows required to step tier up one level (low→med→high). */
export const MOBILE_TIER_UP_WINDOWS = 8;
/** Mobile: consecutive good 1 s windows required to restore resolutionScale from reduced back to 1. */
export const MOBILE_SCALE_UP_WINDOWS = 5;
/** Mobile: maximum upward recovery steps (scale restore + tier climbs) per level, preventing oscillation. */
export const MOBILE_MAX_UP_STEPS = 3;

const TIER_ORDER: readonly QualityTier[] = ['low', 'med', 'high'];

/**
 * Phones / tablets (hardware GPU): ignore one-off hitches during boot/level-start/resume/tab-visible/resize
 * warm-up grace (and while async texture warmup is pending, up to MOBILE_MAX_WARMUP_MS). After grace, step
 * down on genuine sustained slowness (2 slow 1 s windows > 19 ms, or 2 back-to-back > 85 ms stalls) and
 * recover step-by-step (resolutionScale → low → med → high) with hysteresis after sustained smooth windows,
 * capped at MOBILE_MAX_UP_STEPS per level so marginal devices never oscillate. Software WebGL (headless CI)
 * keeps the original immediate step-down policy without grace or recovery.
 *
 * Desktops (owner feedback 2026-11-18: a 1920x1080 PC was drawn at a 667x375 framebuffer): the
 * tier only trims effects (particles), the canvas stays at full resolution (`resolutionTier` is
 * always 'high'). Only a really bad frame rate — under 20 fps for 4 s in a row, already at the
 * low effects tier — shrinks the framebuffer to 0.75x, and it grows back after 5 s above 40 fps.
 */
export class AdaptiveQuality {
  tier: QualityTier;
  // Phones: one final framebuffer reduction if a sustained low-tier workload still misses 30 fps (recoverable on hardware).
  // Desktops: the emergency scale (recoverable).
  resolutionScale = 1;
  readonly isDesktop: boolean;
  private software: boolean;
  private readonly locked: boolean;
  private elapsed = 0;
  private frames = 0;
  private slowWindows = 0;
  private severeFrames = 0;
  private badWindows = 0;
  private goodWindows = 0;
  private smoothWindows = 0;
  private emergencyDrops = 0;
  private tierClimbs = 0;
  private graceMs = 0;
  private warmupPending = false;
  private warmupElapsedMs = 0;
  private mobileUpSteps = 0;
  /** Settings → Graphics: the prefs revision this governor last applied, and its Auto start tier. */
  private seenPrefs = prefsRev;
  private readonly autoTier: QualityTier;

  constructor(override: QualityTier | null, initialUnlockedTier: QualityTier = 'high', desktop = false, software = false) {
    this.tier = override ?? prefs.lock ?? initialUnlockedTier;
    this.autoTier = initialUnlockedTier;
    this.locked = override !== null;
    this.isDesktop = desktop;
    this.software = software;
    if (!desktop && !software) this.graceMs = MOBILE_BOOT_GRACE_MS;
  }

  /** Whether this governor runs under software WebGL (headless CI / SwiftShader). */
  get isSoftware(): boolean {
    return this.software;
  }

  /** Whether the mobile warm-up / resume grace period is currently active. */
  get inGrace(): boolean {
    return !this.isLocked && !this.isDesktop && !this.software && (this.graceMs > 0 || this.warmupPending);
  }

  /** Number of mobile upward recovery steps taken in the current level. */
  get upSteps(): number {
    return this.mobileUpSteps;
  }

  /** Tier that sets the canvas resolution: desktops stay at full resolution unless `?quality=` locks it. */
  get resolutionTier(): QualityTier {
    return this.isDesktop && !this.locked ? 'high' : this.tier;
  }

  /** `?quality=` or the player's Quality preset holds the tier (no boot calibration, no governor). */
  get isLocked(): boolean {
    return this.locked || prefs.lock !== null;
  }

  /** Extends (never shortens) the mobile grace window and clears in-flight frame pressure. */
  beginGrace(ms: number = MOBILE_RESUME_GRACE_MS): void {
    if (this.isDesktop || this.software || !Number.isFinite(ms) || ms <= 0) return;
    if (ms > this.graceMs) this.graceMs = ms;
    this.resetWindows();
  }

  /** Signals whether async boot texture warmup is still uploading to the GPU (mobile hardware only). */
  setWarmupPending(pending: boolean): void {
    if (this.isDesktop || this.software) return;
    if (pending) {
      this.warmupPending = true;
      this.warmupElapsedMs = 0;
      this.resetWindows();
    } else if (this.warmupPending) {
      this.warmupPending = false;
      this.beginGrace(MOBILE_SETTLE_GRACE_MS);
    }
  }

  /** Resets per-level oscillation budget and arms boot/level-start grace (mobile hardware only). */
  resetForLevel(): void {
    if (this.isDesktop || this.software) return;
    this.mobileUpSteps = 0;
    this.graceMs = Math.max(this.graceMs, MOBILE_BOOT_GRACE_MS);
    this.resetWindows();
  }

  /** New graphics prefs: take the player's tier (or go back to Auto) and restart the windows. */
  private applyPrefs(): void {
    this.seenPrefs = prefsRev;
    if (!this.locked) {
      this.tier = prefs.lock ?? this.autoTier;
      this.resolutionScale = 1;
      this.mobileUpSteps = 0;
    }
    this.resetWindows();
  }

  private resetWindows(): void {
    this.elapsed = this.frames = this.slowWindows = this.severeFrames = 0;
    this.badWindows = this.goodWindows = this.smoothWindows = 0;
  }

  private stepTierDown(): boolean {
    const i = TIER_ORDER.indexOf(this.tier);
    if (i <= 0) return false;
    this.tier = TIER_ORDER[i - 1];
    return true;
  }

  /**
   * Pre-wave / boot calibration from a synchronous GPU-flushed render measurement:
   * steps down before gameplay begins so software or fill-bound devices avoid multi-hundred-ms
   * swapchain resizes mid-wave.
   */
  calibrateBoot(renderMs: number, software: boolean, activeWorkload = true): boolean {
    if (software) {
      this.software = true;
      this.graceMs = 0;
      this.warmupPending = false;
    }
    this.resetWindows();
    if (this.isLocked || this.resolutionScale < 1) return false;
    if (!Number.isFinite(renderMs) || renderMs <= 0) return false;
    const threshold = software ? (activeWorkload ? 14.5 : 28) : 45;
    if (renderMs <= threshold) return false;
    // Desktop: one boot frame never shrinks the canvas; a slow one only trims effects.
    if (this.isDesktop) {
      if (software && renderMs > 36) {
        const changed = this.tier !== 'low';
        this.tier = 'low';
        return changed;
      }
      return this.stepTierDown();
    }
    if (software && renderMs > 65) {
      this.tier = 'low';
      this.resolutionScale = MOBILE_LOW_SCALE;
      return true;
    }
    if (software && renderMs > 36 && this.tier === 'high') {
      this.tier = 'low';
      return true;
    }
    if (this.tier === 'low') this.resolutionScale = MOBILE_LOW_SCALE;
    else this.tier = this.tier === 'high' ? 'med' : 'low';
    return true;
  }

  observe(ms: number, visible: boolean): boolean {
    // Settings → Graphics changed: report it once so the game re-applies effects + resolution.
    if (this.seenPrefs !== prefsRev) {
      this.applyPrefs();
      return true;
    }
    if (this.isLocked) return false;
    if (!visible || !Number.isFinite(ms) || ms <= 0) {
      if (!visible && !this.isDesktop && !this.software) {
        this.graceMs = Math.max(this.graceMs, MOBILE_RESUME_GRACE_MS);
      }
      this.resetWindows();
      return false;
    }
    const rawMs = ms;
    // A 30 fps cap makes every frame ~33 ms on purpose: judge frames against the cap instead.
    if (prefs.fpsCap > 0 && prefs.fpsCap < 60) ms *= prefs.fpsCap / 60;
    if (this.isDesktop) return this.observeDesktop(ms);
    if (this.software) return this.observeMobileSoftware(ms);
    return this.observeMobile(ms, rawMs);
  }

  /** Headless / software WebGL mobile path: immediate step-down without grace or recovery. */
  private observeMobileSoftware(ms: number): boolean {
    if (this.resolutionScale < 1) return false;
    // Two back-to-back severe stalls (> 85 ms, < 12 fps) drop straight to a playable tier
    // instead of waiting through several seconds of multi-step swapchain reallocations.
    if (ms > 85) {
      this.severeFrames++;
      if (this.severeFrames >= 2) {
        this.elapsed = this.frames = this.slowWindows = this.severeFrames = 0;
        if (this.tier === 'low') this.resolutionScale = MOBILE_LOW_SCALE;
        else this.tier = 'low';
        return true;
      }
    } else {
      this.severeFrames = 0;
    }
    // A single resume/GC stall cannot fill a whole observation window.
    this.elapsed += Math.min(ms, 250);
    this.frames++;
    if (this.elapsed < 1000) return false;
    const budget = this.tier === 'low' ? 1000 / 30 : 19;
    this.slowWindows = this.elapsed / this.frames > budget ? this.slowWindows + 1 : 0;
    this.frames = this.elapsed = 0;
    if (this.slowWindows < 2) return false;
    if (this.tier === 'low') this.resolutionScale = MOBILE_LOW_SCALE;
    else this.tier = this.tier === 'high' ? 'med' : 'low';
    this.slowWindows = 0;
    return true;
  }

  /** Hardware phone / tablet path: warm-up grace, genuine step-down protection, and bounded recovery. */
  private observeMobile(ms: number, rawMs: number): boolean {
    const stepMs = Math.min(rawMs, 250);
    if (this.warmupPending) {
      this.warmupElapsedMs += stepMs;
      if (this.warmupElapsedMs >= MOBILE_MAX_WARMUP_MS) this.warmupPending = false;
    }
    if (this.graceMs > 0 || this.warmupPending) {
      if (this.graceMs > 0) this.graceMs = Math.max(0, this.graceMs - stepMs);
      this.resetWindows();
      return false;
    }

    // Two back-to-back severe stalls (> 85 ms, < 12 fps) drop straight to a playable tier
    // instead of waiting through several seconds of multi-step swapchain reallocations.
    if (ms > 85) {
      this.severeFrames++;
      this.goodWindows = this.smoothWindows = 0;
      if (this.severeFrames >= 2) {
        this.resetWindows();
        if (this.tier !== 'low') {
          this.tier = 'low';
          return true;
        }
        if (this.resolutionScale >= 1) {
          this.resolutionScale = MOBILE_LOW_SCALE;
          return true;
        }
        return false;
      }
    } else {
      this.severeFrames = 0;
    }

    // A single resume/GC stall cannot fill a whole observation window.
    this.elapsed += Math.min(ms, 250);
    this.frames++;
    if (this.elapsed < 1000) return false;
    const avg = this.elapsed / this.frames;
    this.frames = this.elapsed = 0;

    // Reduced resolutionScale (at low tier): recover back to 1 after sustained good windows
    // with hysteresis, subject to the per-level oscillation cap.
    if (this.resolutionScale < 1) {
      this.goodWindows = avg < MOBILE_SCALE_GOOD_MS ? this.goodWindows + 1 : 0;
      if (this.goodWindows >= MOBILE_SCALE_UP_WINDOWS && this.mobileUpSteps < MOBILE_MAX_UP_STEPS) {
        this.resolutionScale = 1;
        this.mobileUpSteps++;
        this.graceMs = Math.max(this.graceMs, MOBILE_SETTLE_GRACE_MS);
        this.resetWindows();
        return true;
      }
      return false;
    }

    // Genuine slowness protection: two consecutive slow 1 s windows step down.
    const budget = this.tier === 'low' ? 1000 / 30 : 19;
    if (avg > budget) {
      this.slowWindows++;
      this.smoothWindows = 0;
      if (this.slowWindows >= 2) {
        this.resetWindows();
        if (this.tier === 'low') this.resolutionScale = MOBILE_LOW_SCALE;
        else this.tier = this.tier === 'high' ? 'med' : 'low';
        return true;
      }
      return false;
    }
    this.slowWindows = 0;

    // Recovery: step back up one tier after sustained smooth windows (hysteresis: < 17.5 ms vs > 19 ms down),
    // capped at MOBILE_MAX_UP_STEPS per level so marginal devices never oscillate.
    if (this.tier !== 'high' && this.mobileUpSteps < MOBILE_MAX_UP_STEPS) {
      this.smoothWindows = avg < MOBILE_GOOD_MS ? this.smoothWindows + 1 : 0;
      if (this.smoothWindows >= MOBILE_TIER_UP_WINDOWS) {
        this.tier = TIER_ORDER[TIER_ORDER.indexOf(this.tier) + 1];
        this.mobileUpSteps++;
        this.graceMs = Math.max(this.graceMs, MOBILE_SETTLE_GRACE_MS);
        this.resetWindows();
        return true;
      }
    } else {
      this.smoothWindows = 0;
    }
    return false;
  }

  /** Desktop: effects tier follows the frame rate both ways; the framebuffer only in emergencies. */
  private observeDesktop(ms: number): boolean {
    // Two back-to-back severe stalls trim effects at once (never the resolution).
    if (ms > 85) {
      this.severeFrames++;
      if (this.severeFrames >= 2) {
        this.severeFrames = 0;
        if (this.tier !== 'low') {
          this.tier = 'low';
          this.slowWindows = this.smoothWindows = 0;
          return true;
        }
      }
    } else {
      this.severeFrames = 0;
    }
    this.elapsed += Math.min(ms, 250);
    this.frames++;
    if (this.elapsed < 1000) return false;
    const avg = this.elapsed / this.frames;
    this.frames = this.elapsed = 0;

    // Emergency framebuffer scale: down after DESKTOP_BAD_WINDOWS really bad seconds, back up
    // after DESKTOP_GOOD_WINDOWS good ones (at most DESKTOP_MAX_CYCLES drops per visit).
    if (this.resolutionScale < 1) {
      this.goodWindows = avg < 1000 / DESKTOP_GOOD_FPS ? this.goodWindows + 1 : 0;
      if (this.goodWindows >= DESKTOP_GOOD_WINDOWS && this.emergencyDrops < DESKTOP_MAX_CYCLES) {
        this.resolutionScale = 1;
        this.goodWindows = this.badWindows = 0;
        return true;
      }
      return false;
    }
    this.badWindows = this.tier === 'low' && avg > 1000 / DESKTOP_BAD_FPS ? this.badWindows + 1 : 0;
    if (this.badWindows >= DESKTOP_BAD_WINDOWS) {
      this.resolutionScale = DESKTOP_EMERGENCY_SCALE;
      this.emergencyDrops++;
      this.badWindows = this.goodWindows = 0;
      return true;
    }

    // Effects tier: down after two slow windows, back up after a long smooth stretch.
    const budget = this.tier === 'low' ? 1000 / 30 : 19;
    this.slowWindows = avg > budget ? this.slowWindows + 1 : 0;
    if (this.slowWindows >= 2) {
      this.slowWindows = this.smoothWindows = 0;
      return this.stepTierDown();
    }
    this.smoothWindows = avg < 17.5 ? this.smoothWindows + 1 : 0;
    if (this.smoothWindows >= DESKTOP_TIER_UP_WINDOWS && this.tier !== 'high' && this.tierClimbs < DESKTOP_MAX_CYCLES) {
      this.tier = TIER_ORDER[TIER_ORDER.indexOf(this.tier) + 1];
      this.tierClimbs++;
      this.smoothWindows = 0;
      return true;
    }
    return false;
  }
}
