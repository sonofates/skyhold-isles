import { Container, GlProgram, ImageSource, Mesh, MeshGeometry, Shader, VideoSource } from 'pixi.js';
import { AmbientFxLayer, getAmbientFxConfig, isReducedMotion, type AmbientFxStats } from './ambientFx.ts';
import { MAP_ANIM_TABLE as maps } from './islandTable.ts';
import type { QualityTier } from './renderResolution.ts';

interface AmbientTrack {
  file: string;
  mask: string;
  width: number;
  height: number;
  fps: number;
}

export interface AmbientMap extends AmbientTrack {
  compact?: AmbientTrack;
  elements: { rect: number[]; cell: number[]; depth: number }[];
}

// Each file describes one island's color video, feathered mask and layout rectangles; one lazy
// chunk per island (islandTable.ts `MAP_ANIM_TABLE`), loaded before `mapAnimLayer` is built.

const vertex = `
  in vec2 aPosition;
  in vec2 aUV;
  uniform mat3 uProjectionMatrix;
  uniform mat3 uWorldTransformMatrix;
  uniform mat3 uTransformMatrix;
  out vec2 vUV;
  void main() {
    vUV = aUV;
    vec3 p = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix * vec3(aPosition, 1.);
    gl_Position = vec4(p.xy, 0., 1.);
  }
`;
const fragment = `
  in vec2 vUV;
  uniform sampler2D uMovie;
  uniform sampler2D uMask;
  uniform vec4 uColor;
  out vec4 finalColor;
  void main() {
    vec3 color = texture(uMovie, vUV).rgb;
    float alpha = texture(uMask, vUV).r;
    finalColor = vec4(color * alpha, alpha) * uColor;
  }
`;

function islandGeometry(data: AmbientMap): MeshGeometry {
  const positions = [], uvs = [], indices = [];
  for (const element of [...data.elements].sort((a, b) => a.depth - b.depth)) {
    const [x, y, w, h] = element.rect;
    const [cx, cy, cw, ch] = element.cell;
    const u = cx / data.width, v = cy / data.height;
    const r = (cx + cw) / data.width, b = (cy + ch) / data.height;
    const i = positions.length / 2;
    positions.push(x, y, x + w, y, x + w, y + h, x, y + h);
    uvs.push(u, v, r, v, r, b, u, b);
    indices.push(i, i + 1, i + 2, i, i + 2, i + 3);
  }
  return new MeshGeometry({
    positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices: new Uint32Array(indices),
  });
}

/** One decoder, one persistent mesh and one draw for all of an island's moving paint. */
class AmbientPlayer {
  private readonly video = document.createElement('video');
  private readonly image = new Image();
  private readonly source: VideoSource;
  private mask?: ImageSource;
  private mesh?: Mesh<MeshGeometry, Shader>;
  private readonly host: Container;
  private readonly data: AmbientMap;
  readonly track: AmbientTrack;
  private readonly onUpload?: () => void;
  private requested = false;
  private blocked = false;
  private failed = false;
  private lastFrame = -1;

  constructor(host: Container, data: AmbientMap, track: AmbientTrack, base: string, onUpload?: () => void) {
    this.host = host;
    this.data = data;
    this.track = track;
    this.onUpload = onUpload;
    const video = this.video;
    video.muted = video.defaultMuted = video.loop = video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = this.image.crossOrigin = 'anonymous';
    // The game ticker owns uploads and playback. Pixi must not install a second ticker.
    this.source = new VideoSource({ resource: video, autoLoad: false, autoPlay: false, width: track.width, height: track.height });
    video.onloadeddata = video.onplaying = this.showWhenReady;
    video.onseeked = this.upload;
    video.onerror = this.image.onerror = this.fail;
    this.image.onload = this.showWhenReady;
    this.image.src = base + track.mask;
    video.src = base + track.file;
    document.addEventListener('visibilitychange', this.visibility);
  }

  private showWhenReady = (): void => {
    if (this.failed || this.mesh || !this.image.naturalWidth || this.video.readyState < 2) return;
    this.mask = new ImageSource({ resource: this.image });
    const shader = new Shader({
      glProgram: GlProgram.from({ vertex, fragment, name: 'ambient-map' }),
      resources: { uMovie: this.source, uMask: this.mask },
    });
    this.mesh = new Mesh({ geometry: islandGeometry(this.data), shader });
    this.mesh.eventMode = 'none';
    // Index 0 inside the dedicated ambient host: over the map sprite, under procedural FX & battle layers.
    this.host.addChildAt(this.mesh, 0);
    this.upload();
    this.onUpload?.();
  };

  private upload = (): void => {
    // Ease onto the actual map at both sides of the join. This also closes differences
    // between the 3x generation source and the particular bake currently under the boats.
    const fps = this.track.fps;
    const frame = Math.floor(this.video.currentTime * fps + 0.0001);
    if (this.mesh && Number.isFinite(this.video.duration)) {
      const remaining = Math.round(this.video.duration * fps) - 1 - frame;
      const t = Math.max(0, Math.min(1, frame / (fps * 0.25), remaining / (fps * 0.5)));
      this.mesh.alpha = t * t * (3 - 2 * t);
    }
    this.lastFrame = frame;
    this.source.update();
  };

  private visibility = (): void => {
    if (document.hidden) this.pause();
  };

  private fail = (): void => {
    this.failed = true;
    if (this.mesh) this.mesh.visible = false;
    this.pause();
  };

  private pause(): void {
    this.requested = false;
    this.video.pause();
  }

  private play = (): void => {
    this.blocked = false;
    if (document.hidden || !this.requested) return;
    void this.video.play().catch((error: DOMException) => {
      if (!this.requested || error.name === 'AbortError') return;
      if (error.name !== 'NotAllowedError') return this.fail();
      this.blocked = true;
      window.addEventListener('pointerdown', this.play, { once: true });
    });
  };

  update(paused: boolean): void {
    if (paused || document.hidden) {
      if (this.requested) this.pause();
      return;
    }
    if (this.failed) return;
    if (!this.requested) {
      this.requested = true;
      if (!this.blocked) this.play();
    }
    if (!this.mesh) return;
    const frame = Math.floor(this.video.currentTime * this.track.fps + 0.0001);
    if (frame !== this.lastFrame) this.upload();
  }

  destroy(): void {
    document.removeEventListener('visibilitychange', this.visibility);
    window.removeEventListener('pointerdown', this.play);
    this.video.onplaying = this.video.onloadeddata = this.video.onseeked = this.video.onerror = null;
    this.image.onload = this.image.onerror = null;
    this.pause();
    if (this.mesh) {
      const { geometry, shader } = this.mesh;
      if (!this.mesh.destroyed) this.mesh.destroy();
      geometry.destroy(true);
      shader?.destroy();
      this.mesh = undefined;
    }
    this.mask?.destroy();
    this.mask = undefined;
    this.source.destroy();
  }
}

export interface MapAnimController {
  update(enabled: boolean, paused: boolean, smallBake: boolean, dtSec?: number, tier?: QualityTier): void;
  /** QA: advance procedural ambient FX deterministically when ticker is frozen. */
  stepFx(dtSec: number, tier?: QualityTier): void;
  /** QA: inspect procedural ambient FX state (null if island has no procedural config). */
  debug(): AmbientFxStats | null;
}

export function mapAnimLayer(world: Container, island: string, base: string, onVideoUpload?: () => void): MapAnimController | undefined {
  const data = maps.get(island);
  const fxConfig = getAmbientFxConfig(island);
  if (!data && !fxConfig) return;

  // Dedicated ambient host strictly at index 1 in `world`: immediately above the map sprite (index 0)
  // and strictly below all battle layers (groundFx, plots, shadows, actors, air, projectiles, fx, bars).
  const host = new Container();
  host.eventMode = 'none';
  host.interactiveChildren = false;
  world.addChildAt(host, Math.min(1, world.children.length));

  let player: AmbientPlayer | undefined;
  let fx: AmbientFxLayer | undefined;
  let destroyed = false;
  let lastPaused = false;

  const releaseVideo = (): void => {
    player?.destroy();
    player = undefined;
  };
  const releaseFx = (): void => {
    fx?.destroy();
    fx = undefined;
  };
  const releaseRuntime = (): void => {
    releaseVideo();
    releaseFx();
  };
  const releaseAll = (): void => {
    destroyed = true;
    releaseRuntime();
    if (!host.destroyed) host.destroy({ children: true });
  };
  const ensureFx = (): AmbientFxLayer | undefined => {
    if (destroyed || !fxConfig || host.destroyed) return undefined;
    if (!fx) {
      fx = new AmbientFxLayer(fxConfig);
      host.addChild(fx.root);
    }
    return fx;
  };

  if (typeof window !== 'undefined') window.addEventListener('pagehide', releaseRuntime);
  world.once('destroyed', () => {
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', releaseRuntime);
    releaseAll();
  });

  return {
    update(enabled: boolean, paused: boolean, smallBake: boolean, dtSec = 1 / 60, tier: QualityTier = 'high'): void {
      if (destroyed || host.destroyed) return;
      const hidden = typeof document !== 'undefined' && document.hidden;
      const effectiveEnabled = enabled && tier !== 'low' && !isReducedMotion();
      lastPaused = paused || hidden;

      if (data && typeof document !== 'undefined' && typeof Image !== 'undefined') {
        if (!effectiveEnabled) {
          if (player) releaseVideo();
        } else {
          const track = smallBake && data.compact ? data.compact : data;
          if (player && player.track !== track) releaseVideo();
          if (!player && !paused && !hidden) player = new AmbientPlayer(host, data, track, base, onVideoUpload);
          player?.update(paused);
        }
      }

      if (fxConfig) {
        if (!effectiveEnabled) {
          if (fx) releaseFx();
        } else if (!lastPaused) {
          ensureFx()?.update(true, false, dtSec, tier);
        } else if (fx) {
          fx.update(true, true, dtSec, tier);
        }
      }
    },
    stepFx(dtSec: number, tier: QualityTier = 'high'): void {
      if (destroyed || !fxConfig || tier === 'low' || isReducedMotion()) return;
      const layer = ensureFx();
      if (!layer) return;
      layer.root.visible = true;
      layer.step(dtSec, tier);
    },
    debug(): AmbientFxStats | null {
      if (!fxConfig) return null;
      if (fx) return fx.debug();
      return {
        island: fxConfig.island,
        built: false,
        enabled: false,
        paused: lastPaused,
        time: 0,
        activeParticles: 0,
        particleCap: 0,
        crackSegments: 0,
        flames: 0,
        glows: 0,
        zones: fxConfig.zones?.length ?? 0,
      };
    },
  };
}
