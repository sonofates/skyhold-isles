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
import { N8AOPostPass } from 'n8ao';
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

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  float centerId = inputColor.a;
  float isUnit = 1.0 - smoothstep(0.68, 0.88, centerId);

  vec2 t = texelSize;
  float idL = texture2D(inputBuffer, uv - vec2(t.x, 0.0)).a;
  float idR = texture2D(inputBuffer, uv + vec2(t.x, 0.0)).a;
  float idT = texture2D(inputBuffer, uv + vec2(0.0, t.y)).a;
  float idB = texture2D(inputBuffer, uv - vec2(0.0, t.y)).a;

  float dL = readDepth(uv - vec2(t.x, 0.0));
  float dR = readDepth(uv + vec2(t.x, 0.0));
  float dT = readDepth(uv + vec2(0.0, t.y));
  float dB = readDepth(uv - vec2(0.0, t.y));

  float minNeighborId = min(min(idL, idR), min(idT, idB));
  float hasUnitNeighbor = 1.0 - smoothstep(0.68, 0.88, minNeighborId);
  float maxDiffId = max(
    max(abs(centerId - idL), abs(centerId - idR)),
    max(abs(centerId - idT), abs(centerId - idB))
  );

  // Outer 1px silhouette on background bordering a tower/enemy, plus enemy-vs-tower boundary
  float outerBgEdge = step(0.72, centerId) * hasUnitNeighbor * smoothstep(0.14, 0.34, maxDiffId);
  float crossClassEdge = isUnit * smoothstep(0.16, 0.28, maxDiffId);
  // Subtle depth separation when adjacent towers overlap one another
  float depthJump = max(max(dL - depth, dR - depth), max(dT - depth, dB - depth));
  float overlapEdge = isUnit * smoothstep(0.003, 0.0065, depthJump);

  float edge = clamp(max(outerBgEdge, max(crossClassEdge, overlapEdge)), 0.0, 1.0);
  vec3 exposed = inputColor.rgb * uExposure;
  vec3 outlined = mix(exposed, uOutlineColor, edge * uOutlineStrength);
  outputColor = vec4(outlined, 1.0);
}
`;

class SilhouetteOutlineEffect extends Effect {
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
  accumulationQuad?: DisposableLike | null;
  effectCompositerQuad?: DisposableLike | null;
  copyQuad?: DisposableLike | null;
  depthDownsampleQuad?: DisposableLike | null;
  depthCopyPass?: DisposableLike | null;
  standardDenoiseMaterial?: DisposableLike | null;
  neuralDenoiseMaterial?: DisposableLike | null;
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

/**
 * Adaptive post-processing chain built with pmndrs/postprocessing and N8AO:
 * RenderPass -> [N8AOPostPass] -> ([Outline] + [Bloom] + HueSat + NeutralToneMapping) -> [SMAA].
 */
export class PostProcessingPipeline {
  readonly composer: EffectComposer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly allowHalfResN8ao: boolean;
  private width: number;
  private height: number;

  private n8aoPass: N8AOPostPass | null = null;
  private compositePass: EffectPass | null = null;
  private smaaPass: EffectPass | null = null;
  private smaaEffect: SMAAEffect | null = null;
  private smaaReadyPromise: Promise<void> | null = null;
  private smaaReadyCancel: (() => void) | null = null;
  private config: PostProcessingConfig;
  private readonly drawingSize = new THREE.Vector2();

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
    initialConfig: PostProcessingConfig = DEFAULT_CONFIG,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.allowHalfResN8ao = canUseHalfResN8ao(renderer);
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
    if (this.config.smaa) parts.push('SMAA');
    return parts.length > 0 ? parts.join('+') : 'Tone';
  }

  /**
   * Drops passes that are turning off before resizing the composer so disabled render targets
   * are never resized only to be immediately disposed.
   */
  releaseDisabledPasses(next: PostProcessingConfig): void {
    if (next.n8ao === 'off' && this.n8aoPass) {
      this.composer.removePass(this.n8aoPass);
      disposeN8aoPass(this.n8aoPass);
      this.n8aoPass = null;
      this.config = { ...this.config, n8ao: 'off' };
    }
    if (!next.smaa && this.smaaPass) {
      this.smaaReadyCancel?.();
      this.smaaReadyCancel = null;
      this.composer.removePass(this.smaaPass);
      this.smaaPass.dispose();
      this.smaaPass = null;
      this.smaaEffect = null;
      this.smaaReadyPromise = null;
      this.config = { ...this.config, smaa: false };
    }
  }

  private createSmaaReadyPromise(effect: SMAAEffect): Promise<void> {
    if (
      typeof Image === 'undefined' ||
      (effect.weightsMaterial.searchTexture && effect.weightsMaterial.areaTexture)
    ) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      let settled = false;
      const finish = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        dispatcher.removeEventListener('load', finish);
        if (this.smaaReadyCancel === finish) {
          this.smaaReadyCancel = null;
        }
        resolve();
      };
      const dispatcher = effect as unknown as {
        addEventListener: (type: string, cb: () => void) => void;
        removeEventListener: (type: string, cb: () => void) => void;
      };
      this.smaaReadyCancel = finish;
      dispatcher.addEventListener('load', finish);
      const timer = setTimeout(finish, 50);
    });
  }

  whenReady(): Promise<void> {
    return this.smaaReadyPromise ?? Promise.resolve();
  }

  applyConfig(next: PostProcessingConfig, forceRebuild = false): void {
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
        if (this.n8aoPass) {
          this.composer.removePass(this.n8aoPass);
          disposeN8aoPass(this.n8aoPass);
          this.n8aoPass = null;
        }
      } else if (!this.n8aoPass) {
        this.composer.getRenderer().getDrawingBufferSize(this.drawingSize);
        const targetW = Math.max(1, this.drawingSize.width || this.width);
        const targetH = Math.max(1, this.drawingSize.height || this.height);
        this.n8aoPass = createN8aoPass(
          this.scene,
          this.camera,
          targetW,
          targetH,
          next.n8ao,
          this.allowHalfResN8ao,
        );
        this.composer.addPass(this.n8aoPass, 1);
      } else {
        configureN8aoPass(this.n8aoPass, next.n8ao, this.allowHalfResN8ao);
      }
    }

    if (compositeChanged) {
      const prevComposite = this.compositePass;
      const insertIdx = prevComposite
        ? this.composer.passes.indexOf(prevComposite)
        : this.smaaPass
          ? this.composer.passes.indexOf(this.smaaPass)
          : -1;

      const effects: Effect[] = [];
      if (next.outline) {
        effects.push(new SilhouetteOutlineEffect(1.06, 0x181628, 0.72));
      }
      if (next.bloom) {
        effects.push(
          new BloomEffect({
            blendFunction: BlendFunction.ADD,
            luminanceThreshold: 1.05,
            luminanceSmoothing: 0.14,
            intensity: 0.34,
            mipmapBlur: true,
            radius: 0.58,
            levels: 4,
          }),
        );
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

      if (prevComposite) {
        this.composer.removePass(prevComposite);
        prevComposite.dispose();
      }
    }

    if (smaaChanged || (next.smaa && !this.smaaPass)) {
      if (next.smaa) {
        if (!this.smaaPass) {
          this.smaaEffect = new SMAAEffect({ preset: SMAAPreset.MEDIUM });
          this.smaaReadyPromise = this.createSmaaReadyPromise(this.smaaEffect);
          this.smaaPass = new EffectPass(this.camera, this.smaaEffect);
        }
        if (!this.composer.passes.includes(this.smaaPass)) {
          this.composer.addPass(this.smaaPass);
        }
      } else if (this.smaaPass) {
        this.smaaReadyCancel?.();
        this.smaaReadyCancel = null;
        this.composer.removePass(this.smaaPass);
        this.smaaPass.dispose();
        this.smaaPass = null;
        this.smaaEffect = null;
        this.smaaReadyPromise = null;
      }
    }

    this.config = { ...next };
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.composer.setSize(this.width, this.height, false);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.smaaReadyCancel?.();
    this.smaaReadyCancel = null;
    if (this.n8aoPass) {
      this.composer.removePass(this.n8aoPass);
      disposeN8aoPass(this.n8aoPass);
      this.n8aoPass = null;
    }
    this.composer.dispose();
    this.compositePass = null;
    this.smaaPass = null;
    this.smaaEffect = null;
    this.smaaReadyPromise = null;
  }
}
