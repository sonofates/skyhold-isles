import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BALANCE } from '../../src/data/balance.ts';

const pipelineState = vi.hoisted(() => ({
  instances: [] as Array<{ setSize: ReturnType<typeof vi.fn>; render: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }>,
  rendererInstances: [] as Array<{
    info: {
      autoReset: boolean;
      reset: ReturnType<typeof vi.fn>;
      render: { calls: number; triangles: number };
      memory: { geometries: number; textures: number };
    };
    shadowMap: { enabled: boolean; type: unknown; needsUpdate: boolean };
    outputColorSpace: unknown;
    toneMapping: unknown;
    toneMappingExposure: number;
    setPixelRatio: ReturnType<typeof vi.fn>;
    setSize: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
}));

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class MockWebGLRenderer {
    info = {
      autoReset: true,
      reset: vi.fn(),
      render: { calls: 0, triangles: 0 },
      memory: { geometries: 0, textures: 0 },
    };
    shadowMap = { enabled: false, type: actual.PCFShadowMap, needsUpdate: false };
    outputColorSpace = actual.SRGBColorSpace;
    toneMapping = actual.NoToneMapping;
    toneMappingExposure = 1;
    domElement = { style: { cursor: '' } };
    setPixelRatio = vi.fn();
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();

    constructor() {
      pipelineState.rendererInstances.push(this);
    }
  }
  return {
    ...actual,
    WebGLRenderer: MockWebGLRenderer,
  };
});

vi.mock('../../src/render/postProcessing.ts', () => {
  class MockPostProcessingPipeline {
    setSize = vi.fn();
    render = vi.fn();
    dispose = vi.fn();
    constructor() {
      pipelineState.instances.push(this);
    }
  }
  return { PostProcessingPipeline: MockPostProcessingPipeline };
});

import { SceneManager } from '../../src/render/sceneManager.ts';

describe('SceneManager quality, shadow frustum, render pipeline, and disposal', () => {
  beforeEach(() => {
    pipelineState.instances.length = 0;
    pipelineState.rendererInstances.length = 0;
    vi.stubGlobal('window', {
      devicePixelRatio: 3,
      innerWidth: 1280,
      innerHeight: 720,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('configures renderer defaults, lazily creates PostProcessingPipeline on high, and disposes it on low', () => {
    const canvas = { clientWidth: 1024, clientHeight: 768 } as unknown as HTMLCanvasElement;
    const mgr = new SceneManager(canvas);
    const mockRenderer = pipelineState.rendererInstances[0];

    expect(mockRenderer.info.autoReset).toBe(false);
    expect(mockRenderer.setPixelRatio).toHaveBeenCalledWith(2); // capped at 2 on high
    expect(mockRenderer.setSize).toHaveBeenCalledWith(1024, 768, false);
    expect(mgr.shadowsEnabled).toBe(true);
    expect(mgr.postProcessingEnabled).toBe(true);

    // High render lazily instantiates PostProcessingPipeline and uses composer.render()
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);
    mgr.render(camera);
    expect(mockRenderer.info.reset).toHaveBeenCalledTimes(1);
    expect(pipelineState.instances).toHaveLength(1);
    expect(pipelineState.instances[0].render).toHaveBeenCalledTimes(1);
    expect(mockRenderer.render).not.toHaveBeenCalled();

    // Resize updates DPR & composer size
    mgr.resize(800, 600);
    expect(pipelineState.instances[0].setSize).toHaveBeenCalledWith(800, 600);

    // Switching to low disables shadows, sets NeutralToneMapping + DPR=1, and disposes composer
    mgr.setQuality('low');
    expect(mgr.shadowsEnabled).toBe(false);
    expect(mgr.postProcessingEnabled).toBe(false);
    expect(mockRenderer.toneMapping).toBe(THREE.NeutralToneMapping);
    expect(mockRenderer.toneMappingExposure).toBe(1.06);
    expect(mockRenderer.setPixelRatio).toHaveBeenLastCalledWith(1);
    expect(pipelineState.instances[0].dispose).toHaveBeenCalledTimes(1);

    // Rendering on low falls back to direct renderer.render()
    mgr.render(camera);
    expect(mockRenderer.render).toHaveBeenCalledWith(mgr.scene, camera);

    // Switching back to high recreates a fresh PostProcessingPipeline on next render
    mgr.setQuality('high');
    expect(mgr.shadowsEnabled).toBe(true);
    expect(mockRenderer.toneMapping).toBe(THREE.NoToneMapping);
    mgr.render(camera);
    expect(pipelineState.instances).toHaveLength(2);

    mgr.dispose();
    expect(pipelineState.instances[1].dispose).toHaveBeenCalledTimes(1);
    expect(mockRenderer.dispose).toHaveBeenCalledTimes(1);
  });

  it('fits directional shadow frustum cleanly around map dimensions', () => {
    const canvas = { clientWidth: 0, clientHeight: 0 } as unknown as HTMLCanvasElement;
    const mgr = new SceneManager(canvas);

    // Falls back to window.innerWidth/innerHeight when canvas clientWidth/Height are 0
    expect(pipelineState.rendererInstances[0].setSize).toHaveBeenCalledWith(1280, 720, false);

    mgr.fitShadowToMap(16, 12);
    const cam = mgr.dirLight.shadow.camera;
    const expectedExtent = (16 * BALANCE.tileSize) * 0.58 + 3;
    expect(cam.left).toBeCloseTo(-expectedExtent, 5);
    expect(cam.right).toBeCloseTo(expectedExtent, 5);
    expect(cam.top).toBeCloseTo(expectedExtent, 5);
    expect(cam.bottom).toBeCloseTo(-expectedExtent, 5);
    expect(cam.near).toBe(6);
    expect(cam.far).toBe(96);

    mgr.dispose();
  });

  it('clamps devicePixelRatio by quality/device and resizes safely before composer creation', () => {
    vi.stubGlobal('window', {
      devicePixelRatio: 1.5,
      innerWidth: 1024,
      innerHeight: 768,
    });
    const canvas = { clientWidth: 900, clientHeight: 600 } as unknown as HTMLCanvasElement;
    const mgr = new SceneManager(canvas);
    const mockRenderer = pipelineState.rendererInstances[0];

    expect(mockRenderer.setPixelRatio).toHaveBeenCalledWith(1.5);

    // 0/NaN devicePixelRatio falls back to 1
    vi.stubGlobal('window', {
      devicePixelRatio: 0,
      innerWidth: 1024,
      innerHeight: 768,
    });
    mgr.resize(640, 480);
    expect(mockRenderer.setPixelRatio).toHaveBeenLastCalledWith(1);
    expect(mockRenderer.setSize).toHaveBeenLastCalledWith(640, 480, false);
    expect(pipelineState.instances).toHaveLength(0);

    // Quality 'low' clamps high DPR (3) down to 1
    vi.stubGlobal('window', {
      devicePixelRatio: 3,
      innerWidth: 1024,
      innerHeight: 768,
    });
    mgr.setQuality('low');
    expect(mockRenderer.setPixelRatio).toHaveBeenLastCalledWith(1);

    mgr.dispose();
  });
});
