import * as THREE from 'three';
import type { QualityLevel } from '../core/types.ts';
import { BALANCE } from '../data/balance.ts';
import { PALETTE_HEX, SKY_HORIZON_HEX, SKY_ZENITH_HEX } from '../data/palette.ts';
import { PostProcessingPipeline } from './postProcessing.ts';

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly hemiLight: THREE.HemisphereLight;
  readonly dirLight: THREE.DirectionalLight;
  private readonly canvas: HTMLCanvasElement;
  private quality: QualityLevel = 'high';
  private skyMesh: THREE.Mesh;
  private skyGeometry: THREE.PlaneGeometry;
  private skyMaterial: THREE.ShaderMaterial;
  private postProcessing: PostProcessingPipeline | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    // Track full multi-pass WebGL draw calls accurately across EffectComposer frames
    this.renderer.info.autoReset = false;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(canvas.clientWidth || window.innerWidth, canvas.clientHeight || window.innerHeight, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // High quality lets EffectComposer apply ACES Filmic once at the end of the pipeline
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(SKY_HORIZON_HEX, 72, 145);

    // Full-screen vertical gradient sky quad rendered first without depth writes
    this.skyGeometry = new THREE.PlaneGeometry(2, 2);
    this.skyMaterial = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uHorizon: { value: new THREE.Color(SKY_HORIZON_HEX) },
        uZenith: { value: new THREE.Color(SKY_ZENITH_HEX) },
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
        varying vec2 vUv;
        void main() {
          float t = smoothstep(0.08, 0.92, vUv.y);
          vec3 col = mix(uHorizon, uZenith, t);
          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.skyMesh = new THREE.Mesh(this.skyGeometry, this.skyMaterial);
    this.skyMesh.renderOrder = -1000;
    this.skyMesh.frustumCulled = false;
    this.scene.add(this.skyMesh);

    this.hemiLight = new THREE.HemisphereLight(
      SKY_ZENITH_HEX,
      PALETTE_HEX.dirt,
      0.92,
    );
    this.scene.add(this.hemiLight);

    this.dirLight = new THREE.DirectionalLight(PALETTE_HEX.cream, 1.62);
    this.dirLight.position.set(22, 34, 18);
    this.dirLight.castShadow = true;
    this.dirLight.shadow.mapSize.set(2048, 2048);
    this.dirLight.shadow.bias = -0.0004;
    this.dirLight.shadow.normalBias = 0.025;
    this.scene.add(this.dirLight);
    this.scene.add(this.dirLight.target);
  }

  get shadowsEnabled(): boolean {
    return this.renderer.shadowMap.enabled && this.dirLight.castShadow;
  }

  get postProcessingEnabled(): boolean {
    return this.quality !== 'low';
  }

  setQuality(quality: QualityLevel): void {
    this.quality = quality;
    const isLow = quality === 'low';
    this.renderer.shadowMap.enabled = !isLow;
    this.dirLight.castShadow = !isLow;
    this.renderer.shadowMap.needsUpdate = true;
    this.renderer.toneMapping = isLow ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    this.renderer.toneMappingExposure = isLow ? 1.06 : 1.0;
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.resize(w, h);
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
    const maxDpr = this.quality === 'low' ? 1 : 2;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, maxDpr));
    this.renderer.setSize(width, height, false);
    this.postProcessing?.setSize(width, height);
  }

  render(camera: THREE.Camera): void {
    this.renderer.info.reset();
    if (this.quality !== 'low') {
      if (!this.postProcessing) {
        const w = this.canvas.clientWidth || window.innerWidth;
        const h = this.canvas.clientHeight || window.innerHeight;
        this.postProcessing = new PostProcessingPipeline(this.renderer, this.scene, camera, w, h);
      }
      this.postProcessing.render();
    } else {
      this.renderer.render(this.scene, camera);
    }
  }

  dispose(): void {
    this.postProcessing?.dispose();
    this.postProcessing = null;
    this.skyGeometry.dispose();
    this.skyMaterial.dispose();
    this.renderer.dispose();
  }
}
