import * as fs from 'node:fs';
import * as path from 'node:path';
import { EffectPass } from 'postprocessing';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { KenneyAssetStore, yieldMainThread } from '../../src/render/kenneyAssets.ts';
import {
  GOVERNOR_THRESHOLDS,
  PerfGovernor,
  QUALITY_PRESETS,
  RollingFrameMetrics,
  computeP95,
  computeShadowMapSize,
  computeTargetDpr,
} from '../../src/render/perfGovernor.ts';
import {
  PostProcessingPipeline,
  SilhouetteOutlineEffect,
  canUseHalfFloatComposer,
  canUseHalfResN8ao,
  collectPostWarmUpMaterials,
  getN8aoQualitySettings,
} from '../../src/render/postProcessing.ts';
import {
  collectInstancedMaterialsNeedingColor,
  compileWarmUpGroups,
  computeSafeRenderDimensions,
  createInstancedShadowWarmMesh,
  detectPrimaryTouchDevice,
  findHiddenInstancedColorShadowCasterMaterial,
  hasVisibleInstancedColorShadowCaster,
  shouldUseAsyncShaderCompile,
} from '../../src/render/sceneManager.ts';
import { DebugPanel, formatPerfLogLine } from '../../src/ui/debugPanel.ts';

function createMockPostRenderer(initialW = 800, initialH = 600): {
  renderer: THREE.WebGLRenderer;
  setBufferSize: (w: number, h: number) => void;
} {
  let w = initialW;
  let h = initialH;
  const renderer = {
    outputColorSpace: THREE.SRGBColorSpace,
    autoClear: true,
    capabilities: { isWebGL2: true, maxSamples: 4 },
    extensions: { has: () => true },
    getContext: () => ({ getContextAttributes: () => ({ alpha: false }) }),
    getSize: (t: THREE.Vector2) => t.set(w, h),
    getDrawingBufferSize: (t: THREE.Vector2) => t.set(w, h),
    setSize: (nextW: number, nextH: number) => {
      w = nextW;
      h = nextH;
    },
  } as unknown as THREE.WebGLRenderer;
  return {
    renderer,
    setBufferSize: (nextW: number, nextH: number) => {
      w = nextW;
      h = nextH;
    },
  };
}

function feedFrames(
  gov: PerfGovernor,
  count: number,
  frameMs: number,
  options?: { throttled?: boolean; hidden?: boolean },
): ReturnType<PerfGovernor['recordFrame']>[] {
  const transitions: ReturnType<PerfGovernor['recordFrame']>[] = [];
  for (let i = 0; i < count; i++) {
    const tr = gov.recordFrame(frameMs, options);
    if (tr) transitions.push(tr);
  }
  return transitions;
}

describe('computeTargetDpr', () => {
  it('caps touch devices at <= 2.0 and scales down across tiers', () => {
    const dpr5 = computeTargetDpr(3, 5, true, 'auto');
    const dpr4 = computeTargetDpr(3, 4, true, 'auto');
    const dpr3 = computeTargetDpr(3, 3, true, 'auto');
    const dpr2 = computeTargetDpr(3, 2, true, 'auto');
    const dpr1 = computeTargetDpr(3, 1, true, 'auto');
    const dpr0 = computeTargetDpr(3, 0, true, 'auto');

    expect(dpr5).toBeLessThanOrEqual(2);
    expect(dpr4).toBe(1.5);
    expect(dpr3).toBe(1.35);
    expect(dpr2).toBe(1.15);
    expect(dpr1).toBe(1.0);
    expect(dpr0).toBe(0.85);
    expect(dpr4).toBeGreaterThan(dpr3);
    expect(dpr3).toBeGreaterThan(dpr2);
    expect(dpr2).toBeGreaterThan(dpr1);
    expect(dpr1).toBeGreaterThan(dpr0);
  });

  it('preserves full native DPR up to 2.0 for desktop Tier 5', () => {
    expect(computeTargetDpr(1, 5, false, 'auto')).toBe(1);
    expect(computeTargetDpr(2, 5, false, 'auto')).toBe(2);
    expect(computeTargetDpr(3, 5, false, 'auto')).toBe(2);
  });

  it('honors explicit high and low quality modes and guards invalid DPR inputs', () => {
    expect(computeTargetDpr(3, 0, true, 'high')).toBe(2);
    expect(computeTargetDpr(3, 5, false, 'low')).toBe(1);
    expect(computeTargetDpr(NaN, 4, true, 'auto')).toBe(1);
    expect(computeTargetDpr(0, 4, false, 'auto')).toBe(1);
  });
});

describe('computeP95 and RollingFrameMetrics', () => {
  it('computes accurate p95 without mutating the source buffer', () => {
    const src = new Float64Array([50, 10, 20, 30, 40, 15, 25, 35, 45, 100]);
    const copy = new Float64Array(src);
    const scratch = new Float64Array(20);
    // Sorted: 10,15,20,25,30,35,40,45,50,100 -> ceil(10*0.95)-1 = 9 -> 100
    expect(computeP95(src, 10, scratch)).toBe(100);
    expect(src).toEqual(copy);

    const metrics = new RollingFrameMetrics(20);
    for (let i = 1; i <= 20; i++) {
      metrics.record(i);
    }
    const snap = metrics.getSnapshot();
    expect(snap.sampleCount).toBe(20);
    expect(snap.avgMs).toBeCloseTo(10.5, 4);
    expect(snap.p95Ms).toBe(19);
    expect(snap.maxMs).toBe(20);
    expect(snap.fps).toBeCloseTo(1000 / 10.5, 2);

    // Sliding window drops old peak once evicted
    metrics.record(50);
    expect(metrics.getSnapshot().maxMs).toBe(50);
    for (let i = 0; i < 20; i++) {
      metrics.record(12);
    }
    expect(metrics.getSnapshot().maxMs).toBe(12);
  });

  it('rejects 0ms frame intervals by default while accurately recording 0ms CPU work samples when allowZero is true', () => {
    const frameMetrics = new RollingFrameMetrics(10);
    frameMetrics.record(0);
    frameMetrics.record(16);
    expect(frameMetrics.getSnapshot().sampleCount).toBe(1);
    expect(frameMetrics.getSnapshot().avgMs).toBe(16);

    const workMetrics = new RollingFrameMetrics(10);
    workMetrics.record(0, true);
    workMetrics.record(1, true);
    workMetrics.record(-0.5, true);
    const snap = workMetrics.getSnapshot();
    expect(snap.sampleCount).toBe(2);
    expect(snap.avgMs).toBeCloseTo(0.5, 6);
    expect(snap.p95Ms).toBe(1);

    // Floating-point drift guard: evicting fractional values with zeros never yields negative avgMs
    const driftMetrics = new RollingFrameMetrics(4);
    for (let i = 0; i < 40; i++) {
      driftMetrics.record(0.1 + (i % 3) * 0.2, true);
    }
    for (let i = 0; i < 4; i++) {
      driftMetrics.record(0, true);
    }
    const zeroSnap = driftMetrics.getSnapshot();
    expect(zeroSnap.avgMs).toBe(0);
    expect(Object.is(zeroSnap.avgMs, -0)).toBe(false);
  });
});

describe('PerfGovernor', () => {
  it('starts desktop at Tier 5 and touch at Tier 4 in auto mode', () => {
    const desktop = new PerfGovernor({ mode: 'auto', isTouch: false });
    const touch = new PerfGovernor({ mode: 'auto', isTouch: true });

    expect(desktop.getTier()).toBe(5);
    expect(desktop.getPreset()).toBe(QUALITY_PRESETS[5]);
    expect(touch.getTier()).toBe(4);
    expect(touch.getPreset().n8ao).toBe('half');
  });

  it('stays at Tier 5 on healthy 60Hz desktop frames', () => {
    const gov = new PerfGovernor({ mode: 'auto', isTouch: false });
    const transitions = feedFrames(gov, 600, 16.67);
    expect(transitions).toHaveLength(0);
    expect(gov.getTier()).toBe(5);
  });

  it('ignores throttled, hidden, and oversized outlier frames', () => {
    const gov = new PerfGovernor({ mode: 'auto', isTouch: false });
    expect(feedFrames(gov, 300, 66.7, { throttled: true })).toHaveLength(0);
    expect(feedFrames(gov, 300, 66.7, { hidden: true })).toHaveLength(0);
    expect(feedFrames(gov, 300, 400)).toHaveLength(0);
    expect(gov.getTier()).toBe(5);
  });

  it('ignores brief spikes during warmup or short transient bursts', () => {
    const gov = new PerfGovernor({ mode: 'auto', isTouch: false });
    // Warmup frames (< 1.2s) even if slow do not trigger downgrade
    expect(feedFrames(gov, 25, 40)).toHaveLength(0);
    expect(gov.getTier()).toBe(5);

    // 400ms burst followed by healthy 60fps recovers without dropping
    expect(feedFrames(gov, 12, 35)).toHaveLength(0);
    expect(feedFrames(gov, 180, 16.5)).toHaveLength(0);
    expect(gov.getTier()).toBe(5);
  });

  it('steps down under sustained slow frames and steps down faster when severely slow', () => {
    const mildGov = new PerfGovernor({ mode: 'auto', isTouch: false });
    const mildTransitions = feedFrames(mildGov, 260, 24);
    expect(mildTransitions.length).toBeGreaterThanOrEqual(1);
    expect(mildTransitions[0].direction).toBe('down');
    expect(mildTransitions[0].fromTier).toBe(5);
    expect(mildTransitions[0].toTier).toBe(4);

    const severeGov = new PerfGovernor({ mode: 'auto', isTouch: false });
    const severeTransitions = feedFrames(severeGov, 140, 40);
    expect(severeTransitions.length).toBeGreaterThanOrEqual(1);
    expect(severeTransitions[0].direction).toBe('down');
    expect(severeTransitions[0].fromTier).toBe(5);
    expect(severeTransitions[0].toTier).toBe(3); // double-step under >=36ms severe load
  });

  it('requires strong headroom and hold duration to upgrade and locks ceiling on bounce', () => {
    const gov = new PerfGovernor({ mode: 'auto', isTouch: false });

    // Trigger downgrade 5 -> 4 (GPU struggles at Tier 5: 25ms)
    const down0 = feedFrames(gov, 160, 25);
    expect(down0.some((t) => t.direction === 'down' && t.toTier === 4)).toBe(true);
    expect(gov.getTier()).toBe(4);
    gov.resetWarmup();

    // Borderline 19ms (~52fps) frames at Tier 4 fall in hysteresis deadzone: no upgrade, no downgrade
    expect(feedFrames(gov, 900, 19.0)).toHaveLength(0);
    expect(gov.getTier()).toBe(4);

    // Sustained fast 16.5ms frames for > 12s + warmup -> upgrade 4 -> 5
    const up1 = feedFrames(gov, 950, 16.5);
    expect(up1.some((t) => t.direction === 'up' && t.toTier === 5)).toBe(true);
    expect(gov.getTier()).toBe(5);

    // Immediately struggles again at Tier 5 -> bounce #1 back to 4, hold doubles to 24s
    const down1 = feedFrames(gov, 160, 25);
    expect(down1.some((t) => t.direction === 'down' && t.toTier === 4)).toBe(true);
    expect(gov.getTier()).toBe(4);
    gov.resetWarmup();

    // At 14s of fast frames it must NOT upgrade yet because hold doubled to 24s
    expect(feedFrames(gov, 850, 16.5)).toHaveLength(0);
    expect(gov.getTier()).toBe(4);

    // After > 25s of fast frames, try upgrade #2 -> 5
    const up2 = feedFrames(gov, 900, 16.5);
    expect(up2.some((t) => t.direction === 'up' && t.toTier === 5)).toBe(true);
    expect(gov.getTier()).toBe(5);

    // Fails again within bounce window -> bounce #2 permanently locks ceiling at Tier 4
    const down2 = feedFrames(gov, 160, 25);
    expect(down2.some((t) => t.direction === 'down' && t.toTier === 4)).toBe(true);
    expect(gov.getTier()).toBe(4);
    expect(gov.getLockedCeilingTier()).toBe(4);

    // Even 3000 fast frames will never flip-flop back to Tier 5
    expect(feedFrames(gov, 3000, 12)).toHaveLength(0);
    expect(gov.getTier()).toBe(4);
  });

  it('locks to Tier 5 on explicit high and Tier 0 on explicit low', () => {
    const gov = new PerfGovernor({ mode: 'high', isTouch: true });
    expect(gov.getTier()).toBe(5);
    expect(feedFrames(gov, 300, 50)).toHaveLength(0);
    expect(gov.getTier()).toBe(5);

    gov.setMode('low');
    expect(gov.getTier()).toBe(0);
    expect(feedFrames(gov, 1500, 8)).toHaveLength(0);
    expect(gov.getTier()).toBe(0);
  });

  it('stays strictly within expected threshold bounds', () => {
    expect(GOVERNOR_THRESHOLDS.upgradeMaxAvgMs).toBeLessThan(GOVERNOR_THRESHOLDS.mildDowngradeAvgMs);
    expect(GOVERNOR_THRESHOLDS.upgradeMaxP95Ms).toBeLessThan(GOVERNOR_THRESHOLDS.mildDowngradeP95Ms);
    expect(GOVERNOR_THRESHOLDS.baseUpgradeHoldSec).toBeGreaterThan(
      GOVERNOR_THRESHOLDS.mildDowngradeHoldSec,
    );
    expect(GOVERNOR_THRESHOLDS.postDowngradeWarmupSec).toBeLessThanOrEqual(
      GOVERNOR_THRESHOLDS.warmupSec,
    );
  });

  it('scales shadow map sizes by tier and device class', () => {
    expect(computeShadowMapSize(0, false)).toBe(0);
    expect(computeShadowMapSize(0, true)).toBe(0);
    expect(computeShadowMapSize(1, true)).toBe(512);
    expect(computeShadowMapSize(1, false)).toBe(1024);
    expect(computeShadowMapSize(2, false)).toBe(1024);
    expect(computeShadowMapSize(3, true)).toBe(1024);
    expect(computeShadowMapSize(4, true)).toBe(1024);
    expect(computeShadowMapSize(4, false)).toBe(2048);
    expect(computeShadowMapSize(5, false)).toBe(2048);
  });

  it('preserves eval accumulation on <25fps GPUs and updates ceiling on setTouch', () => {
    const gov = new PerfGovernor({ mode: 'auto', isTouch: false });
    expect(gov.getDefaultMaxTier()).toBe(5);
    expect(gov.setTouch(true)).toBe(true);
    expect(gov.getDefaultMaxTier()).toBe(4);
    expect(gov.getTier()).toBe(4);
    expect(gov.getLockedCeilingTier()).toBe(4);

    // At 15fps (66ms frames), 20 samples take ~1.32s after 1.2s warmup (~38 frames total).
    // Preserving evalAccumSec allows immediate severe double-step (T4 -> T2) once minSamples arrive.
    const tr1 = feedFrames(gov, 45, 66);
    expect(tr1.length).toBeGreaterThanOrEqual(1);
    expect(tr1[0]).toMatchObject({ fromTier: 4, toTier: 2, direction: 'down' });
  });

  it('formats ?perf telemetry log lines cleanly with shadow, loop, and ceiling cap', () => {
    const line = formatPerfLogLine({
      fps: 58.4,
      frameTimeMs: 17.1,
      p95FrameMs: 19.8,
      maxFrameMs: 22.4,
      workAvgMs: 2.34,
      workP95Ms: 3.12,
      drawCalls: 48,
      drawsWithShadows: 48,
      drawsNoShadows: 31,
      triangles: 29410,
      textures: 7,
      geometries: 52,
      programs: 14,
      dpr: 1.35,
      pixelWidth: 526,
      pixelHeight: 1139,
      composerEnabled: true,
      activePasses: 'Out+Bloom',
      shadowsEnabled: true,
      shadowMapSize: 1024,
      qualityMode: 'auto',
      activeTier: 3,
      tierLabel: 'Medium',
      lockedCeilingTier: 3,
      defaultMaxTier: 4,
      tierTransitions: 2,
      pacingMode: 'active',
      enemiesActive: 12,
      enemiesMax: 256,
      towersCount: 8,
      projectilesActive: 4,
      projectilesMax: 256,
      particlesActive: 20,
      particlesMax: 512,
      floatingTextsActive: 3,
      floatingTextsMax: 60,
    });
    expect(line).toContain('[Skyhold Perf]');
    expect(line).toContain('fps=58.4');
    expect(line).toContain('p95=19.8ms');
    expect(line).toContain('max=22.4ms');
    expect(line).toContain('work=2.34/3.12ms');
    expect(line).toContain('progs=14');
    expect(line).toContain('loop=active');
    expect(line).toContain('draws=48');
    expect(line).toContain('dpr=1.35(526x1139)');
    expect(line).toContain('composer=ON[Out+Bloom]');
    expect(line).toContain('sh=ON(1024)');
    expect(line).toContain('quality=auto->T3(Medium) cap=T3 chg=2');

    const menuLine = formatPerfLogLine({
      fps: 30,
      frameTimeMs: 33.3,
      drawCalls: 22,
      drawsWithShadows: 22,
      drawsNoShadows: 16,
      triangles: 14000,
      pacingMode: 'menu',
      pacingFps: 30,
      enemiesActive: 0,
      enemiesMax: 256,
      towersCount: 0,
      projectilesActive: 0,
      projectilesMax: 256,
      particlesActive: 0,
      particlesMax: 512,
      floatingTextsActive: 0,
      floatingTextsMax: 60,
    });
    expect(menuLine).toContain('loop=menu@30fps');
  });

  it('distinguishes primary-touch mobile devices from touchscreen laptops', () => {
    // Phone/tablet: (pointer: coarse) matches
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({ matches: q === '(pointer: coarse)' }),
    });
    vi.stubGlobal('navigator', { maxTouchPoints: 5 });
    expect(detectPrimaryTouchDevice()).toBe(true);

    // Touchscreen laptop with mouse/trackpad: maxTouchPoints > 0 but primary pointer is fine + hover
    vi.stubGlobal('window', {
      matchMedia: (q: string) => ({
        matches: q === '(pointer: fine)' || q === '(hover: hover)',
      }),
    });
    vi.stubGlobal('navigator', { maxTouchPoints: 10 });
    expect(detectPrimaryTouchDevice()).toBe(false);

    vi.unstubAllGlobals();
  });

  it('uses lightweight Performance+halfRes N8AO on Tier 4 half mode and Medium+full on Tier 5', () => {
    expect(getN8aoQualitySettings('half')).toEqual({
      qualityMode: 'Performance',
      halfRes: true,
    });
    expect(getN8aoQualitySettings('half', false)).toEqual({
      qualityMode: 'Performance',
      halfRes: false,
    });
    expect(getN8aoQualitySettings('full')).toEqual({
      qualityMode: 'Medium',
      halfRes: false,
    });
  });

  it('guards halfRes N8AO and HalfFloat composer behind WebGL extension support', () => {
    const makeRenderer = (isWebGL2: boolean, exts: string[]) => ({
      capabilities: { isWebGL2 } as unknown as WebGLCapabilitiesLike,
      extensions: { has: (name: string) => exts.includes(name) },
    });
    type WebGLCapabilitiesLike = { isWebGL2: boolean };

    expect(
      canUseHalfResN8ao(
        makeRenderer(true, ['EXT_color_buffer_float']) as unknown as Parameters<
          typeof canUseHalfResN8ao
        >[0],
      ),
    ).toBe(true);
    expect(
      canUseHalfResN8ao(
        makeRenderer(true, ['EXT_color_buffer_half_float']) as unknown as Parameters<
          typeof canUseHalfResN8ao
        >[0],
      ),
    ).toBe(false);
    expect(
      canUseHalfResN8ao(
        makeRenderer(false, ['EXT_color_buffer_float']) as unknown as Parameters<
          typeof canUseHalfResN8ao
        >[0],
      ),
    ).toBe(false);

    expect(
      canUseHalfFloatComposer(
        makeRenderer(true, ['EXT_color_buffer_half_float']) as unknown as Parameters<
          typeof canUseHalfFloatComposer
        >[0],
      ),
    ).toBe(true);
    expect(
      canUseHalfFloatComposer(
        makeRenderer(true, ['EXT_color_buffer_float']) as unknown as Parameters<
          typeof canUseHalfFloatComposer
        >[0],
      ),
    ).toBe(true);
    expect(
      canUseHalfFloatComposer(
        makeRenderer(true, []) as unknown as Parameters<typeof canUseHalfFloatComposer>[0],
      ),
    ).toBe(false);
  });

  it('suppresses upgrades when allowUpgrade is false (paused wake) while still allowing downgrades', () => {
    const gov = new PerfGovernor({ mode: 'auto', isTouch: false });
    // Step down 5 -> 4
    expect(feedFrames(gov, 160, 25).some((t) => t.toTier === 4)).toBe(true);
    gov.resetWarmup();

    // Even 1000 fast frames while paused (allowUpgrade: false) must never upgrade
    const transitions: ReturnType<PerfGovernor['recordFrame']>[] = [];
    for (let i = 0; i < 1000; i++) {
      const tr = gov.recordFrame(12, { allowUpgrade: false });
      if (tr) transitions.push(tr);
    }
    expect(transitions).toHaveLength(0);
    expect(gov.getTier()).toBe(4);

    // Slow frames with allowUpgrade: false still protect framerate by downgrading
    const downWhilePaused: ReturnType<PerfGovernor['recordFrame']>[] = [];
    for (let i = 0; i < 160; i++) {
      const tr = gov.recordFrame(25, { allowUpgrade: false });
      if (tr) downWhilePaused.push(tr);
    }
    expect(downWhilePaused.some((t) => t.direction === 'down' && t.toTier === 3)).toBe(true);
  });

  it('collects unique InstancedMesh materials missing instanceColor for warmUp precompilation', () => {
    const root = new THREE.Group();
    const geo = new THREE.BufferGeometry();
    const matNeedsColorA = new THREE.MeshBasicMaterial();
    const matNeedsColorB = new THREE.MeshStandardMaterial();
    const matAlreadyColored = new THREE.MeshBasicMaterial();
    const matPlainMesh = new THREE.MeshBasicMaterial();

    const instA1 = new THREE.InstancedMesh(geo, matNeedsColorA, 2);
    const instA2 = new THREE.InstancedMesh(geo, matNeedsColorA, 2);
    const instB = new THREE.InstancedMesh(geo, matNeedsColorB, 2);
    instB.castShadow = true;
    const instColored = new THREE.InstancedMesh(geo, matAlreadyColored, 2);
    instColored.setColorAt(0, new THREE.Color(1, 1, 1));
    const plain = new THREE.Mesh(geo, matPlainMesh);

    root.add(instA1, instA2, instB, instColored, plain);
    const variants = collectInstancedMaterialsNeedingColor([root]);
    expect(variants).toHaveLength(2);
    expect(variants.map((v) => v.material)).toEqual([matNeedsColorA, matNeedsColorB]);
    expect(variants[1].castShadow).toBe(true);

    instA1.dispose();
    instA2.dispose();
    instB.dispose();
    instColored.dispose();
    geo.dispose();
    matNeedsColorA.dispose();
    matNeedsColorB.dispose();
    matAlreadyColored.dispose();
    matPlainMesh.dispose();
  });

  it('routes post-processing warmUp materials into linear vs sRGB screen buckets', () => {
    const mats = Array.from({ length: 12 }, () => new THREE.ShaderMaterial());
    const [
      mDownsample,
      mAo,
      mDenoise,
      mAccum,
      mCompositer,
      mCopy,
      mLum,
      mMipDown,
      mMipUp,
      mComposite,
      mSmaaEdge,
      mSmaaWeights,
    ] = mats;
    const mSmaaFinal = new THREE.ShaderMaterial();

    const fullWithSmaa = collectPostWarmUpMaterials({
      n8aoPass: {
        configuration: { halfRes: false },
        depthDownsampleQuad: { material: mDownsample },
        effectShaderQuad: { material: mAo },
        standardDenoiseMaterial: mDenoise,
        accumulationQuad: { material: mAccum },
        effectCompositerQuad: { material: mCompositer },
        copyQuad: { material: mCopy },
      } as unknown as Parameters<typeof collectPostWarmUpMaterials>[0]['n8aoPass'],
      bloomEffect: {
        luminanceMaterial: mLum,
        mipmapBlurPass: { enabled: true, downsamplingMaterial: mMipDown, upsamplingMaterial: mMipUp },
      } as unknown as Parameters<typeof collectPostWarmUpMaterials>[0]['bloomEffect'],
      compositePass: {
        fullscreenMaterial: mComposite,
      } as unknown as Parameters<typeof collectPostWarmUpMaterials>[0]['compositePass'],
      smaaPass: {
        fullscreenMaterial: mSmaaFinal,
      } as unknown as Parameters<typeof collectPostWarmUpMaterials>[0]['smaaPass'],
      smaaEffect: {
        edgeDetectionMaterial: mSmaaEdge,
        weightsMaterial: mSmaaWeights,
      } as unknown as Parameters<typeof collectPostWarmUpMaterials>[0]['smaaEffect'],
    });

    // halfRes is false so depthDownsampleQuad is excluded; composite renders linearly into SMAA
    expect(fullWithSmaa.linearMaterials).toEqual([
      mAo,
      mDenoise,
      mAccum,
      mCompositer,
      mCopy,
      mLum,
      mMipDown,
      mMipUp,
      mComposite,
      mSmaaEdge,
      mSmaaWeights,
    ]);
    expect(fullWithSmaa.screenMaterials).toEqual([mSmaaFinal]);

    const halfNoSmaa = collectPostWarmUpMaterials({
      n8aoPass: {
        configuration: { halfRes: true },
        depthDownsampleQuad: { material: mDownsample },
        effectShaderQuad: { material: mAo },
        standardDenoiseMaterial: mDenoise,
        accumulationQuad: { material: mAccum },
        effectCompositerQuad: { material: mCompositer },
        copyQuad: { material: mCopy },
      } as unknown as Parameters<typeof collectPostWarmUpMaterials>[0]['n8aoPass'],
      bloomEffect: null,
      compositePass: {
        fullscreenMaterial: mComposite,
      } as unknown as Parameters<typeof collectPostWarmUpMaterials>[0]['compositePass'],
      smaaPass: null,
      smaaEffect: null,
    });

    // halfRes includes depthDownsampleQuad; without SMAA, composite renders directly to screen
    expect(halfNoSmaa.linearMaterials).toEqual([
      mDownsample,
      mAo,
      mDenoise,
      mAccum,
      mCompositer,
      mCopy,
    ]);
    expect(halfNoSmaa.screenMaterials).toEqual([mComposite]);

    for (const m of mats) m.dispose();
    mSmaaFinal.dispose();
  });

  it('skips unconditional fullscreen depth reads in SilhouetteOutlineEffect while preserving depth attachment', () => {
    const cam = new THREE.OrthographicCamera();
    const outline = new SilhouetteOutlineEffect(1.06, 0x181628, 0.72);
    const pass = new EffectPass(cam, outline);
    pass.recompile();

    const frag = (pass.fullscreenMaterial as THREE.ShaderMaterial).fragmentShader;
    expect(pass.needsDepthTexture).toBe(true);
    expect(frag).not.toContain('float depth = readDepth(UV);');
    expect(frag).toContain('if (isUnit > 0.0)');
    expect(frag).toContain('if (edge > 0.0)');
    expect(frag).toContain('readDepth(uv)');

    pass.dispose();
  });

  it('aborts and disposes parsed geometries and delayed colormap texture when parallel GLB preload fails', async () => {
    const glbBytes = fs.readFileSync(
      path.resolve(process.cwd(), 'public/models/kenney/detail-crystal.glb'),
    );
    const glbBuf = glbBytes.buffer.slice(
      glbBytes.byteOffset,
      glbBytes.byteOffset + glbBytes.byteLength,
    );

    const disposedGeos: THREE.BufferGeometry[] = [];
    const origGeoDispose = THREE.BufferGeometry.prototype.dispose;
    const geoDisposeSpy = vi
      .spyOn(THREE.BufferGeometry.prototype, 'dispose')
      .mockImplementation(function (this: THREE.BufferGeometry) {
        disposedGeos.push(this);
        return origGeoDispose.call(this);
      });

    const disposedTexs: THREE.Texture[] = [];
    const origTexDispose = THREE.Texture.prototype.dispose;
    const texDisposeSpy = vi
      .spyOn(THREE.Texture.prototype, 'dispose')
      .mockImplementation(function (this: THREE.Texture) {
        disposedTexs.push(this);
        return origTexDispose.call(this);
      });

    vi.stubGlobal(
      'Image',
      class FakeImage {
        width = 64;
        height = 64;
        crossOrigin = '';
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_v: string) {
          setTimeout(() => this.onload?.(), 15);
        }
      },
    );
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 64,
        height: 64,
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }),
          putImageData: () => {},
          fillRect: () => {},
          fillStyle: '',
        }),
      }),
    });

    let treeArrayBufferCalled = false;
    const observedSignals: AbortSignal[] = [];
    vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
      if (init?.signal) observedSignals.push(init.signal);
      if (url.includes('detail-crystal')) {
        // Completes immediately before detail-rocks rejects, so its geometry is parsed and must be disposed on catch.
        return Promise.resolve({
          ok: true,
          arrayBuffer: () => Promise.resolve(glbBuf.slice(0)),
        } as unknown as Response);
      }
      if (url.includes('detail-rocks')) {
        return new Promise<Response>((resolve) => {
          setTimeout(() => resolve({ ok: false, status: 404 } as Response), 5);
        });
      }
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve({
            ok: true,
            arrayBuffer: () => {
              treeArrayBufferCalled = true;
              return Promise.resolve(glbBuf.slice(0));
            },
          } as unknown as Response);
        }, 12);
      });
    });

    try {
      await expect(
        KenneyAssetStore.preload(undefined, ['detail-crystal', 'detail-rocks', 'detail-tree']),
      ).rejects.toThrow('Failed to load model "detail-rocks" (404)');
      expect(disposedGeos.length).toBeGreaterThanOrEqual(1);
      expect(observedSignals.length).toBe(3);
      expect(observedSignals.every((s) => s.aborted)).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(disposedTexs.length).toBe(1);
      expect(treeArrayBufferCalled).toBe(false);
    } finally {
      geoDisposeSpy.mockRestore();
      texDisposeSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('clears lastChangeSec cooldown when setMode resets governor state', () => {
    const gov = new PerfGovernor({ mode: 'auto', isTouch: false });
    // Trigger an immediate downgrade so lastChangeSec advances
    expect(feedFrames(gov, 160, 26).some((t) => t.toTier === 4)).toBe(true);

    // Switch away and back to auto, bypassing initial warmup to test downgradeCooldownSec (2.0s):
    // without clearing lastChangeSec, 1.2s of severe 40ms frames (< 2.0s cooldown) would be blocked.
    gov.setMode('high');
    gov.setMode('auto');
    gov.resetWarmup(0);

    const tr = feedFrames(gov, 35, 40);
    expect(tr.length).toBeGreaterThanOrEqual(1);
    expect(tr[0]).toMatchObject({ fromTier: 5, toTier: 3, direction: 'down' });
  });

  it('preserves GLTFLoader bounds on single-mesh identity GLBs and computes bounds for multi-part GLBs', async () => {
    const crystalBuf = fs.readFileSync(
      path.resolve(process.cwd(), 'public/models/kenney/detail-crystal.glb'),
    );
    const ballistaBuf = fs.readFileSync(
      path.resolve(process.cwd(), 'public/models/kenney/weapon-ballista.glb'),
    );

    vi.stubGlobal(
      'Image',
      class FakeImage {
        width = 64;
        height = 64;
        crossOrigin = '';
        onload: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 64,
        height: 64,
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }),
          putImageData: () => {},
          fillRect: () => {},
          fillStyle: '',
        }),
      }),
    });
    vi.stubGlobal('fetch', (url: string) => {
      const src = url.includes('detail-crystal') ? crystalBuf : ballistaBuf;
      return Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () =>
          Promise.resolve(src.buffer.slice(src.byteOffset, src.byteOffset + src.byteLength)),
      } as unknown as Response);
    });

    const boxSpy = vi.spyOn(THREE.BufferGeometry.prototype, 'computeBoundingBox');
    try {
      const store = await KenneyAssetStore.preload(undefined, [
        'detail-crystal',
        'weapon-ballista',
      ]);
      const crystal = store.cloneGeometry('detail-crystal');
      const ballista = store.cloneGeometry('weapon-ballista');

      expect(crystal.boundingBox).not.toBeNull();
      expect(crystal.boundingSphere).not.toBeNull();
      expect(ballista.boundingBox).not.toBeNull();
      expect(ballista.boundingSphere).not.toBeNull();
      // Only the 2-part merged weapon-ballista (and GLTFLoader internal calls if any) should compute boxes;
      // single-mesh identity detail-crystal preserves GLTFLoader's box directly.
      expect(boxSpy.mock.calls.length).toBeLessThanOrEqual(3);

      crystal.dispose();
      ballista.dispose();
      store.dispose();
    } finally {
      boxSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('defers DebugPanel telemetry refresh after resetDisplaySmoothing, skips while collapsed, and refreshes on Show', () => {
    const makeEl = (tag: string) => {
      const listeners = new Map<string, () => void>();
      const el = {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        textContent: '',
        children: [] as unknown[],
        classList: { toggle: () => {} },
        setAttribute: () => {},
        addEventListener: (type: string, cb: () => void) => listeners.set(type, cb),
        trigger: (type: string) => listeners.get(type)?.(),
        append: (...args: unknown[]) => {
          el.children.push(...args);
        },
        appendChild: (child: unknown) => {
          el.children.push(child);
          return child;
        },
        remove: () => {},
      };
      return el;
    };
    const rootStub = makeEl('div');
    vi.stubGlobal('document', { createElement: (tag: string) => makeEl(tag) });

    let telemetryCalls = 0;
    const panel = new DebugPanel(
      rootStub as unknown as HTMLElement,
      {
        onAddGold: () => {},
        onSetLives: () => {},
        onSkipToWave: () => {},
        onSpawnEnemies: () => {},
        onInstantWin: () => {},
        onInstantLose: () => {},
        onToggleAllRangeRings: () => {},
        getTelemetry: () => {
          telemetryCalls++;
          return {
            fps: 60,
            frameTimeMs: 16.6,
            drawCalls: 20,
            drawsWithShadows: 20,
            drawsNoShadows: 10,
            triangles: 1000,
            enemiesActive: 0,
            enemiesMax: 256,
            towersCount: 0,
            projectilesActive: 0,
            projectilesMax: 256,
            particlesActive: 0,
            particlesMax: 512,
            floatingTextsActive: 0,
            floatingTextsMax: 60,
          };
        },
      },
      'perf',
    );

    try {
      const panelRoot = rootStub.children[0] as ReturnType<typeof makeEl>;
      const header = panelRoot.children[0] as ReturnType<typeof makeEl>;
      const toggleBtn = header.children[1] as ReturnType<typeof makeEl>;

      // Boot update(0) renders immediately
      panel.update(0);
      expect(telemetryCalls).toBe(1);

      // Reset clears uiRefreshAccum so the next single 50ms frame does not flash empty metrics
      panel.resetDisplaySmoothing();
      panel.update(0.05);
      expect(telemetryCalls).toBe(1);

      // After accumulating >= 0.2s, telemetry refreshes normally
      panel.update(0.16);
      expect(telemetryCalls).toBe(2);

      // Collapse skips telemetry polling; expanding refreshes immediately on click
      toggleBtn.trigger('click');
      expect(toggleBtn.textContent).toBe('Show');
      panel.update(0.25);
      expect(telemetryCalls).toBe(2);

      toggleBtn.trigger('click');
      expect(toggleBtn.textContent).toBe('Hide');
      expect(telemetryCalls).toBe(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses compileAsync only when KHR_parallel_shader_compile is supported to avoid 10ms timer stalls on WebKit', () => {
    const compileAsync = async () => [];
    expect(
      shouldUseAsyncShaderCompile({
        compileAsync: compileAsync as unknown as THREE.WebGLRenderer['compileAsync'],
        extensions: { has: (name: string) => name === 'KHR_parallel_shader_compile' } as THREE.WebGLExtensions,
      }),
    ).toBe(true);

    expect(
      shouldUseAsyncShaderCompile({
        compileAsync: compileAsync as unknown as THREE.WebGLRenderer['compileAsync'],
        extensions: { has: () => false } as unknown as THREE.WebGLExtensions,
      }),
    ).toBe(false);

    expect(
      shouldUseAsyncShaderCompile({
        extensions: { has: () => true } as unknown as THREE.WebGLExtensions,
      }),
    ).toBe(false);
  });

  it('yields cooperatively via scheduler.yield, MessageChannel (closing ports), or setTimeout fallback', async () => {
    let schedCalled = false;
    vi.stubGlobal('scheduler', {
      yield: () => {
        schedCalled = true;
        return Promise.resolve();
      },
    });
    await yieldMainThread();
    expect(schedCalled).toBe(true);

    vi.stubGlobal('scheduler', undefined);
    let closedPorts = 0;
    let timeoutCalled = false;
    vi.stubGlobal('setTimeout', (cb: () => void) => {
      timeoutCalled = true;
      cb();
      return 1;
    });
    vi.stubGlobal(
      'MessageChannel',
      class FakeMessageChannel {
        port1 = {
          onmessage: null as (() => void) | null,
          close: () => {
            closedPorts++;
          },
        };
        port2 = {
          postMessage: () => {
            queueMicrotask(() => this.port1.onmessage?.());
          },
          close: () => {
            closedPorts++;
          },
        };
      },
    );
    await yieldMainThread();
    expect(closedPorts).toBe(2);
    expect(timeoutCalled).toBe(false);

    vi.stubGlobal('MessageChannel', undefined);
    await yieldMainThread();
    expect(timeoutCalled).toBe(true);

    vi.unstubAllGlobals();
  });

  it('accounts non-overlapping parse CPU across concurrent preload workers without spurious yields', async () => {
    const crystalBuf = fs.readFileSync(
      path.resolve(process.cwd(), 'public/models/kenney/detail-crystal.glb'),
    );
    const models = [
      'tile-straight',
      'tile-corner-round',
      'tile-end-round',
      'tile-spawn-end-round',
      'tile-crossing',
      'tile-split',
      'spawn-square',
      'wood-structure-high',
      'wood-structure',
      'detail-tree',
    ] as const;

    let yieldCount = 0;
    vi.stubGlobal('scheduler', {
      yield: () => {
        yieldCount++;
        return Promise.resolve();
      },
    });
    vi.stubGlobal(
      'Image',
      class FakeImage {
        width = 64;
        height = 64;
        crossOrigin = '';
        onload: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 64,
        height: 64,
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }),
          putImageData: () => {},
          fillRect: () => {},
          fillStyle: '',
        }),
      }),
    });
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        status: 200,
        arrayBuffer: () =>
          Promise.resolve(
            crystalBuf.buffer.slice(crystalBuf.byteOffset, crystalBuf.byteOffset + crystalBuf.byteLength),
          ),
      } as unknown as Response),
    );

    let fakeClockMs = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
      fakeClockMs += 0.4;
      return fakeClockMs;
    });

    try {
      // 10 concurrent workers start at 0.4..4.0ms and finish at 4.4..8.0ms (< 10ms total span):
      // overlapping spans would sum to 40ms if summed naively, but non-overlapping accounting yields 0 times.
      const storeFast = await KenneyAssetStore.preload(undefined, models);
      expect(yieldCount).toBe(0);
      storeFast.dispose();

      // When actual non-overlapping CPU time crosses >= 10ms, a cooperative yield fires once.
      fakeClockMs = 0;
      nowSpy.mockImplementation(() => {
        fakeClockMs += 1.0;
        return fakeClockMs;
      });
      const storeSlow = await KenneyAssetStore.preload(undefined, models);
      expect(yieldCount).toBe(1);
      storeSlow.dispose();
    } finally {
      nowSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('defers newly arriving GLB parses when another worker already triggered a frame yield', async () => {
    const crystalBuf = fs.readFileSync(
      path.resolve(process.cwd(), 'public/models/kenney/detail-crystal.glb'),
    );
    let resolveYield: (() => void) | null = null;
    let yieldCalls = 0;
    vi.stubGlobal('scheduler', {
      yield: () => {
        yieldCalls++;
        if (yieldCalls === 1) {
          return new Promise<void>((resolve) => {
            resolveYield = resolve;
          });
        }
        return Promise.resolve();
      },
    });
    vi.stubGlobal(
      'Image',
      class FakeImage {
        width = 64;
        height = 64;
        crossOrigin = '';
        onload: (() => void) | null = null;
        set src(_v: string) {
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    vi.stubGlobal('document', {
      createElement: () => ({
        width: 64,
        height: 64,
        getContext: () => ({
          drawImage: () => {},
          getImageData: () => ({ data: new Uint8ClampedArray(64 * 64 * 4) }),
          putImageData: () => {},
          fillRect: () => {},
          fillStyle: '',
        }),
      }),
    });
    vi.stubGlobal('fetch', (url: string) => {
      const makeRes = () =>
        ({
          ok: true,
          status: 200,
          arrayBuffer: () =>
            Promise.resolve(
              crystalBuf.buffer.slice(crystalBuf.byteOffset, crystalBuf.byteOffset + crystalBuf.byteLength),
            ),
        }) as unknown as Response;
      if (url.includes('detail-crystal')) {
        return Promise.resolve(makeRes());
      }
      return new Promise<Response>((resolve) => {
        setTimeout(() => resolve(makeRes()), 5);
      });
    });

    let fakeClockMs = 0;
    const nowSpy = vi.spyOn(performance, 'now').mockImplementation(() => {
      fakeClockMs += 12;
      return fakeClockMs;
    });

    const completedLabels: string[] = [];
    try {
      const preloadPromise = KenneyAssetStore.preload(
        (_loaded, _total, label) => completedLabels.push(label),
        ['detail-crystal', 'detail-rocks'],
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(resolveYield).not.toBeNull();
      expect(completedLabels).toContain('detail-crystal');
      expect(completedLabels).not.toContain('detail-rocks');

      resolveYield?.();
      const store = await preloadPromise;
      expect(completedLabels).toContain('detail-rocks');
      store.dispose();
    } finally {
      nowSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('disposes late-loaded SMAA LUT textures when PostProcessingPipeline is disposed before Image load', async () => {
    const loadCallbacks: Array<() => void> = [];
    vi.stubGlobal(
      'Image',
      class FakeSmaaImage {
        width = 16;
        height = 16;
        addEventListener(type: string, cb: () => void): void {
          if (type === 'load') loadCallbacks.push(cb);
        }
        set src(_v: string) {}
      },
    );

    const disposedTexNames: string[] = [];
    const origTexDispose = THREE.Texture.prototype.dispose;
    const texDisposeSpy = vi
      .spyOn(THREE.Texture.prototype, 'dispose')
      .mockImplementation(function (this: THREE.Texture) {
        if (this.name.startsWith('SMAA.')) {
          disposedTexNames.push(this.name);
        }
        return origTexDispose.call(this);
      });

    const { renderer: mockRenderer } = createMockPostRenderer(800, 600);

    try {
      const pipeline = new PostProcessingPipeline(
        mockRenderer,
        new THREE.Scene(),
        new THREE.OrthographicCamera(),
        800,
        600,
        { n8ao: 'off', outline: false, bloom: false, smaa: true },
      );
      expect(loadCallbacks).toHaveLength(2);

      // Dispose before SMAA's embedded data-URL images finish decoding -> whenReady resolves promptly
      const ready = pipeline.whenReady();
      pipeline.dispose();
      await ready;
      expect(disposedTexNames).toEqual([]);

      // When late async Image load fires after disposal, SMAA.Search & SMAA.Area are disposed cleanly
      for (const cb of loadCallbacks) cb();
      expect(disposedTexNames).toEqual(['SMAA.Search', 'SMAA.Area']);
    } finally {
      texDisposeSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it('preserves depthRenderTarget across composite swaps, keeps pass order, and clamps halfRes N8AO on 1x1 buffers', () => {
    vi.stubGlobal('Image', undefined);
    const { renderer: mockRenderer } = createMockPostRenderer(800, 600);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera();

    const pipeline = new PostProcessingPipeline(mockRenderer, scene, camera, 800, 600, {
      n8ao: 'full',
      outline: true,
      bloom: true,
      smaa: true,
    });

    try {
      type ComposerInternals = {
        depthRenderTarget: THREE.WebGLRenderTarget | null;
        passes: Array<{ renderToScreen: boolean; name?: string }>;
      };
      type PipelineInternals = {
        n8aoPass: {
          width: number;
          height: number;
          autoDetectTransparency: boolean;
          effectCompositerQuad: { material: THREE.ShaderMaterial };
        } | null;
      };
      const composer = pipeline.composer as unknown as ComposerInternals;
      const initialDepthTarget = composer.depthRenderTarget;
      expect(initialDepthTarget).not.toBeNull();
      expect(composer.passes).toHaveLength(4); // RenderPass, N8AO, Composite, SMAA
      expect(composer.passes.map((p) => p.renderToScreen)).toEqual([false, false, false, true]);
      expect(pipeline.getActivePassSummary()).toBe('AO+Out+Bloom+SMAA');

      const internals = pipeline as unknown as PipelineInternals;
      expect(internals.n8aoPass?.autoDetectTransparency).toBe(false);
      expect(internals.n8aoPass?.effectCompositerQuad.material.fragmentShader).toContain('#define ORTHO');

      // Step down directly from Tier 5 -> Tier 4 (full -> half N8AO in-place, SMAA dropped)
      const tier4 = { n8ao: 'half' as const, outline: true, bloom: true, smaa: false };
      const initialN8ao = internals.n8aoPass;
      pipeline.releaseDisabledPasses(tier4);
      pipeline.setSize(1, 1);
      pipeline.applyConfig(tier4);
      expect(internals.n8aoPass).toBe(initialN8ao);
      expect(composer.passes).toHaveLength(3); // RenderPass, N8AO, Composite
      expect(composer.passes.map((p) => p.renderToScreen)).toEqual([false, false, true]);
      expect(composer.depthRenderTarget).toBe(initialDepthTarget);
      expect(internals.n8aoPass?.width).toBeGreaterThanOrEqual(2);
      expect(internals.n8aoPass?.height).toBeGreaterThanOrEqual(2);
      expect(internals.n8aoPass?.effectCompositerQuad.material.fragmentShader).toContain('#define ORTHO');
      expect(pipeline.getActivePassSummary()).toBe('AO½+Out+Bloom');

      // Step down to Tier 3 (off N8AO) using releaseDisabledPasses -> resize -> applyConfig
      const tier3 = { n8ao: 'off' as const, outline: true, bloom: true, smaa: false };
      pipeline.releaseDisabledPasses(tier3);
      expect(composer.passes).toHaveLength(2); // RenderPass, Composite
      expect(composer.passes[1].renderToScreen).toBe(true);
      expect(composer.depthRenderTarget).toBe(initialDepthTarget);
      pipeline.setSize(640, 480);
      pipeline.applyConfig(tier3);
      expect(pipeline.getActivePassSummary()).toBe('Out+Bloom');

      // Step down to Tier 2 (drop Bloom -> compositePass rebuilt in-place, preserving depthRenderTarget)
      const tier2 = { n8ao: 'off' as const, outline: true, bloom: false, smaa: false };
      pipeline.applyConfig(tier2);
      expect(composer.passes).toHaveLength(2);
      expect(composer.passes[1].renderToScreen).toBe(true);
      expect(composer.depthRenderTarget).toBe(initialDepthTarget);
      expect(pipeline.getActivePassSummary()).toBe('Out');

      // Upgrade back to Tier 4 (halfRes N8AO) at a 1x1 layout size -> clamped to >= 2x2
      pipeline.setSize(1, 1);
      pipeline.applyConfig(tier4);
      expect(composer.passes).toHaveLength(3); // RenderPass, N8AO, Composite
      expect(composer.passes.map((p) => p.renderToScreen)).toEqual([false, false, true]);
      expect(internals.n8aoPass?.width).toBeGreaterThanOrEqual(2);
      expect(internals.n8aoPass?.height).toBeGreaterThanOrEqual(2);
      expect(internals.n8aoPass?.effectCompositerQuad.material.fragmentShader).toContain('#define ORTHO');
      expect(pipeline.getActivePassSummary()).toBe('AO½+Out+Bloom');
    } finally {
      pipeline.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('clamps sub-1.0 DPR render dimensions to keep >=1px WebGL framebuffers and creates zero-area instanced shadow warm meshes', () => {
    expect(computeSafeRenderDimensions(1, 1, 0.85)).toEqual({ width: 2, height: 2 });
    expect(computeSafeRenderDimensions(1, 1, 0.5)).toEqual({ width: 2, height: 2 });
    expect(computeSafeRenderDimensions(800, 600, 0.85)).toEqual({ width: 800, height: 600 });
    expect(computeSafeRenderDimensions(800, 600, 1.5)).toEqual({ width: 800, height: 600 });

    const mat = new THREE.MeshBasicMaterial();
    const warmNoColor = createInstancedShadowWarmMesh(mat, { withHighlight: true, receiveShadow: true });
    expect(warmNoColor.mesh.castShadow).toBe(true);
    expect(warmNoColor.mesh.receiveShadow).toBe(true);
    expect(warmNoColor.mesh.frustumCulled).toBe(false);
    expect(warmNoColor.mesh.count).toBe(1);
    expect(warmNoColor.mesh.instanceColor).toBeNull();
    expect(warmNoColor.geometry.hasAttribute('aHighlight')).toBe(true);
    const pos = warmNoColor.geometry.getAttribute('position');
    expect(Array.from(pos.array)).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);

    const scene = new THREE.Scene();
    scene.add(warmNoColor.mesh);
    expect(hasVisibleInstancedColorShadowCaster(scene)).toBe(false);

    const warmWithColor = createInstancedShadowWarmMesh(mat, { withColor: true });
    warmWithColor.mesh.visible = false;
    scene.add(warmWithColor.mesh);
    expect(hasVisibleInstancedColorShadowCaster(scene)).toBe(false);

    warmWithColor.mesh.visible = true;
    expect(hasVisibleInstancedColorShadowCaster(scene)).toBe(true);

    warmNoColor.mesh.dispose();
    warmNoColor.geometry.dispose();
    warmWithColor.mesh.dispose();
    warmWithColor.geometry.dispose();
    mat.dispose();
  });

  it('defers runtime SMAA pass attachment until LUT textures finish loading and guards disposed pipeline methods', async () => {
    const loadCallbacks: Array<() => void> = [];
    vi.stubGlobal(
      'Image',
      class FakeSmaaImage {
        width = 16;
        height = 16;
        addEventListener(type: string, cb: () => void): void {
          if (type === 'load') loadCallbacks.push(cb);
        }
        set src(_v: string) {}
      },
    );

    const { renderer: mockRenderer } = createMockPostRenderer(800, 600);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera();

    const pipeline = new PostProcessingPipeline(
      mockRenderer,
      scene,
      camera,
      800,
      600,
      { n8ao: 'off', outline: true, bloom: true, smaa: false },
    );

    try {
      type ComposerInternals = {
        passes: Array<{ renderToScreen: boolean }>;
      };
      const composer = pipeline.composer as unknown as ComposerInternals;
      expect(composer.passes).toHaveLength(2); // RenderPass, Composite
      expect(composer.passes[1].renderToScreen).toBe(true);

      // Runtime upgrade T4 -> T5 enables SMAA while images decode asynchronously
      pipeline.applyConfig({ n8ao: 'off', outline: true, bloom: true, smaa: true });
      expect(loadCallbacks).toHaveLength(2);
      // Composite remains renderToScreen until SMAA search & area LUT textures finish loading
      expect(composer.passes).toHaveLength(2);
      expect(composer.passes[1].renderToScreen).toBe(true);
      expect(pipeline.getActivePassSummary()).toBe('Out+Bloom');

      for (const cb of loadCallbacks) cb();
      await pipeline.whenReady();
      expect(composer.passes).toHaveLength(3);
      expect(composer.passes.map((p) => p.renderToScreen)).toEqual([false, false, true]);
      expect(pipeline.getActivePassSummary()).toBe('Out+Bloom+SMAA');

      // Post-dispose lifecycle calls are safe no-ops
      pipeline.dispose();
      pipeline.applyConfig({ n8ao: 'off', outline: false, bloom: false, smaa: false });
      pipeline.releaseDisabledPasses({ n8ao: 'off', outline: false, bloom: false, smaa: false });
      pipeline.setSize(640, 480);

      // Deferred SMAA option on lazy pipeline creation also avoids attaching before LUT load
      loadCallbacks.length = 0;
      const lazyPipeline = new PostProcessingPipeline(
        mockRenderer,
        scene,
        camera,
        800,
        600,
        { n8ao: 'off', outline: true, bloom: false, smaa: true },
        { deferSmaaAttachUntilReady: true },
      );
      const lazyComposer = lazyPipeline.composer as unknown as ComposerInternals;
      expect(lazyComposer.passes).toHaveLength(2);
      expect(lazyComposer.passes[1].renderToScreen).toBe(true);
      expect(lazyPipeline.getActivePassSummary()).toBe('Out');
      for (const cb of loadCallbacks) cb();
      await lazyPipeline.whenReady();
      expect(lazyComposer.passes).toHaveLength(3);
      expect(lazyComposer.passes.map((p) => p.renderToScreen)).toEqual([false, false, true]);
      expect(lazyPipeline.getActivePassSummary()).toBe('Out+SMAA');
      lazyPipeline.dispose();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('chunks sync shader compilation across yieldMainThread on non-parallel drivers and uses parallel compileAsync otherwise', async () => {
    const events: string[] = [];
    vi.stubGlobal('scheduler', {
      yield: () => {
        events.push('yield');
        return Promise.resolve();
      },
    });

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera();
    const extraGroup = new THREE.Group();
    const linearPostGroup = new THREE.Group();
    const screenPostGroup = new THREE.Group();
    const postCamera = new THREE.OrthographicCamera();
    const linearTarget = { name: 'inputBuffer' } as unknown as THREE.WebGLRenderTarget;

    try {
      // 1. Non-parallel driver (e.g. WebKit / iOS Safari): chunks scene+extra, yields, then compiles post groups
      const syncRenderer = {
        extensions: { has: () => false } as unknown as THREE.WebGLExtensions,
        setRenderTarget: (t: THREE.WebGLRenderTarget | null) =>
          events.push(t ? 'target:linear' : 'target:screen'),
        compile: (obj: THREE.Object3D) => {
          if (obj === scene) events.push('compile:scene');
          else if (obj === extraGroup) events.push('compile:extra');
          else if (obj === linearPostGroup) events.push('compile:linearPost');
          else if (obj === screenPostGroup) events.push('compile:screenPost');
        },
        compileAsync: async () => [],
      } as unknown as Parameters<typeof compileWarmUpGroups>[0]['renderer'];

      const syncUsed = await compileWarmUpGroups({
        renderer: syncRenderer,
        scene,
        camera,
        linearTarget,
        extraGroup,
        linearPostGroup,
        screenPostGroup,
        postCamera,
        whenPostReady: async () => {
          events.push('postReady');
        },
        isAborted: () => false,
      });

      expect(syncUsed).toBe(true);
      expect(events).toEqual([
        'target:linear',
        'compile:scene',
        'compile:extra',
        'yield',
        'target:linear',
        'compile:linearPost',
        'target:screen',
        'compile:screenPost',
        'postReady',
      ]);

      // 2. Parallel driver (KHR_parallel_shader_compile): compiles all groups in one batch without mid-compile yields
      events.length = 0;
      const parallelRenderer = {
        extensions: { has: (ext: string) => ext === 'KHR_parallel_shader_compile' } as unknown as THREE.WebGLExtensions,
        setRenderTarget: (t: THREE.WebGLRenderTarget | null) =>
          events.push(t ? 'target:linear' : 'target:screen'),
        compile: () => {
          events.push('sync-fallback');
          return new Set();
        },
        compileAsync: async (obj: THREE.Object3D) => {
          if (obj === scene) events.push('async:scene');
          else if (obj === extraGroup) events.push('async:extra');
          else if (obj === linearPostGroup) events.push('async:linearPost');
          else if (obj === screenPostGroup) events.push('async:screenPost');
          return [];
        },
      } as unknown as Parameters<typeof compileWarmUpGroups>[0]['renderer'];

      const parallelUsed = await compileWarmUpGroups({
        renderer: parallelRenderer,
        scene,
        camera,
        linearTarget,
        extraGroup,
        linearPostGroup,
        screenPostGroup,
        postCamera,
        whenPostReady: async () => {
          events.push('postReady');
        },
        isAborted: () => false,
      });

      expect(parallelUsed).toBe(false);
      expect(events).toEqual([
        'target:linear',
        'async:scene',
        'async:extra',
        'async:linearPost',
        'target:screen',
        'async:screenPost',
        'postReady',
      ]);

      // 3. compileAsync rejection falls back cleanly to chunked sync compile
      events.length = 0;
      const failingParallelRenderer = {
        ...syncRenderer,
        extensions: { has: (ext: string) => ext === 'KHR_parallel_shader_compile' } as unknown as THREE.WebGLExtensions,
        compileAsync: async () => {
          throw new Error('compileAsync unavailable');
        },
      } as unknown as Parameters<typeof compileWarmUpGroups>[0]['renderer'];

      const fellBack = await compileWarmUpGroups({
        renderer: failingParallelRenderer,
        scene,
        camera,
        linearTarget,
        extraGroup: null,
        linearPostGroup,
        screenPostGroup: null,
        postCamera,
        whenPostReady: async () => {},
        isAborted: () => false,
      });
      expect(fellBack).toBe(true);
      expect(events).toContain('yield');
      expect(events).toContain('compile:linearPost');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('drops BloomEffect inside releaseDisabledPasses before resize and avoids duplicate composite rebuild', () => {
    vi.stubGlobal('Image', undefined);
    const { renderer: mockRenderer } = createMockPostRenderer(800, 600);
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera();

    const pipeline = new PostProcessingPipeline(mockRenderer, scene, camera, 800, 600, {
      n8ao: 'off',
      outline: true,
      bloom: true,
      smaa: true,
    });

    try {
      type ComposerInternals = {
        depthRenderTarget: THREE.WebGLRenderTarget | null;
        passes: Array<{ renderToScreen: boolean }>;
      };
      type PipelineInternals = {
        bloomEffect: { setSize: (w: number, h: number) => void } | null;
        compositePass: EffectPass | null;
      };
      const composer = pipeline.composer as unknown as ComposerInternals;
      const internals = pipeline as unknown as PipelineInternals;
      const initialDepthTarget = composer.depthRenderTarget;
      const initialBloom = internals.bloomEffect;
      expect(initialBloom).not.toBeNull();
      const bloomSetSizeSpy = vi.spyOn(initialBloom!, 'setSize');

      // Tier 3/5 -> Tier 2: releaseDisabledPasses drops Bloom & SMAA before resize so Bloom's
      // mipmap targets are never resized at the new resolution right before disposal.
      const tier2 = { n8ao: 'off' as const, outline: true, bloom: false, smaa: false };
      pipeline.releaseDisabledPasses(tier2);
      const compositeAfterRelease = internals.compositePass;
      expect(internals.bloomEffect).toBeNull();
      expect(composer.depthRenderTarget).toBe(initialDepthTarget);
      expect(composer.passes).toHaveLength(2); // RenderPass, Composite
      expect(composer.passes[1].renderToScreen).toBe(true);

      pipeline.setSize(640, 480);
      expect(bloomSetSizeSpy).not.toHaveBeenCalled();

      // Subsequent applyConfig recognizes compositePass is already up to date
      pipeline.applyConfig(tier2);
      expect(internals.compositePass).toBe(compositeAfterRelease);
      expect(pipeline.getActivePassSummary()).toBe('Out');
    } finally {
      pipeline.dispose();
      vi.unstubAllGlobals();
    }
  });

  it('finds hidden/empty instanceColor shadow casters for shadow depth warm-up fallback', () => {
    const scene = new THREE.Scene();
    const geo = new THREE.BufferGeometry();
    const nonShadowMat = new THREE.MeshBasicMaterial();
    const uncoloredMat = new THREE.MeshBasicMaterial();
    const enemyShadowMat = new THREE.MeshStandardMaterial();

    const nonShadowInst = new THREE.InstancedMesh(geo, nonShadowMat, 2);
    nonShadowInst.setColorAt(0, new THREE.Color(1, 1, 1));
    nonShadowInst.castShadow = false;
    nonShadowInst.count = 0;

    const uncoloredInst = new THREE.InstancedMesh(geo, uncoloredMat, 2);
    uncoloredInst.castShadow = true;
    uncoloredInst.count = 0;

    const hiddenEnemyInst = new THREE.InstancedMesh(geo, enemyShadowMat, 2);
    hiddenEnemyInst.setColorAt(0, new THREE.Color(1, 1, 1));
    hiddenEnemyInst.castShadow = true;
    hiddenEnemyInst.receiveShadow = false;
    hiddenEnemyInst.count = 0;
    hiddenEnemyInst.visible = false;

    scene.add(nonShadowInst, uncoloredInst, hiddenEnemyInst);
    expect(hasVisibleInstancedColorShadowCaster(scene)).toBe(false);
    expect(findHiddenInstancedColorShadowCasterMaterial(scene)).toEqual({
      material: enemyShadowMat,
      receiveShadow: false,
    });

    nonShadowInst.dispose();
    uncoloredInst.dispose();
    hiddenEnemyInst.dispose();
    geo.dispose();
    nonShadowMat.dispose();
    uncoloredMat.dispose();
    enemyShadowMat.dispose();
  });
});
