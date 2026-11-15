import * as THREE from 'three';
import { PALETTE_HEX, type PaletteKey } from '../data/palette.ts';

/**
 * Shared flat-shaded palette materials and disposal tracker.
 */
export class MaterialLibrary {
  readonly solid = new Map<PaletteKey, THREE.MeshStandardMaterial>();
  readonly vertexColored: THREE.MeshStandardMaterial;
  readonly waterMaterial: THREE.MeshStandardMaterial;
  readonly waterUniforms = {
    uWaterTime: { value: 0 },
    uLagoonRadius: { value: 22 },
  };
  readonly enemyInstancedMaterial: THREE.MeshStandardMaterial;
  readonly shadowDecalMaterial: THREE.MeshBasicMaterial;
  readonly hpBarMaterial: THREE.MeshBasicMaterial;
  readonly ghostValidMaterial: THREE.MeshStandardMaterial;
  readonly ghostInvalidMaterial: THREE.MeshStandardMaterial;

  constructor() {
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

    this.waterMaterial = new THREE.MeshStandardMaterial({
      color: PALETTE_HEX.water,
      flatShading: true,
      roughness: 0.25,
      metalness: 0.08,
      transparent: true,
      opacity: 0.84,
    });
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
      roughness: 0.8,
      metalness: 0.04,
    });
    this.enemyInstancedMaterial.onBeforeCompile = (shader) => {
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
varying float vFlash;`,
        )
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(vFlash * 0.92);`,
        );
    };
    this.enemyInstancedMaterial.customProgramCacheKey = () => 'enemy-instanced-flash-v1';

    this.shadowDecalMaterial = new THREE.MeshBasicMaterial({
      color: PALETTE_HEX.indigo,
      transparent: true,
      opacity: 0.28,
      depthWrite: false,
    });

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

    this.ghostInvalidMaterial = new THREE.MeshStandardMaterial({
      color: PALETTE_HEX.coral,
      flatShading: true,
      transparent: true,
      opacity: 0.58,
      emissive: PALETTE_HEX.coral,
      emissiveIntensity: 0.28,
      depthWrite: false,
    });
  }

  getSolid(key: PaletteKey): THREE.MeshStandardMaterial {
    return this.solid.get(key)!;
  }

  dispose(): void {
    this.solid.forEach((m) => m.dispose());
    this.solid.clear();
    this.vertexColored.dispose();
    this.waterMaterial.dispose();
    this.enemyInstancedMaterial.dispose();
    this.shadowDecalMaterial.dispose();
    this.hpBarMaterial.dispose();
    this.ghostValidMaterial.dispose();
    this.ghostInvalidMaterial.dispose();
  }
}
