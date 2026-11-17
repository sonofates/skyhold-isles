import * as THREE from 'three';
import type { QualityLevel } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { PALETTE_HEX, SKY_HORIZON_HEX, SKY_ZENITH_HEX } from '../data/palette.ts';
import { isTouchDevice } from '../platform/storage.ts';
import {
  PerfGovernor,
  RollingFrameMetrics,
  computeShadowMapSize,
  computeTargetDpr,
  type QualityPreset,
  type QualityTier,
  type TierTransition,
} from './perfGovernor.ts';
import {
  PostProcessingPipeline,
  canUseHalfFloatComposer,
} from './postProcessing.ts';

export interface EffectiveQualityState {
  readonly mode: QualityLevel;
  readonly tier: QualityTier;
  readonly tierLabel: string;
  readonly dpr: number;
  readonly shadowsEnabled: boolean;
  readonly composerEnabled: boolean;
  readonly outlineEnabled: boolean;
  readonly decorLow: boolean;
  readonly activePasses: string;
}

export interface ScenePerfSnapshot {
  readonly fps: number;
  readonly avgMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
  readonly workAvgMs: number;
  readonly workP95Ms: number;
  readonly workMaxMs: number;
  readonly dpr: number;
  readonly nativeDpr: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  readonly composerEnabled: boolean;
  readonly activePasses: string;
  readonly shadowsEnabled: boolean;
  readonly shadowMapSize: number;
  readonly qualityMode: QualityLevel;
  readonly activeTier: QualityTier;
  readonly tierLabel: string;
  readonly lockedCeilingTier: QualityTier;
  readonly defaultMaxTier: QualityTier;
  readonly tierTransitions: number;
  readonly isTouch: boolean;
}

export interface WarmUpOptions {
  readonly instancedHighlightMaterial?: THREE.Material;
  readonly extraMaterials?: readonly THREE.Material[];
}

/**
 * Distinguishes primary-touch phones/tablets from touchscreen laptops with a mouse/trackpad
 * so desktop touchscreen machines preserve full Tier 5 visuals.
 */
export function detectPrimaryTouchDevice(): boolean {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    if (window.matchMedia('(pointer: coarse)').matches) return true;
    if (
      window.matchMedia('(pointer: fine)').matches &&
      window.matchMedia('(hover: hover)').matches
    ) {
      return false;
    }
  }
  return isTouchDevice();
}

function createWarmUpTriangleGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1], 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute([1, 1, 1, 1, 1, 1, 1, 1, 1], 3));
  return geo;
}

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly hemiLight: THREE.HemisphereLight;
  readonly dirLight: THREE.DirectionalLight;

  private readonly canvas: HTMLCanvasElement;
  private readonly isTouch: boolean;
  private readonly composerSupported: boolean;
  private readonly governor: PerfGovernor;
  private readonly displayMetrics = new RollingFrameMetrics(120);
  private readonly workMetrics = new RollingFrameMetrics(120);
  private readonly drawingSizeScratch = new THREE.Vector2();

  private skyMesh: THREE.Mesh;
  private skyGeometry: THREE.PlaneGeometry;
  private skyMaterial: THREE.ShaderMaterial;
  private postProcessing: PostProcessingPipeline | null = null;
  private effectiveStateListener: ((state: EffectiveQualityState) => void) | null = null;

  private lastWidth: number;
  private lastHeight: number;
  private appliedDpr = -1;
  private tierTransitions = 0;

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
  };

  private readonly onContextRestored = (): void => {
    this.renderer.shadowMap.needsUpdate = true;
    this.governor.resetWarmup();
    this.resetDisplayMetrics();
  };

  constructor(
    canvas: HTMLCanvasElement,
    options?: { isTouch?: boolean; initialQuality?: QualityLevel },
  ) {
    this.canvas = canvas;
    this.isTouch = options?.isTouch ?? detectPrimaryTouchDevice();
    this.governor = new PerfGovernor({
      mode: options?.initialQuality ?? 'auto',
      isTouch: this.isTouch,
    });

    this.lastWidth = Math.max(1, canvas.clientWidth || window.innerWidth);
    this.lastHeight = Math.max(1, canvas.clientHeight || window.innerHeight);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.composerSupported = canUseHalfFloatComposer(this.renderer);
    // Track full multi-pass WebGL draw calls accurately across EffectComposer frames
    this.renderer.info.autoReset = false;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(SKY_HORIZON_HEX, 125, 260);

    // Full-screen vertical gradient sky quad rendered first without depth writes.
    // When EffectComposer is active it performs tone mapping & sRGB encoding once at the end,
    // so uDirectOutput = 0 prevents washed-out double-gamma sky colors.
    this.skyGeometry = new THREE.PlaneGeometry(2, 2);
    this.skyMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uHorizon: {
          value: new THREE.Color(SKY_HORIZON_HEX).lerp(new THREE.Color(PALETTE_HEX.water), 0.36),
        },
        uZenith: {
          value: new THREE.Color(PALETTE_HEX.water).lerp(new THREE.Color(0x2888c4), 0.32),
        },
        uDirectOutput: { value: 0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.9999, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uHorizon;
        uniform vec3 uZenith;
        uniform float uDirectOutput;
        varying vec2 vUv;
        void main() {
          float t = smoothstep(0.06, 0.92, vUv.y);
          vec3 col = mix(uHorizon, uZenith, t);
          gl_FragColor = vec4(col, 1.0);
          if (uDirectOutput > 0.5) {
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }
        }
      `,
    });
    this.skyMesh = new THREE.Mesh(this.skyGeometry, this.skyMaterial);
    this.skyMesh.renderOrder = -1000;
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);

    this.hemiLight = new THREE.HemisphereLight(
      SKY_ZENITH_HEX,
      0x9a6d4b,
      0.92,
    );
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(0xfffaf0, 1.64);
    this.dirLight.position.set(22, 34, 18);
    this.dirLight.castShadow = true;
    const shadowSize = this.isTouch ? 1024 : 2048;
    this.dirLight.shadow.mapSize.set(shadowSize, shadowSize);
    this.dirLight.shadow.bias = -0.0004;
    this.dirLight.shadow.normalBias = 0.025;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);

    this.applyPreset(this.governor.getPreset(), true);

    if (typeof canvas.addEventListener === 'function') {
      canvas.addEventListener('webglcontextlost', this.onContextLost);
      canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    }
  }

  get shadowsEnabled(): boolean {
    return this.renderer.shadowMap.enabled && this.dirLight.castShadow;
  }

  get postProcessingEnabled(): boolean {
    return this.isComposerActive(this.governor.getPreset());
  }

  private isComposerActive(preset: QualityPreset): boolean {
    return preset.composer && this.composerSupported;
  }

  setEffectiveStateListener(listener: ((state: EffectiveQualityState) => void) | null): void {
    this.effectiveStateListener = listener;
    if (listener) {
      listener(this.getEffectiveRenderState());
    }
  }

  getEffectiveRenderState(): EffectiveQualityState {
    const preset = this.governor.getPreset();
    const composerEnabled = this.isComposerActive(preset);
    return {
      mode: this.governor.getMode(),
      tier: preset.tier,
      tierLabel: preset.label,
      dpr: this.appliedDpr > 0 ? this.appliedDpr : this.computePresetDpr(preset),
      shadowsEnabled: this.shadowsEnabled,
      composerEnabled,
      outlineEnabled: composerEnabled && preset.outline,
      decorLow: preset.decorLow,
      activePasses: this.getActivePassesLabel(preset),
    };
  }

  setQuality(quality: QualityLevel): void {
    if (quality === this.governor.getMode()) return;
    this.tierTransitions = 0;
    this.governor.setMode(quality);
    this.applyPreset(this.governor.getPreset(), true);
  }

  resetDisplayMetrics(): void {
    this.displayMetrics.reset();
    this.workMetrics.reset();
  }

  resetGovernorWarmup(durationSec?: number, resetDisplayMetrics = false): void {
    this.governor.resetWarmup(durationSec);
    if (resetDisplayMetrics) {
      this.resetDisplayMetrics();
    }
  }

  /**
   * Compiles scene shaders (plus deferred gameplay-only materials like instanced towers) and
   * warms up the active post-processing chain before revealing the menu, eliminating first-frame
   * and first-build compile hitches.
   */
  async warmUp(camera: THREE.Camera, options?: WarmUpOptions): Promise<void> {
    this.resize(
      this.canvas.clientWidth || window.innerWidth,
      this.canvas.clientHeight || window.innerHeight,
    );

    const preset = this.governor.getPreset();
    if (this.isComposerActive(preset) && !this.postProcessing) {
      this.postProcessing = new PostProcessingPipeline(
        this.renderer,
        this.scene,
        camera,
        this.lastWidth,
        this.lastHeight,
        {
          n8ao: preset.n8ao,
          outline: preset.outline,
          bloom: preset.bloom,
          smaa: preset.smaa,
        },
      );
    }

    const disposables: Array<{ dispose: () => void }> = [];
    let extraGroup: THREE.Group | null = null;
    if (options?.instancedHighlightMaterial || options?.extraMaterials?.length) {
      extraGroup = new THREE.Group();
      if (options.instancedHighlightMaterial) {
        const instGeo = createWarmUpTriangleGeometry();
        instGeo.setAttribute('aHighlight', new THREE.InstancedBufferAttribute(new Float32Array(1), 1));
        const instMesh = new THREE.InstancedMesh(instGeo, options.instancedHighlightMaterial, 1);
        instMesh.castShadow = true;
        instMesh.receiveShadow = true;
        extraGroup.add(instMesh);
        disposables.push(instGeo, instMesh);
      }
      if (options.extraMaterials?.length) {
        const plainGeo = createWarmUpTriangleGeometry();
        disposables.push(plainGeo);
        for (let i = 0; i < options.extraMaterials.length; i++) {
          extraGroup.add(new THREE.Mesh(plainGeo, options.extraMaterials[i]));
        }
      }
    }

    // Compile scene + deferred gameplay shaders against EffectComposer's linear HalfFloat buffer
    // when post-processing is enabled so RenderPass doesn't recompile srgb-linear variants on first draw.
    const prevTarget = this.renderer.getRenderTarget();
    if (this.postProcessing) {
      this.renderer.setRenderTarget(this.postProcessing.composer.inputBuffer);
    }
    try {
      if (typeof this.renderer.compileAsync === 'function') {
        try {
          await Promise.all([
            this.renderer.compileAsync(this.scene, camera),
            extraGroup ? this.renderer.compileAsync(extraGroup, camera, this.scene) : null,
            this.postProcessing?.whenReady() ?? null,
          ]);
        } catch {
          this.renderer.compile(this.scene, camera);
          if (extraGroup) this.renderer.compile(extraGroup, camera, this.scene);
          await (this.postProcessing?.whenReady() ?? Promise.resolve());
        }
      } else {
        this.renderer.compile(this.scene, camera);
        if (extraGroup) this.renderer.compile(extraGroup, camera, this.scene);
        await (this.postProcessing?.whenReady() ?? Promise.resolve());
      }
    } finally {
      this.renderer.setRenderTarget(prevTarget);
      for (let i = 0; i < disposables.length; i++) {
        disposables[i].dispose();
      }
    }

    this.render(camera);
    this.governor.resetWarmup();
    this.resetDisplayMetrics();
  }

  recordFrame(
    frameDtSec: number,
    workMs: number,
    options?: { throttled?: boolean; hidden?: boolean; skipDisplayFrameSample?: boolean },
  ): TierTransition | null {
    if (options?.hidden) return null;
    const frameMs = frameDtSec * 1000;
    if (!options?.skipDisplayFrameSample && frameMs > 0 && Number.isFinite(frameMs)) {
      this.displayMetrics.record(frameMs);
    }
    if (workMs > 0 && Number.isFinite(workMs)) {
      this.workMetrics.record(workMs);
    }

    const transition = this.governor.recordFrame(frameMs, options);
    if (transition) {
      this.tierTransitions++;
      this.applyPreset(this.governor.getPreset(), false);
    }
    return transition;
  }

  fitShadowToMap(cols: number, rows: number): void {
    const halfW = (cols * BALANCE.tileSize) * 0.58 + 3;
    const halfH = (rows * BALANCE.tileSize) * 0.58 + 3;
    const extent = Math.max(halfW, halfH);
    const cam = this.dirLight.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 6;
    cam.far = 96;
    cam.updateProjectionMatrix();
    this.dirLight.target.position.set(0, 0, 0);
  }

  resize(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const targetDpr = this.computePresetDpr(this.governor.getPreset());
    if (
      w === this.lastWidth &&
      h === this.lastHeight &&
      Math.abs(targetDpr - this.appliedDpr) <= 0.001
    ) {
      return;
    }
    this.lastWidth = w;
    this.lastHeight = h;
    this.appliedDpr = targetDpr;
    this.renderer.setPixelRatio(targetDpr);
    this.renderer.setSize(w, h, false);
    this.postProcessing?.setSize(w, h);
  }

  render(camera: THREE.Camera): void {
    this.renderer.info.reset();
    const preset = this.governor.getPreset();
    if (this.isComposerActive(preset)) {
      if (!this.postProcessing) {
        this.postProcessing = new PostProcessingPipeline(
          this.renderer,
          this.scene,
          camera,
          this.lastWidth,
          this.lastHeight,
          {
            n8ao: preset.n8ao,
            outline: preset.outline,
            bloom: preset.bloom,
            smaa: preset.smaa,
          },
        );
      }
      this.postProcessing.render();
    } else {
      this.renderer.render(this.scene, camera);
    }
  }

  getPerfSnapshot(): ScenePerfSnapshot {
    const preset = this.governor.getPreset();
    const composerEnabled = this.isComposerActive(preset);
    const frameStats = this.displayMetrics.getSnapshot();
    const workStats = this.workMetrics.getSnapshot();
    const nativeDpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
    const dpr = this.renderer.getPixelRatio();
    this.renderer.getDrawingBufferSize(this.drawingSizeScratch);
    const pixelWidth =
      this.drawingSizeScratch.x > 0 ? this.drawingSizeScratch.x : Math.floor(this.lastWidth * dpr);
    const pixelHeight =
      this.drawingSizeScratch.y > 0 ? this.drawingSizeScratch.y : Math.floor(this.lastHeight * dpr);
    const shadowsEnabled = this.shadowsEnabled;
    return {
      fps: frameStats.fps,
      avgMs: frameStats.avgMs,
      p95Ms: frameStats.p95Ms,
      maxMs: frameStats.maxMs,
      workAvgMs: workStats.avgMs,
      workP95Ms: workStats.p95Ms,
      workMaxMs: workStats.maxMs,
      dpr,
      nativeDpr,
      pixelWidth,
      pixelHeight,
      composerEnabled,
      activePasses: this.getActivePassesLabel(preset),
      shadowsEnabled,
      shadowMapSize: shadowsEnabled ? this.dirLight.shadow.mapSize.x : 0,
      qualityMode: this.governor.getMode(),
      activeTier: preset.tier,
      tierLabel: preset.label,
      lockedCeilingTier: this.governor.getLockedCeilingTier(),
      defaultMaxTier: this.governor.getDefaultMaxTier(),
      tierTransitions: this.tierTransitions,
      isTouch: this.isTouch,
    };
  }

  getWebGLDiagnosticInfo(): {
    webgl2: boolean;
    maxTextureSize: number;
    parallelCompile: boolean;
    programs: number;
    gpuRenderer: string | null;
  } {
    const programs = this.renderer.info.programs?.length ?? 0;
    let gpuRenderer: string | null = null;
    try {
      const gl = this.renderer.getContext();
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      if (dbg) {
        const raw = gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL);
        if (typeof raw === 'string' && raw.length > 0) {
          gpuRenderer = raw;
        }
      }
    } catch {
      // Browser privacy settings may block unmasked GPU renderer info
    }
    return {
      webgl2: this.renderer.capabilities.isWebGL2,
      maxTextureSize: this.renderer.capabilities.maxTextureSize,
      parallelCompile: this.renderer.extensions.has('KHR_parallel_shader_compile'),
      programs,
      gpuRenderer,
    };
  }

  private disposeShadowMap(): void {
    const map = this.dirLight.shadow.map;
    if (!map) return;
    if (map.depthTexture) {
      map.depthTexture.dispose();
      map.depthTexture = null;
    }
    map.dispose();
    this.dirLight.shadow.map = null;
  }

  private computePresetDpr(preset: QualityPreset): number {
    const nativeDpr = (typeof window !== 'undefined' ? window.devicePixelRatio : 1) || 1;
    return computeTargetDpr(nativeDpr, preset.tier, this.isTouch, this.governor.getMode());
  }

  private getActivePassesLabel(preset: QualityPreset): string {
    if (!this.isComposerActive(preset)) return 'Direct';
    if (this.postProcessing) return this.postProcessing.getActivePassSummary();
    const parts: string[] = [];
    if (preset.n8ao === 'full') parts.push('AO');
    else if (preset.n8ao === 'half') parts.push('AO½');
    if (preset.outline) parts.push('Out');
    if (preset.bloom) parts.push('Bloom');
    if (preset.smaa) parts.push('SMAA');
    return parts.length > 0 ? parts.join('+') : 'Tone';
  }

  private applyPreset(preset: QualityPreset, refreshSize: boolean): void {
    const shadowSize = computeShadowMapSize(preset.tier, this.isTouch);
    const shadowsActive = preset.shadows && shadowSize > 0;
    this.renderer.shadowMap.enabled = shadowsActive;
    this.dirLight.castShadow = shadowsActive;
    if (!shadowsActive) {
      this.disposeShadowMap();
    } else if (
      this.dirLight.shadow.mapSize.x !== shadowSize ||
      this.dirLight.shadow.mapSize.y !== shadowSize
    ) {
      this.dirLight.shadow.mapSize.set(shadowSize, shadowSize);
      this.disposeShadowMap();
    }
    this.renderer.shadowMap.needsUpdate = true;

    const composerEnabled = this.isComposerActive(preset);
    this.skyMaterial.uniforms.uDirectOutput.value = composerEnabled ? 0 : 1;
    this.renderer.toneMapping = composerEnabled ? THREE.NoToneMapping : THREE.NeutralToneMapping;
    this.renderer.toneMappingExposure = composerEnabled ? 1.0 : 1.06;

    const w = refreshSize
      ? Math.max(1, this.canvas.clientWidth || window.innerWidth)
      : this.lastWidth;
    const h = refreshSize
      ? Math.max(1, this.canvas.clientHeight || window.innerHeight)
      : this.lastHeight;

    if (!composerEnabled) {
      if (this.postProcessing) {
        // Free the composer render targets & N8AO buffers; recreated lazily if stepping back up.
        this.postProcessing.dispose();
        this.postProcessing = null;
      }
      // EffectComposer sets renderer.autoClear = false; restore it for direct WebGL rendering.
      this.renderer.autoClear = true;
      this.resize(w, h);
    } else if (this.postProcessing) {
      const postCfg = {
        n8ao: preset.n8ao,
        outline: preset.outline,
        bloom: preset.bloom,
        smaa: preset.smaa,
      };
      // Drop passes turning off before resize, then resize before creating newly enabled passes
      // so new GPU targets allocate once at the final drawingBufferSize.
      this.postProcessing.releaseDisabledPasses(postCfg);
      this.resize(w, h);
      this.postProcessing.applyConfig(postCfg);
    } else {
      this.resize(w, h);
    }
    this.effectiveStateListener?.(this.getEffectiveRenderState());
  }

  dispose(): void {
    if (typeof this.canvas.removeEventListener === 'function') {
      this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
      this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    }
    this.effectiveStateListener = null;
    this.disposeShadowMap();
    this.postProcessing?.dispose();
    this.postProcessing = null;
    this.skyGeometry.dispose();
    this.skyMaterial.dispose();
    this.renderer.dispose();
  }
}
