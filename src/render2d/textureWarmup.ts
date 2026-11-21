import {
  extensions, ExtensionType, RendererType, Texture, TextureSource, UPDATE_PRIORITY,
  type Application, type GlTexture, type WebGLRenderer,
} from 'pixi.js';

const SLICE_MS = 3;
const SLICE_PIXELS = 256 * 1024;
const STRIP_PIXELS = 64 * 1024;

// Pixi installs texture uploaders when the renderer is constructed. This one adopts a complete
// scratch texture. Pixi still owns registration, format, sampling, mip generation and disposal.
const staged = new WeakMap<TextureSource, GlTexture>();
const stagedMethod = 'level-staged-image';
extensions.add({
  extension: { type: ExtensionType.TextureUploaderWebGL, name: stagedMethod },
  upload(source: TextureSource, target: GlTexture, gl: WebGL2RenderingContext) {
    const scratch = staged.get(source)!;
    const empty = target.texture;
    target.texture = scratch.texture;
    scratch.texture = empty;
    target.width = source.pixelWidth;
    target.height = source.pixelHeight;
    gl.bindTexture(target.target, target.texture);
  },
});

function canUploadInStrips(src: TextureSource): boolean {
  return src.uploadMethodId === 'image' && src.viewDimension === '2d' &&
    (src.format === 'bgra8unorm' || src.format === 'rgba8unorm') &&
    typeof ImageBitmap !== 'undefined' && src.resource instanceof ImageBitmap &&
    src.resource.width === src.pixelWidth && src.resource.height === src.pixelHeight;
}

/** The real source stays drawable by Pixi throughout. Partial sheets never reach the stage. */
class SheetUpload {
  readonly scratch: TextureSource;
  row = 0;

  constructor(source: TextureSource) {
    this.scratch = new TextureSource({
      width: source.pixelWidth, height: source.pixelHeight, format: source.format,
      alphaMode: source.alphaMode, resolution: 1,
    });
  }

  advance(renderer: WebGLRenderer, source: TextureSource, pixelBudget: number): number {
    const gl = renderer.gl;
    // Context restoration drops the scratch allocation, including any previously copied rows.
    if (!this.scratch._gpuData[renderer.uid]) this.row = 0;
    // bindSource may elide a bind to an already-bound texture on an inactive unit.
    // Force unit zero active through Pixi so its GL state cache stays in sync.
    renderer.texture.bindSource(Texture.EMPTY.source);
    renderer.texture.bindSource(this.scratch);
    const width = source.pixelWidth;
    const rows = Math.min(source.pixelHeight - this.row, Math.max(1, Math.floor(pixelBudget / width)));
    gl.pixelStorei(gl.UNPACK_SKIP_ROWS, this.row);
    try {
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, this.row, width, rows, gl.RGBA, gl.UNSIGNED_BYTE, source.resource as ImageBitmap);
    } finally {
      gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    }
    this.row += rows;
    if (this.row === source.pixelHeight) {
      const method = source.uploadMethodId;
      staged.set(source, renderer.texture.getGlSource(this.scratch));
      source.uploadMethodId = stagedMethod;
      try {
        renderer.texture.initSource(source);
      } finally {
        source.uploadMethodId = method;
        staged.delete(source);
      }
    }
    return width * rows;
  }
}

/** Warm the ordered boot catalog after input is enabled, and confirm completion without a GPU wait. */
export function warmTextureSources(app: Application, sources: TextureSource[], onResident: () => void) {
  const { renderer, ticker } = app;
  const webgl2 = 'gl' in renderer && 'fenceSync' in renderer.gl ? renderer : null;
  const gl = webgl2?.gl;
  const input = (navigator as Navigator & { scheduling?: { isInputPending(): boolean } }).scheduling;
  const missing = (src: TextureSource): boolean =>
    renderer.type !== RendererType.CANVAS && !src.destroyed && !src._gpuData[renderer.uid];
  let queue = sources.filter(missing);
  // A slow or backgrounded pass can outlast Pixi's idle GC interval. Explicit unloads still work.
  const evictable = sources.filter(src => src.autoGarbageCollect);
  for (const src of evictable) src.autoGarbageCollect = false;
  let cursor = 0;
  let sheet: SheetUpload | null = null;
  let uploaded = 0;
  let worstSliceMs = 0;
  let allResidentAt: number | null = null;
  let gpuConfirmed = false;
  let fence: WebGLSync | null = null;

  const tick = (): void => {
    if (document.hidden || input?.isInputPending() || gl?.isContextLost()) return;
    if (gl && fence) {
      const status = gl.clientWaitSync(fence, 0, 0);
      if (status === gl.TIMEOUT_EXPIRED) return;
      gl.deleteSync(fence);
      fence = null;
      gpuConfirmed = status === gl.ALREADY_SIGNALED || status === gl.CONDITION_SATISFIED;
    }
    const start = performance.now();
    let pixels = 0;
    while (cursor < queue.length) {
      const src = queue[cursor];
      if (missing(src)) {
        const size = src.pixelWidth * src.pixelHeight;
        if (webgl2 && size > STRIP_PIXELS && canUploadInStrips(src)) {
          sheet ??= new SheetUpload(src);
          pixels += sheet.advance(webgl2, src, Math.min(STRIP_PIXELS, SLICE_PIXELS - pixels));
        } else {
          if (pixels && pixels + size > SLICE_PIXELS) break;
          renderer.texture.initSource(src);
          pixels += size;
        }
        if (!missing(src)) uploaded++;
      }
      if (!missing(src)) {
        // Also discard a partial transfer if a normal draw won the race or a map swap unloaded it.
        sheet?.scratch.destroy();
        sheet = null;
        cursor++;
      }
      if (performance.now() - start >= SLICE_MS || pixels >= SLICE_PIXELS || input?.isInputPending()) break;
    }
    worstSliceMs = Math.max(worstSliceMs, performance.now() - start);
    if (cursor < queue.length) return;
    queue = sources.filter(missing);
    cursor = 0;
    if (queue.length) {
      gpuConfirmed = false;
      return;
    }
    if (gl && !gpuConfirmed) {
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (fence) {
        gl.flush();
        return;
      }
    }
    ticker.remove(tick);
    for (const src of evictable) src.autoGarbageCollect = true;
    allResidentAt = performance.now();
    onResident();
  };

  ticker.add(tick, null, UPDATE_PRIORITY.HIGH);
  return () => ({
    total: sources.filter(src => !src.destroyed).length,
    pending: sources.filter(missing).length,
    uploaded, allResidentAt, gpuConfirmed, worstSliceMs,
  });
}
