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

/**
 * High-quality post-processing chain built with pmndrs/postprocessing and N8AO:
 * RenderPass -> N8AOPostPass -> (Selective Tower/Enemy Dark Outline + Exposure + Bloom + ACES) -> SMAA.
 */
export class PostProcessingPipeline {
  readonly composer: EffectComposer;

  /**
   * `level` 'medium' drops the two heaviest passes (ambient occlusion + SMAA); outline, bloom and
   * tone mapping stay so the look is close to 'high' on a much lower GPU budget.
   */
  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
    level: 'high' | 'medium' = 'high',
  ) {
    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });
    this.composer.setSize(width, height, false);

    const renderPass = new RenderPass(scene, camera);
    this.composer.addPass(renderPass);

    if (level === 'high') {
      const ao = new N8AOPostPass(scene, camera, width, height);
      ao.setQualityMode('Medium');
      ao.configuration.aoRadius = 1.25;
      ao.configuration.distanceFalloff = 0.9;
      ao.configuration.intensity = 1.65;
      ao.configuration.color = new THREE.Color(0x282648);
      ao.configuration.gammaCorrection = false;
      ao.configuration.transparencyAware = false;
      // Half-res AO with depth-aware upsampling: ~4x cheaper on Retina/phone panels, nearly identical look.
      ao.configuration.halfRes = true;
      this.composer.addPass(ao);
    }

    const outlineEffect = new SilhouetteOutlineEffect(1.06, 0x181628, 0.72);
    const bloomEffect = new BloomEffect({
      blendFunction: BlendFunction.ADD,
      luminanceThreshold: 1.05,
      luminanceSmoothing: 0.14,
      intensity: 0.34,
      mipmapBlur: true,
      radius: 0.58,
      levels: 4,
    });
    const hueSatEffect = new HueSaturationEffect({
      saturation: 0.17,
    });
    const toneMappingEffect = new ToneMappingEffect({
      mode: ToneMappingMode.NEUTRAL,
    });

    const compositePass = new EffectPass(
      camera,
      outlineEffect,
      bloomEffect,
      hueSatEffect,
      toneMappingEffect,
    );
    this.composer.addPass(compositePass);

    if (level === 'high') {
      const smaaEffect = new SMAAEffect({ preset: SMAAPreset.MEDIUM });
      const smaaPass = new EffectPass(camera, smaaEffect);
      this.composer.addPass(smaaPass);
    }
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(Math.max(1, width), Math.max(1, height), false);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}
