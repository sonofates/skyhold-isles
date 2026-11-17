import * as fs from 'node:fs';
import * as path from 'node:path';
import { EffectPass } from 'postprocessing';
import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import { KenneyAssetStore } from '../../src/render/kenneyAssets.ts';
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
  SilhouetteOutlineEffect,
  canUseHalfFloatComposer,
  canUseHalfResN8ao,
  collectPostWarmUpMaterials,
  getN8aoQualitySettings,
} from '../../src/render/postProcessing.ts';
import {
  collectInstancedMaterialsNeedingColor,
  detectPrimaryTouchDevice,
} from '../../src/render/sceneManager.ts';
import { DebugPanel, formatPerfLogLine } from '../../src/ui/debugPanel.ts';

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
    vi.stubGlobal('fetch', (url: string) => {
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

  it('defers DebugPanel telemetry refresh after resetDisplaySmoothing while keeping boot update immediate', () => {
    const makeEl = (tag: string) => {
      const el: Record<string, unknown> = {
        tagName: tag.toUpperCase(),
        id: '',
        className: '',
        textContent: '',
        children: [] as unknown[],
        classList: { toggle: () => {} },
        setAttribute: () => {},
        addEventListener: () => {},
        append: (...args: unknown[]) => {
          (el.children as unknown[]).push(...args);
        },
        appendChild: (child: unknown) => {
          (el.children as unknown[]).push(child);
          return child;
        },
        remove: () => {},
      };
      return el;
    };
    vi.stubGlobal('document', { createElement: (tag: string) => makeEl(tag) });

    let telemetryCalls = 0;
    const panel = new DebugPanel(
      makeEl('div') as unknown as HTMLElement,
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
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
