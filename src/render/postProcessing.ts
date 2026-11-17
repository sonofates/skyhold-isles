import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectAttribute,
  EffectComposer,
  EffectPass,
  HueSaturationEffect,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
} from 'postprocessing';
import { N8AOPostPass, type N8AOConfiguration } from 'n8ao';
import type { N8aoMode } from './perfGovernor.ts';

export interface PostProcessingConfig {
  readonly n8ao: N8aoMode;
  readonly outline: boolean;
  readonly bloom: boolean;
  readonly smaa: boolean;
}

const DEFAULT_CONFIG: PostProcessingConfig = {
  n8ao: 'full',
  outline: true,
  bloom: true,
  smaa: true,
};

const SILHOUETTE_OUTLINE_FRAG = /* glsl */ `
uniform float uExposure;
uniform vec3 uOutlineColor;
uniform float uOutlineStrength;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  float centerId = inputColor.a;
  float isUnit = 1.0 - smoothstep(0.68, 0.88, centerId);

  vec2 t = texelSize;
  float idL = texture2D(inputBuffer, uv - vec2(t.x, 0.0)).a;
  float idR = texture2D(inputBuffer, uv + vec2(t.x, 0.0)).a;
  float idT = texture2D(inputBuffer, uv + vec2(0.0, t.y)).a;
  float idB = texture2D(inputBuffer, uv - vec2(0.0, t.y)).a;

  float minNeighborId = min(min(idL, idR), min(idT, idB));
  float hasUnitNeighbor = 1.0 - smoothstep(0.68, 0.88, minNeighborId);

  vec3 exposed = inputColor.rgb * uExposure;
  vec3 outlined = exposed;
  if (isUnit > 0.0 || hasUnitNeighbor > 0.0) {
    float maxDiffId = max(
      max(abs(centerId - idL), abs(centerId - idR)),
      max(abs(centerId - idT), abs(centerId - idB))
    );

    // Outer 1px silhouette on background bordering a tower/enemy, plus enemy-vs-tower boundary
    float outerBgEdge = step(0.72, centerId) * hasUnitNeighbor * smoothstep(0.14, 0.34, maxDiffId);
    float crossClassEdge = isUnit * smoothstep(0.16, 0.28, maxDiffId);
    // Subtle depth separation when adjacent towers overlap one another
    float overlapEdge = 0.0;
    if (isUnit > 0.0) {
      float depth = readDepth(uv);
      float dL = readDepth(uv - vec2(t.x, 0.0));
      float dR = readDepth(uv + vec2(t.x, 0.0));
      float dT = readDepth(uv + vec2(0.0, t.y));
      float dB = readDepth(uv - vec2(0.0, t.y));
      float depthJump = max(max(dL - depth, dR - depth), max(dT - depth, dB - depth));
      overlapEdge = isUnit * smoothstep(0.003, 0.0065, depthJump);
    }

    float edge = clamp(max(outerBgEdge, max(crossClassEdge, overlapEdge)), 0.0, 1.0);
    if (edge > 0.0) {
      outlined = mix(exposed, uOutlineColor, edge * uOutlineStrength);
    }
  }

  outputColor = vec4(outlined, 1.0);
}
`;

export class SilhouetteOutlineEffect extends Effect {
  constructor(exposure: number, outlineColorHex: number, strength: number) {
    super('SilhouetteOutlineEffect', SILHOUETTE_OUTLINE_FRAG, {
      attributes: EffectAttribute.CONVOLUTION | EffectAttribute.DEPTH,
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, THREE.Uniform>([
        ['uExposure', new THREE.Uniform(exposure)],
        ['uOutlineColor', new THREE.Uniform(new THREE.Color(outlineColorHex))],
        ['uOutlineStrength', new THREE.Uniform(strength)],
      ]),
    });
  }
}

interface DisposableLike {
  dispose?: () => void;
  material?: DisposableLike | null;
  depthTexture?: DisposableLike | null;
}

interface N8aoQuadLike extends DisposableLike {
  render?: (renderer: THREE.WebGLRenderer) => void;
  material?: (DisposableLike & { uniforms?: Record<string, { value: unknown }> }) | null;
}

interface N8aoInternalResources {
  scene?: THREE.Scene;
  autoDetectTransparency?: boolean;
  configuration?: { depthBufferType?: number };
  configureEffectCompositer?: (depthBufferType: number, ortho: boolean) => void;
  writeTargetInternal?: DisposableLike | null;
  readTargetInternal?: DisposableLike | null;
  outputTargetInternal?: DisposableLike | null;
  accumulationRenderTarget?: DisposableLike | null;
  depthDownsampleTarget?: DisposableLike | null;
  transparencyRenderTargetDWFalse?: DisposableLike | null;
  transparencyRenderTargetDWTrue?: DisposableLike | null;
  bluenoise?: DisposableLike | null;
  effectShaderQuad?: DisposableLike | null;
  poissonBlurQuad?: DisposableLike | null;
  accumulationQuad?: N8aoQuadLike | null;
  effectCompositerQuad?: N8aoQuadLike | null;
  copyQuad?: N8aoQuadLike | null;
  depthDownsampleQuad?: DisposableLike | null;
  depthCopyPass?: DisposableLike | null;
  standardDenoiseMaterial?: DisposableLike | null;
  neuralDenoiseMaterial?: DisposableLike | null;
}

interface BloomInternalResources {
  luminanceMaterial?: THREE.Material | null;
  mipmapBlurPass?: {
    enabled?: boolean;
    downsamplingMaterial?: THREE.Material | null;
    upsamplingMaterial?: THREE.Material | null;
  } | null;
}

export interface PostWarmUpMaterials {
  readonly linearMaterials: THREE.Material[];
  readonly screenMaterials: THREE.Material[];
}

export interface PostWarmUpMaterialSources {
  readonly n8aoPass?: N8AOPostPass | null;
  readonly bloomEffect?: BloomEffect | null;
  readonly compositePass?: EffectPass | null;
  readonly smaaPass?: EffectPass | null;
  readonly smaaEffect?: SMAAEffect | null;
}

const directOutputN8aoPasses = new WeakSet<N8AOPostPass>();
const noopQuadRender = (): void => {};

type N8aoRenderFn = (
  this: N8AOPostPass,
  renderer: THREE.WebGLRenderer,
  inputBuffer: THREE.WebGLRenderTarget,
  outputBuffer: THREE.WebGLRenderTarget | null,
  deltaTime?: number,
  stencilTest?: boolean,
) => void;

function canBypassN8aoAccumulation(pass: N8AOPostPass): boolean {
  const internal = pass as unknown as N8aoInternalResources;
  const cfg = pass.configuration as Partial<N8AOConfiguration> | undefined;
  return (
    !cfg?.accumulate &&
    ((cfg?.denoiseIterations ?? 2) % 2) === 0 &&
    Boolean(internal.writeTargetInternal) &&
    Boolean(internal.accumulationQuad) &&
    typeof internal.accumulationQuad?.render === 'function' &&
    'accumulationRenderTarget' in internal
  );
}

/**
 * Routes N8AOPostPass's final EffectCompositer output directly into EffectComposer's outputBuffer
 * when rendering offscreen and skips the redundant accumulationQuad pass when accumulate is false,
 * avoiding 2 unused render targets, 2 shader compiles, and 2 full-screen copy blits per frame.
 */
export function installN8aoDirectOutputPass(pass: N8AOPostPass): boolean {
  if (directOutputN8aoPasses.has(pass)) return true;
  const internal = pass as unknown as N8aoInternalResources;
  const copyQuad = internal.copyQuad;
  const accumulationQuad = internal.accumulationQuad;
  const passLike = pass as unknown as { render?: N8aoRenderFn };
  const origRender = passLike.render;
  const canBypassCopy =
    Boolean(internal.effectCompositerQuad) &&
    Boolean(copyQuad) &&
    typeof copyQuad?.render === 'function' &&
    'outputTargetInternal' in internal;
  const hasAccumSlots =
    Boolean(internal.writeTargetInternal) &&
    Boolean(accumulationQuad) &&
    typeof accumulationQuad?.render === 'function' &&
    'accumulationRenderTarget' in internal;

  if (typeof origRender !== 'function' || (!canBypassCopy && !hasAccumSlots)) {
    return false;
  }

  passLike.render = function (renderer, inputBuffer, outputBuffer, deltaTime, stencilTest) {
    const bypassCopy = canBypassCopy && !this.renderToScreen && Boolean(outputBuffer);
    const bypassAccum = canBypassN8aoAccumulation(this);
    if (!bypassCopy && !bypassAccum) {
      return origRender.call(this, renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);
    }

    const prevOutputTarget = internal.outputTargetInternal;
    const prevCopyRender = copyQuad?.render;
    const prevCopyDiffuse = copyQuad?.material?.uniforms?.tDiffuse;
    const prevAccumTarget = internal.accumulationRenderTarget;
    const prevAccumRender = accumulationQuad?.render;
    const prevAccumDiffuse = accumulationQuad?.material?.uniforms?.tDiffuse;

    if (bypassCopy && copyQuad) {
      internal.outputTargetInternal = outputBuffer as unknown as DisposableLike;
      copyQuad.render = noopQuadRender;
    }
    if (bypassAccum && accumulationQuad) {
      internal.accumulationRenderTarget = internal.writeTargetInternal;
      accumulationQuad.render = noopQuadRender;
    }
    try {
      return origRender.call(this, renderer, inputBuffer, outputBuffer, deltaTime, stencilTest);
    } finally {
      if (bypassCopy && copyQuad) {
        internal.outputTargetInternal = prevOutputTarget;
        copyQuad.render = prevCopyRender;
        if (prevCopyDiffuse) {
          prevCopyDiffuse.value = null;
        }
      }
      if (bypassAccum && accumulationQuad) {
        internal.accumulationRenderTarget = prevAccumTarget;
        accumulationQuad.render = prevAccumRender;
        if (prevAccumDiffuse) {
          prevAccumDiffuse.value = null;
        }
      }
    }
  };
  directOutputN8aoPasses.add(pass);
  return true;
}

/**
 * Collects unique materials across active post-processing passes split by target color space
 * (`linearMaterials` render into linear HalfFloat buffers; `screenMaterials` render to the sRGB canvas).
 */
export function collectPostWarmUpMaterials(
  sources: PostWarmUpMaterialSources,
  options?: { includeN8aoCopy?: boolean; includeN8aoAccum?: boolean },
): PostWarmUpMaterials {
  const linearMaterials: THREE.Material[] = [];
  const screenMaterials: THREE.Material[] = [];
  const seenLinear = new Set<THREE.Material>();
  const seenScreen = new Set<THREE.Material>();

  const pushLinear = (mat: unknown): void => {
    const m = mat as THREE.Material | null | undefined;
    if (!m || seenLinear.has(m)) return;
    seenLinear.add(m);
    linearMaterials.push(m);
  };
  const pushScreen = (mat: unknown): void => {
    const m = mat as THREE.Material | null | undefined;
    if (!m || seenScreen.has(m)) return;
    seenScreen.add(m);
    screenMaterials.push(m);
  };

  if (sources.n8aoPass) {
    const n8ao = sources.n8aoPass as unknown as N8aoInternalResources;
    if (sources.n8aoPass.configuration.halfRes) {
      pushLinear(n8ao.depthDownsampleQuad?.material);
    }
    pushLinear(n8ao.effectShaderQuad?.material);
    pushLinear(n8ao.standardDenoiseMaterial);
    const hasDirectBypass = directOutputN8aoPasses.has(sources.n8aoPass);
    const includeN8aoAccum =
      options?.includeN8aoAccum ?? !(hasDirectBypass && canBypassN8aoAccumulation(sources.n8aoPass));
    if (includeN8aoAccum) {
      pushLinear(n8ao.accumulationQuad?.material);
    }
    pushLinear(n8ao.effectCompositerQuad?.material);
    const includeN8aoCopy = options?.includeN8aoCopy ?? !hasDirectBypass;
    if (includeN8aoCopy) {
      pushLinear(n8ao.copyQuad?.material);
    }
  }

  if (sources.bloomEffect) {
    const bloom = sources.bloomEffect as unknown as BloomInternalResources;
    pushLinear(bloom.luminanceMaterial);
    if (bloom.mipmapBlurPass?.enabled !== false) {
      pushLinear(bloom.mipmapBlurPass?.downsamplingMaterial);
      pushLinear(bloom.mipmapBlurPass?.upsamplingMaterial);
    }
  }

  if (sources.smaaPass && sources.smaaEffect) {
    pushLinear(sources.compositePass?.fullscreenMaterial);
    pushLinear(sources.smaaEffect.edgeDetectionMaterial);
    pushLinear(sources.smaaEffect.weightsMaterial);
    pushScreen(sources.smaaPass.fullscreenMaterial);
  } else {
    pushScreen(sources.compositePass?.fullscreenMaterial);
  }

  return { linearMaterials, screenMaterials };
}

// Empty scratch scene passed to N8AOPostPass's constructor so its initial detectTransparency()
// scan finds no transparent meshes and never allocates+discards transient HalfFloat targets.
const _n8aoEmptyInitScene = new THREE.Scene();

function disposeN8aoPass(pass: N8AOPostPass): void {
  const internal = pass as unknown as N8aoInternalResources;
  internal.writeTargetInternal?.dispose?.();
  internal.readTargetInternal?.dispose?.();
  internal.outputTargetInternal?.dispose?.();
  internal.accumulationRenderTarget?.dispose?.();
  internal.depthDownsampleTarget?.dispose?.();
  internal.transparencyRenderTargetDWFalse?.dispose?.();
  internal.transparencyRenderTargetDWTrue?.depthTexture?.dispose?.();
  internal.transparencyRenderTargetDWTrue?.dispose?.();
  internal.bluenoise?.dispose?.();
  internal.standardDenoiseMaterial?.dispose?.();
  internal.neuralDenoiseMaterial?.dispose?.();
  internal.depthCopyPass?.dispose?.();
  const quads = [
    internal.effectShaderQuad,
    internal.poissonBlurQuad,
    internal.accumulationQuad,
    internal.effectCompositerQuad,
    internal.copyQuad,
    internal.depthDownsampleQuad,
  ];
  for (let i = 0; i < quads.length; i++) {
    const q = quads[i];
    q?.material?.dispose?.();
    q?.dispose?.();
  }
  pass.dispose();
}

function createN8aoPass(
  scene: THREE.Scene,
  camera: THREE.Camera,
  width: number,
  height: number,
  mode: Exclude<N8aoMode, 'off'>,
  allowHalfRes: boolean,
): N8AOPostPass {
  const pass = new N8AOPostPass(_n8aoEmptyInitScene, camera, width, height);
  // Disable transparency auto-detection before attaching the real scene so N8AO never triggers
  // 2 extra full-scene transparency render passes + 4 scene traversals per frame.
  const internal = pass as unknown as N8aoInternalResources;
  internal.autoDetectTransparency = false;
  internal.scene = scene;
  configureN8aoPass(pass, mode, allowHalfRes);
  // N8AOPostPass's constructor invokes configureEffectCompositer without ortho=true; whenever
  // halfRes stays false ('full' or 'half' fallback without EXT_color_buffer_float), the proxy
  // never re-invokes configureEffectCompositer with ortho=true.
  if (!pass.configuration.halfRes && (camera as THREE.OrthographicCamera).isOrthographicCamera) {
    internal.configureEffectCompositer?.(internal.configuration?.depthBufferType ?? 1, true);
  }
  pass.configuration.aoRadius = 1.25;
  pass.configuration.distanceFalloff = 0.9;
  pass.configuration.intensity = 1.65;
  pass.configuration.color = new THREE.Color(0x282648);
  pass.configuration.gammaCorrection = false;
  pass.configuration.transparencyAware = false;
  installN8aoDirectOutputPass(pass);
  return pass;
}

/**
 * N8AO's halfRes DepthDownSample MRT writes to a RedFormat+FloatType (R32F) target, which
 * requires WebGL2 + EXT_color_buffer_float for framebuffer completeness.
 */
export function canUseHalfResN8ao(
  renderer: Pick<THREE.WebGLRenderer, 'capabilities' | 'extensions'>,
): boolean {
  if (renderer.capabilities && renderer.extensions) {
    return (
      Boolean(renderer.capabilities.isWebGL2) &&
      Boolean(renderer.extensions.has('EXT_color_buffer_float'))
    );
  }
  return true;
}

/**
 * EffectComposer uses HalfFloatType buffers, requiring EXT_color_buffer_half_float or
 * EXT_color_buffer_float.
 */
export function canUseHalfFloatComposer(
  renderer: Pick<THREE.WebGLRenderer, 'extensions'>,
): boolean {
  if (!renderer.extensions) return true;
  return Boolean(
    renderer.extensions.has('EXT_color_buffer_half_float') ||
    renderer.extensions.has('EXT_color_buffer_float'),
  );
}

export function getN8aoQualitySettings(
  mode: Exclude<N8aoMode, 'off'>,
  allowHalfRes = true,
): {
  qualityMode: 'Performance' | 'Medium';
  halfRes: boolean;
} {
  return mode === 'half'
    ? { qualityMode: 'Performance', halfRes: allowHalfRes }
    : { qualityMode: 'Medium', halfRes: false };
}

function configureN8aoPass(
  pass: N8AOPostPass,
  mode: Exclude<N8aoMode, 'off'>,
  allowHalfRes: boolean,
): void {
  const settings = getN8aoQualitySettings(mode, allowHalfRes);
  pass.setQualityMode(settings.qualityMode);
  pass.configuration.halfRes = settings.halfRes;
}

export interface PostProcessingPipelineOptions {
  readonly deferSmaaAttachUntilReady?: boolean;
}

function isSmaaEffectReady(effect: SMAAEffect | null): boolean {
  if (!effect) return false;
  return (
    typeof Image === 'undefined' ||
    Boolean(effect.weightsMaterial.searchTexture && effect.weightsMaterial.areaTexture)
  );
}

/**
 * Adaptive post-processing chain built with pmndrs/postprocessing and N8AO:
 * RenderPass -> [N8AOPostPass] -> ([Outline] + [Bloom] + HueSat + NeutralToneMapping) -> [SMAA].
 */
export class PostProcessingPipeline {
  readonly composer: EffectComposer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly allowHalfResN8ao: boolean;
  private readonly deferSmaaAttachUntilReady: boolean;
  private width: number;
  private height: number;

  private n8aoPass: N8AOPostPass | null = null;
  private bloomEffect: BloomEffect | null = null;
  private compositePass: EffectPass | null = null;
  private smaaPass: EffectPass | null = null;
  private smaaEffect: SMAAEffect | null = null;
  private smaaReadyPromise: Promise<void> | null = null;
  private smaaReadyCancel: (() => void) | null = null;
  private config: PostProcessingConfig;
  private disposed = false;
  private readonly drawingSize = new THREE.Vector2();

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
    initialConfig: PostProcessingConfig = DEFAULT_CONFIG,
    options?: PostProcessingPipelineOptions,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.allowHalfResN8ao = canUseHalfResN8ao(renderer);
    this.deferSmaaAttachUntilReady = options?.deferSmaaAttachUntilReady ?? false;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.config = { ...initialConfig };

    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });
    this.composer.setSize(this.width, this.height, false);

    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    this.applyConfig(initialConfig, true);
  }

  getConfig(): PostProcessingConfig {
    return this.config;
  }

  getActivePassSummary(): string {
    const parts: string[] = [];
    if (this.config.n8ao === 'full') parts.push('AO');
    else if (this.config.n8ao === 'half') parts.push(this.allowHalfResN8ao ? 'AO½' : 'AO-P');
    if (this.config.outline) parts.push('Out');
    if (this.config.bloom) parts.push('Bloom');
    if (this.config.smaa && this.smaaPass && this.composer.passes.includes(this.smaaPass)) {
      parts.push('SMAA');
    }
    return parts.length > 0 ? parts.join('+') : 'Tone';
  }

  private removeAndDisposeN8ao(): void {
    if (!this.n8aoPass) return;
    this.composer.removePass(this.n8aoPass);
    disposeN8aoPass(this.n8aoPass);
    this.n8aoPass = null;
  }

  private removeAndDisposeSmaa(): void {
    this.smaaReadyCancel?.();
    this.smaaReadyCancel = null;
    if (this.smaaPass) {
      this.composer.removePass(this.smaaPass);
      this.smaaPass.dispose();
    }
    this.smaaPass = null;
    this.smaaEffect = null;
    this.smaaReadyPromise = null;
  }

  private clampHalfResN8aoTarget(mode: N8aoMode): void {
    if (!this.n8aoPass || mode !== 'half' || !this.allowHalfResN8ao) return;
    this.composer.getRenderer().getDrawingBufferSize(this.drawingSize);
    if (this.drawingSize.width < 2 || this.drawingSize.height < 2) {
      this.n8aoPass.setSize(
        Math.max(2, this.drawingSize.width),
        Math.max(2, this.drawingSize.height),
      );
    }
  }

  /**
   * Drops passes that are turning off before resizing the composer so disabled render targets
   * are never resized only to be immediately disposed.
   */
  releaseDisabledPasses(next: PostProcessingConfig): void {
    if (this.disposed) return;
    if (next.n8ao === 'off' && this.n8aoPass) {
      this.removeAndDisposeN8ao();
      this.config = { ...this.config, n8ao: 'off' };
    }
    if (!next.smaa && this.smaaPass) {
      this.removeAndDisposeSmaa();
      this.config = { ...this.config, smaa: false };
    }
    if (this.compositePass && this.config.bloom && !next.bloom) {
      this.rebuildCompositePass(next);
      this.config = { ...this.config, outline: next.outline, bloom: false };
    }
  }

  private rebuildCompositePass(next: PostProcessingConfig): void {
    const prevComposite = this.compositePass;
    const insertIdx = prevComposite
      ? this.composer.passes.indexOf(prevComposite)
      : this.smaaPass && this.composer.passes.includes(this.smaaPass)
        ? this.composer.passes.indexOf(this.smaaPass)
        : -1;

    const effects: Effect[] = [];
    if (next.outline) {
      effects.push(new SilhouetteOutlineEffect(1.06, 0x181628, 0.72));
    }
    let nextBloom: BloomEffect | null = null;
    if (next.bloom) {
      nextBloom = new BloomEffect({
        blendFunction: BlendFunction.ADD,
        luminanceThreshold: 1.05,
        luminanceSmoothing: 0.14,
        intensity: 0.34,
        mipmapBlur: true,
        radius: 0.58,
        levels: 4,
      });
      effects.push(nextBloom);
    }
    effects.push(
      new HueSaturationEffect({ saturation: 0.17 }),
      new ToneMappingEffect({ mode: ToneMappingMode.NEUTRAL }),
    );

    // Insert replacement pass in-place before removing the previous one so EffectComposer preserves
    // its depth render targets and leaves any trailing smaaPass attached without re-initializing it.
    const nextComposite = new EffectPass(this.camera, ...effects);
    this.composer.addPass(nextComposite, insertIdx >= 0 ? insertIdx : undefined);
    this.compositePass = nextComposite;
    this.bloomEffect = nextBloom;

    if (prevComposite) {
      this.composer.removePass(prevComposite);
      prevComposite.dispose();
    }
  }

  private createSmaaReadyPromise(effect: SMAAEffect, onLoaded?: () => void): Promise<void> {
    if (isSmaaEffectReady(effect)) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      let disposed = false;
      const dispatcher = effect as unknown as {
        addEventListener: (type: string, cb: () => void) => void;
        removeEventListener: (type: string, cb: () => void) => void;
      };
      const settle = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      const onLoad = (): void => {
        dispatcher.removeEventListener('load', onLoad);
        if (this.smaaReadyCancel === cancel) {
          this.smaaReadyCancel = null;
        }
        if (disposed || this.disposed) {
          effect.weightsMaterial.searchTexture?.dispose();
          effect.weightsMaterial.areaTexture?.dispose();
        } else {
          onLoaded?.();
        }
        settle();
      };
      const cancel = (): void => {
        disposed = true;
        if (this.smaaReadyCancel === cancel) {
          this.smaaReadyCancel = null;
        }
        settle();
      };
      this.smaaReadyCancel = cancel;
      dispatcher.addEventListener('load', onLoad);
      const timer = setTimeout(settle, 150);
    });
  }

  whenReady(): Promise<void> {
    return this.smaaReadyPromise ?? Promise.resolve();
  }

  getWarmUpMaterials(): PostWarmUpMaterials {
    const smaaAttached = Boolean(
      this.smaaPass && this.composer.passes.includes(this.smaaPass),
    );
    return collectPostWarmUpMaterials({
      n8aoPass: this.n8aoPass,
      bloomEffect: this.bloomEffect,
      compositePass: this.compositePass,
      smaaPass: smaaAttached ? this.smaaPass : null,
      smaaEffect: smaaAttached ? this.smaaEffect : null,
    });
  }

  applyConfig(next: PostProcessingConfig, forceRebuild = false): void {
    if (this.disposed) return;
    const n8aoChanged = forceRebuild || this.config.n8ao !== next.n8ao;
    const compositeChanged =
      forceRebuild ||
      !this.compositePass ||
      this.config.outline !== next.outline ||
      this.config.bloom !== next.bloom;
    const smaaChanged = forceRebuild || this.config.smaa !== next.smaa;

    if (!n8aoChanged && !compositeChanged && !smaaChanged) {
      return;
    }

    if (n8aoChanged) {
      if (next.n8ao === 'off') {
        this.removeAndDisposeN8ao();
      } else if (!this.n8aoPass) {
        this.composer.getRenderer().getDrawingBufferSize(this.drawingSize);
        const minDim = next.n8ao === 'half' && this.allowHalfResN8ao ? 2 : 1;
        const targetW = Math.max(minDim, this.drawingSize.width || this.width);
        const targetH = Math.max(minDim, this.drawingSize.height || this.height);
        this.n8aoPass = createN8aoPass(
          this.scene,
          this.camera,
          targetW,
          targetH,
          next.n8ao,
          this.allowHalfResN8ao,
        );
        this.composer.addPass(this.n8aoPass, 1);
        this.clampHalfResN8aoTarget(next.n8ao);
      } else {
        configureN8aoPass(this.n8aoPass, next.n8ao, this.allowHalfResN8ao);
        this.clampHalfResN8aoTarget(next.n8ao);
      }
    }

    if (compositeChanged) {
      this.rebuildCompositePass(next);
    }

    this.config = { ...next };

    if (smaaChanged || (next.smaa && !this.smaaPass)) {
      if (next.smaa) {
        if (!this.smaaPass) {
          const effect = new SMAAEffect({ preset: SMAAPreset.MEDIUM });
          const pass = new EffectPass(this.camera, effect);
          this.smaaEffect = effect;
          this.smaaPass = pass;
          const attachImmediately =
            (forceRebuild && !this.deferSmaaAttachUntilReady) || isSmaaEffectReady(effect);
          this.smaaReadyPromise = this.createSmaaReadyPromise(effect, () => {
            if (
              !attachImmediately &&
              !this.disposed &&
              this.config.smaa &&
              this.smaaPass === pass &&
              isSmaaEffectReady(effect) &&
              !this.composer.passes.includes(pass)
            ) {
              this.composer.addPass(pass);
            }
          });
          if (attachImmediately) {
            this.composer.addPass(pass);
          }
        } else if (
          ((forceRebuild && !this.deferSmaaAttachUntilReady) || isSmaaEffectReady(this.smaaEffect)) &&
          !this.composer.passes.includes(this.smaaPass)
        ) {
          this.composer.addPass(this.smaaPass);
        }
      } else if (this.smaaPass) {
        this.removeAndDisposeSmaa();
      }
    }
  }

  setSize(width: number, height: number): void {
    if (this.disposed) return;
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.composer.setSize(this.width, this.height, false);
    this.clampHalfResN8aoTarget(this.config.n8ao);
  }

  render(deltaTime = 0): void {
    if (this.disposed) return;
    this.composer.render(deltaTime);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.removeAndDisposeN8ao();
    this.removeAndDisposeSmaa();
    this.composer.dispose();
    this.bloomEffect = null;
    this.compositePass = null;
  }
}
