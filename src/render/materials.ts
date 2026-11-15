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

/**
 * Shared palette & Kenney-textured materials with disposal tracker.
 */
export class MaterialLibrary {
  readonly solid = new Map<PaletteKey, THREE.MeshStandardMaterial>();
  readonly vertexColored: THREE.MeshStandardMaterial;
  readonly kenneyTerrain: THREE.MeshStandardMaterial;
  readonly kenneyTower: THREE.MeshStandardMaterial;
  readonly kenneyProjectile: THREE.MeshStandardMaterial;
  readonly frostProjectile: THREE.MeshStandardMaterial;
  readonly goalCrystal: THREE.MeshStandardMaterial;
  readonly waterMaterial: THREE.MeshStandardMaterial;
  readonly waterUniforms = {
    uWaterTime: { value: 0 },
    uLagoonRadius: { value: 22 },
  };
  readonly outlineAlphaUniform = { value: 1 };
  readonly enemyInstancedMaterial: THREE.MeshStandardMaterial;
  readonly shadowDecalMaterial: THREE.MeshBasicMaterial;
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
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
uniform float uOutlineAlpha;`,
        )
        .replace(
          '#include <opaque_fragment>',
          `#include <opaque_fragment>
gl_FragColor.a = mix(1.0, 0.25, uOutlineAlpha);`,
        );
    };
    this.kenneyTower.customProgramCacheKey = () => 'kenney-tower-outline-v2';

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
      color: PALETTE_HEX.water,
      flatShading: true,
      roughness: 0.25,
      metalness: 0.08,
      transparent: true,
      opacity: 0.84,
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
uniform float uLagoonRadius;`,
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
float rNorm = clamp(length(transformed.xz) / max(1.0, uLagoonRadius), 0.0, 1.0);
float waveFalloff = max(0.0, 1.0 - pow(rNorm, 3.2));
float waveH = (sin(transformed.x * 0.34 + uWaterTime * 1.45) * 0.085
  + cos(transformed.z * 0.40 - uWaterTime * 1.15) * 0.065
  + sin((transformed.x + transformed.z) * 0.24 + uWaterTime * 0.85) * 0.04) * waveFalloff;
transformed.y += waveH;`,
        );
    };
    this.waterMaterial.customProgramCacheKey = () => 'water-vertex-waves-v1';

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

    this.shadowDecalMaterial = new THREE.MeshBasicMaterial({
      color: PALETTE_HEX.indigo,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
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
    this.kenneyTower.dispose();
    this.kenneyProjectile.dispose();
    this.frostProjectile.dispose();
    this.goalCrystal.dispose();
    this.waterMaterial.dispose();
    this.enemyInstancedMaterial.dispose();
    this.shadowDecalMaterial.dispose();
    this.hpBarMaterial.dispose();
    this.ghostValidMaterial.dispose();
    this.ghostInvalidMaterial.dispose();
  }
}
