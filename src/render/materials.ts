import * as THREE from 'three';
import { PALETTE_HEX, type PaletteKey } from '../data/palette.ts';

/**
 * Configures a transparent material with normal RGB blending while preserving destination alpha,
 * keeping tower/enemy outline IDs encoded in the framebuffer alpha channel intact behind FX/water.
 */
export function applyAlphaPreserveBlend(mat: THREE.Material): void {
  mat.blending = THREE.CustomBlending;
  mat.blendEquation = THREE.AddEquation;
  mat.blendSrc = THREE.SrcAlphaFactor;
  mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendEquationAlpha = THREE.AddEquation;
  mat.blendSrcAlpha = THREE.ZeroFactor;
  mat.blendDstAlpha = THREE.OneFactor;
}

/** Screen-door fade: per-instance `vFade` in 0..1 keeps that fraction of pixels (4x4 Bayer). */
const DITHER_FADE_GLSL = `
float bayerFade4(vec2 p) {
  vec2 a = mod(p, 2.0);
  vec2 c = floor(mod(p, 4.0) / 2.0);
  return (4.0 * mod(2.0 * a.x + 3.0 * a.y, 4.0) + mod(2.0 * c.x + 3.0 * c.y, 4.0) + 0.5) / 16.0;
}`;
const DITHER_FADE_DISCARD = `
if (vFade < 0.999 && bayerFade4(gl_FragCoord.xy) >= vFade) discard;`;

/**
 * Shared palette & Kenney-textured materials with disposal tracker.
 */
export class MaterialLibrary {
  readonly solid = new Map<PaletteKey, THREE.MeshStandardMaterial>();
  readonly vertexColored: THREE.MeshStandardMaterial;
  readonly kenneyTerrain: THREE.MeshStandardMaterial;
  /** Terrain material clone for decor trees: adds the per-instance x-ray fade. */
  readonly kenneyDecor: THREE.MeshStandardMaterial;
  readonly kenneyTower: THREE.MeshStandardMaterial;
  readonly kenneyProjectile: THREE.MeshStandardMaterial;
  readonly frostProjectile: THREE.MeshStandardMaterial;
  readonly goalCrystal: THREE.MeshStandardMaterial;
  readonly waterMaterial: THREE.MeshStandardMaterial;
  readonly shoreFoamMaterial: THREE.ShaderMaterial;
  readonly waterUniforms = {
    uWaterTime: { value: 0 },
    uLagoonRadius: { value: 22 },
  };
  readonly outlineAlphaUniform = { value: 1 };
  readonly enemyInstancedMaterial: THREE.MeshStandardMaterial;
  readonly shadowDecalMaterial: THREE.MeshBasicMaterial;
  private readonly shadowDecalTexture: THREE.CanvasTexture;
  readonly hpBarMaterial: THREE.MeshBasicMaterial;
  readonly ghostValidMaterial: THREE.MeshStandardMaterial;
  readonly ghostInvalidMaterial: THREE.MeshStandardMaterial;

  constructor(colormapTexture?: THREE.Texture) {
    (Object.keys(PALETTE_HEX) as PaletteKey[]).forEach((key) => {
      const mat = new THREE.MeshStandardMaterial({
        color: PALETTE_HEX[key],
        flatShading: true,
        roughness: key === 'gold' ? 0.45 : key === 'water' ? 0.32 : 0.86,
        metalness: key === 'gold' || key === 'indigo' ? 0.14 : 0.02,
      });
      this.solid.set(key, mat);
    });

    this.vertexColored = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.84,
      metalness: 0.04,
    });

    this.kenneyTerrain = new THREE.MeshStandardMaterial({
      map: colormapTexture ?? null,
      vertexColors: true,
      flatShading: true,
      roughness: 0.88,
      metalness: 0.03,
    });

    this.kenneyDecor = this.kenneyTerrain.clone();
    this.kenneyDecor.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float aFade;
varying float vFade;`,
        )
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvFade = aFade;`);
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vFade;
${DITHER_FADE_GLSL}`,
        )
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${DITHER_FADE_DISCARD}`);
    };
    this.kenneyDecor.customProgramCacheKey = () => 'kenney-decor-fade-v1';

    // Towers encode outline ID 0.25 into framebuffer alpha so ScreenSpaceOutline Pass
    // draws thin ink silhouettes selectively on towers & enemies with zero extra scene draws.
    this.kenneyTower = new THREE.MeshStandardMaterial({
      map: colormapTexture ?? null,
      vertexColors: true,
      flatShading: true,
      roughness: 0.78,
      metalness: 0.08,
    });
    this.kenneyTower.onBeforeCompile = (shader) => {
      shader.uniforms.uOutlineAlpha = this.outlineAlphaUniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float aHighlight;
attribute float aFade;
varying float vHighlight;
varying float vFade;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vHighlight = aHighlight;
vFade = aFade;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uOutlineAlpha;
varying float vHighlight;
varying float vFade;
${DITHER_FADE_GLSL}`,
        )
        .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
${DITHER_FADE_DISCARD}`)
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(0.28, 0.24, 0.12) * vHighlight;`,
        )
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
gl_FragColor.a = mix(1.0, 0.25, uOutlineAlpha);`,
        );
    };
    this.kenneyTower.customProgramCacheKey = () => 'kenney-tower-outline-v4-fade';

    this.kenneyProjectile = new THREE.MeshStandardMaterial({
      map: colormapTexture ?? null,
      vertexColors: true,
      flatShading: true,
      roughness: 0.55,
      metalness: 0.14,
      emissive: 0x3b2c1a,
      emissiveIntensity: 0.35,
    });

    this.frostProjectile = new THREE.MeshStandardMaterial({
      color: 0xa6eeff,
      emissive: PALETTE_HEX.water,
      emissiveIntensity: 1.55,
      flatShading: true,
      roughness: 0.22,
      metalness: 0.16,
    });

    this.goalCrystal = new THREE.MeshStandardMaterial({
      map: colormapTexture ?? null,
      vertexColors: true,
      flatShading: true,
      roughness: 0.14,
      metalness: 0.22,
      emissive: 0x0b7cb8,
      emissiveIntensity: 0.34,
    });

    this.waterMaterial = new THREE.MeshStandardMaterial({
      color: 0x26aadf,
      emissive: 0x0b5882,
      emissiveIntensity: 0.14,
      flatShading: true,
      roughness: 0.2,
      metalness: 0.08,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    applyAlphaPreserveBlend(this.waterMaterial);
    this.waterMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uWaterTime = this.waterUniforms.uWaterTime;
      shader.uniforms.uLagoonRadius = this.waterUniforms.uLagoonRadius;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uWaterTime;
uniform float uLagoonRadius;
varying float vWaterRNorm;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float rNorm = clamp(length(transformed.xz) / max(1.0, uLagoonRadius), 0.0, 1.0);
vWaterRNorm = rNorm;
float waveFalloff = max(0.0, 1.0 - pow(rNorm, 3.2));
float waveH = (sin(transformed.x * 0.34 + uWaterTime * 1.45) * 0.085
  + cos(transformed.z * 0.40 - uWaterTime * 1.15) * 0.065
  + sin((transformed.x + transformed.z) * 0.24 + uWaterTime * 0.85) * 0.04) * waveFalloff;
transformed.y += waveH;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
varying float vWaterRNorm;`,
        )
        .replace(
          '#include <alphamap_fragment>',
          `#include <alphamap_fragment>
diffuseColor.a *= 1.0 - smoothstep(0.46, 0.94, vWaterRNorm);`,
        );
    };
    this.waterMaterial.customProgramCacheKey = () => 'water-vertex-waves-v2';

    this.shoreFoamMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      uniforms: {
        uWaterTime: this.waterUniforms.uWaterTime,
        uLagoonRadius: this.waterUniforms.uLagoonRadius,
        uFoamColor: { value: new THREE.Color(0xf7fdff) },
      },
      vertexShader: `
        uniform float uWaterTime;
        uniform float uLagoonRadius;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          vUv = uv;
          vec3 pos = position;
          float rNorm = clamp(length(pos.xz) / max(1.0, uLagoonRadius), 0.0, 1.0);
          float waveFalloff = max(0.0, 1.0 - pow(rNorm, 3.2));
          float waveH = (sin(pos.x * 0.34 + uWaterTime * 1.45) * 0.085
            + cos(pos.z * 0.40 - uWaterTime * 1.15) * 0.065
            + sin((pos.x + pos.z) * 0.24 + uWaterTime * 0.85) * 0.04) * waveFalloff;
          pos.y += waveH;
          vWorldPos = pos;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: `
        uniform float uWaterTime;
        uniform vec3 uFoamColor;
        varying vec2 vUv;
        varying vec3 vWorldPos;
        void main() {
          // vUv.y = 0 at cliff shoreline, 1 out in open water
          float waveShift = 0.14 * sin(vWorldPos.x * 2.5 + uWaterTime * 1.8)
            * cos(vWorldPos.z * 2.3 - uWaterTime * 1.5)
            + 0.08 * sin(vWorldPos.x * 4.1 - vWorldPos.z * 3.7 + uWaterTime * 2.3);
          float shore = 1.0 - clamp(vUv.y + waveShift, 0.0, 1.0);
          float crest = smoothstep(0.46, 0.86, shore);
          float rippleBand = smoothstep(0.14, 0.42, shore)
            * (0.45 + 0.55 * sin(vWorldPos.x * 3.4 + vWorldPos.z * 2.9 - uWaterTime * 2.1));
          float alpha = clamp(crest * 0.78 + max(0.0, rippleBand) * 0.26, 0.0, 0.82);
          gl_FragColor = vec4(uFoamColor, alpha);
        }
      `,
    });
    applyAlphaPreserveBlend(this.shoreFoamMaterial);

    this.enemyInstancedMaterial = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      roughness: 0.76,
      metalness: 0.06,
    });
    this.enemyInstancedMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uOutlineAlpha = this.outlineAlphaUniform;
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float aFlash;
varying float vFlash;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vFlash = aFlash;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uOutlineAlpha;
varying float vFlash;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(0.62, 0.52, 0.42) * vFlash;`,
        )
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
gl_FragColor.a = mix(1.0, 0.55, uOutlineAlpha);`,
        );
    };
    this.enemyInstancedMaterial.customProgramCacheKey = () => 'enemy-instanced-flash-v3';

    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 64;
    shadowCanvas.height = 64;
    const sCtx = shadowCanvas.getContext('2d');
    if (sCtx) {
      const grad = sCtx.createRadialGradient(32, 32, 4, 32, 32, 31);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.55, 'rgba(255,255,255,0.62)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      sCtx.fillStyle = grad;
      sCtx.fillRect(0, 0, 64, 64);
    }
    this.shadowDecalTexture = new THREE.CanvasTexture(shadowCanvas);

    this.shadowDecalMaterial = new THREE.MeshBasicMaterial({
      color: 0x1e1b38,
      map: this.shadowDecalTexture,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    applyAlphaPreserveBlend(this.shadowDecalMaterial);

    this.hpBarMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      depthTest: true,
      toneMapped: false,
    });
    this.hpBarMaterial.onBeforeCompile = (shader) => {
      shader.uniforms.uHpBgColor = { value: new THREE.Color(PALETTE_HEX.indigo) };
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
attribute float aHpRatio;
varying float vHpRatio;
varying vec2 vBarUv;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
vHpRatio = aHpRatio;
vBarUv = uv;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform vec3 uHpBgColor;
varying float vHpRatio;
varying vec2 vBarUv;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
float padX = 0.035;
float padY = 0.16;
float innerX = (vBarUv.x - padX) / (1.0 - 2.0 * padX);
if (vBarUv.y < padY || vBarUv.y > (1.0 - padY) || innerX < 0.0 || innerX > vHpRatio) {
  diffuseColor.rgb = uHpBgColor;
}`,
        );
    };
    this.hpBarMaterial.customProgramCacheKey = () => 'enemy-hp-bar-v1';

    this.ghostValidMaterial = new THREE.MeshStandardMaterial({
      color: PALETTE_HEX.grass,
      flatShading: true,
      transparent: true,
      opacity: 0.58,
      emissive: PALETTE_HEX.grass,
      emissiveIntensity: 0.25,
      depthWrite: false,
    });
    applyAlphaPreserveBlend(this.ghostValidMaterial);

    this.ghostInvalidMaterial = new THREE.MeshStandardMaterial({
      color: PALETTE_HEX.coral,
      flatShading: true,
      transparent: true,
      opacity: 0.58,
      emissive: PALETTE_HEX.coral,
      emissiveIntensity: 0.28,
      depthWrite: false,
    });
    applyAlphaPreserveBlend(this.ghostInvalidMaterial);
  }

  setOutlineAlphaEnabled(enabled: boolean): void {
    this.outlineAlphaUniform.value = enabled ? 1 : 0;
  }

  getSolid(key: PaletteKey): THREE.MeshStandardMaterial {
    return this.solid.get(key)!;
  }

  dispose(): void {
    this.solid.forEach((m) => m.dispose());
    this.solid.clear();
    this.vertexColored.dispose();
    this.kenneyTerrain.dispose();
    this.kenneyDecor.dispose();
    this.kenneyTower.dispose();
    this.kenneyProjectile.dispose();
    this.frostProjectile.dispose();
    this.goalCrystal.dispose();
    this.waterMaterial.dispose();
    this.shoreFoamMaterial.dispose();
    this.shadowDecalTexture.dispose();
    this.enemyInstancedMaterial.dispose();
    this.shadowDecalMaterial.dispose();
    this.hpBarMaterial.dispose();
    this.ghostValidMaterial.dispose();
    this.ghostInvalidMaterial.dispose();
  }
}
