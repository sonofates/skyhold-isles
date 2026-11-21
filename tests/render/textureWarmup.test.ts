import { afterEach, expect, it, vi } from 'vitest';
import type { Application, TextureSource } from 'pixi.js';
import { warmTextureSources } from '../../src/render2d/textureWarmup.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('pauses while hidden, yields after the budget and skips a source first drawn between slices', () => {
  const page = { hidden: true };
  vi.stubGlobal('document', page);
  const isInputPending = vi.fn(() => false);
  vi.stubGlobal('navigator', { scheduling: { isInputPending } });
  let ms = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => ms);
  const sources = Array.from({ length: 4 }, () => ({
    pixelWidth: 32, pixelHeight: 32, autoGarbageCollect: true, _gpuData: {} as Record<number, object>,
  }));
  sources[0]._gpuData[1] = {};
  const initSource = vi.fn((src: typeof sources[number]) => {
    ms += 3;
    src._gpuData[1] = {};
  });
  let tick!: () => void;
  const ticker = { add: (fn: () => void) => { tick = fn; }, remove: vi.fn() };
  const app = { renderer: { uid: 1, texture: { initSource } }, ticker };
  const done = vi.fn();
  const progress = warmTextureSources(app as unknown as Application, sources as unknown as TextureSource[], done);
  tick();
  expect(initSource).not.toHaveBeenCalled();
  page.hidden = false;
  isInputPending.mockReturnValueOnce(true);
  tick();
  expect(initSource).not.toHaveBeenCalled();
  tick();
  expect(progress()).toMatchObject({ uploaded: 1, pending: 2, allResidentAt: null });
  expect(initSource.mock.calls[0][0]).toBe(sources[1]);
  sources[2]._gpuData[1] = {};
  tick();
  expect(progress()).toMatchObject({ uploaded: 2, pending: 0, total: 4, allResidentAt: 6 });
  expect(initSource.mock.calls[1][0]).toBe(sources[3]);
  expect(done).toHaveBeenCalledOnce();
  expect(ticker.remove).toHaveBeenCalledWith(tick);
  expect(sources.every(src => src.autoGarbageCollect)).toBe(true);
});
