import * as THREE from 'three';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ppMocks = vi.hoisted(() => ({
  composerInstances: [] as Array<{
    options: unknown;
    passes: unknown[];
    setSize: ReturnType<typeof vi.fn>;
    addPass: ReturnType<typeof vi.fn>;
    render: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
  }>,
  n8aoInstances: [] as Array<{
    setQualityMode: ReturnType<typeof vi.fn>;
    configuration: Record<string, unknown>;
  }>,
  effectPassArgs: [] as unknown[][],
  effectBaseCtorCalls: [] as Array<{ name: string; frag: string; options: unknown }>,
}));

vi.mock('postprocessing', () => {
  class MockEffect {
    constructor(name: string, frag: string, options: unknown) {
      ppMocks.effectBaseCtorCalls.push({ name, frag, options });
    }
  }
  class MockEffectComposer {
    passes: unknown[] = [];
    setSize = vi.fn();
    addPass = vi.fn((pass: unknown) => {
      this.passes.push(pass);
    });
    render = vi.fn();
    dispose = vi.fn();
    constructor(
      public readonly renderer: unknown,
      public readonly options: unknown,
    ) {
      ppMocks.composerInstances.push(this);
    }
  }
  class MockRenderPass {
    constructor(
      public readonly scene: unknown,
      public readonly camera: unknown,
    ) {}
  }
  class MockEffectPass {
    constructor(
      public readonly camera: unknown,
      ...effects: unknown[]
    ) {
      ppMocks.effectPassArgs.push(effects);
    }
  }
  class MockBloomEffect {
    constructor(public readonly options: unknown) {}
  }
  class MockHueSaturationEffect {
    constructor(public readonly options: unknown) {}
  }
  class MockToneMappingEffect {
    constructor(public readonly options: unknown) {}
  }
  class MockSMAAEffect {
    constructor(public readonly options: unknown) {}
  }
  return {
    BlendFunction: { NORMAL: 1, ADD: 2 },
    EffectAttribute: { CONVOLUTION: 1, DEPTH: 2 },
    SMAAPreset: { MEDIUM: 'medium' },
    ToneMappingMode: { NEUTRAL: 'neutral' },
    Effect: MockEffect,
    EffectComposer: MockEffectComposer,
    RenderPass: MockRenderPass,
    EffectPass: MockEffectPass,
    BloomEffect: MockBloomEffect,
    HueSaturationEffect: MockHueSaturationEffect,
    ToneMappingEffect: MockToneMappingEffect,
    SMAAEffect: MockSMAAEffect,
  };
});

vi.mock('n8ao', () => {
  class MockN8AOPostPass {
    setQualityMode = vi.fn();
    configuration: Record<string, unknown> = {};
    constructor(
      public readonly scene: unknown,
      public readonly camera: unknown,
      public readonly width: number,
      public readonly height: number,
    ) {
      ppMocks.n8aoInstances.push(this);
    }
  }
  return { N8AOPostPass: MockN8AOPostPass };
});

import { PostProcessingPipeline } from '../../src/render/postProcessing.ts';

describe('PostProcessingPipeline pass chain and lifecycle', () => {
  beforeEach(() => {
    ppMocks.composerInstances.length = 0;
    ppMocks.n8aoInstances.length = 0;
    ppMocks.effectPassArgs.length = 0;
    ppMocks.effectBaseCtorCalls.length = 0;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('builds RenderPass -> N8AO -> Outline/Bloom/HueSat/ToneMapping -> SMAA, clamps size, and disposes', () => {
    const renderer = {} as unknown as THREE.WebGLRenderer;
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 100);

    const pipeline = new PostProcessingPipeline(renderer, scene, camera, 1280, 720);

    expect(ppMocks.composerInstances).toHaveLength(1);
    const composer = ppMocks.composerInstances[0];
    expect(composer.options).toEqual({
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });
    expect(composer.setSize).toHaveBeenCalledWith(1280, 720, false);
    expect(composer.passes).toHaveLength(4);

    // N8AO configured cleanly
    expect(ppMocks.n8aoInstances).toHaveLength(1);
    const n8ao = ppMocks.n8aoInstances[0];
    expect(n8ao.setQualityMode).toHaveBeenCalledWith('Medium');
    expect(n8ao.configuration.gammaCorrection).toBe(false);
    expect(n8ao.configuration.halfRes).toBe(false);
    expect(n8ao.configuration.aoRadius).toBe(1.25);

    // Custom SilhouetteOutlineEffect shader + uniforms wired
    expect(ppMocks.effectBaseCtorCalls).toHaveLength(1);
    expect(ppMocks.effectBaseCtorCalls[0].name).toBe('SilhouetteOutlineEffect');
    expect(ppMocks.effectBaseCtorCalls[0].frag).toContain('uOutlineStrength');
    expect(ppMocks.effectPassArgs).toHaveLength(2);
    expect(ppMocks.effectPassArgs[0]).toHaveLength(4); // outline, bloom, hueSat, toneMapping
    expect(ppMocks.effectPassArgs[1]).toHaveLength(1); // SMAA

    // setSize clamps non-positive dimensions to >= 1
    pipeline.setSize(0, -25);
    expect(composer.setSize).toHaveBeenLastCalledWith(1, 1, false);

    pipeline.setSize(800, 600);
    expect(composer.setSize).toHaveBeenLastCalledWith(800, 600, false);

    pipeline.render();
    expect(composer.render).toHaveBeenCalledTimes(1);

    pipeline.dispose();
    expect(composer.dispose).toHaveBeenCalledTimes(1);
  });
});
