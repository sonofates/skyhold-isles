import type { Application, TextureSource } from 'pixi.js';
import { isLeavingPage } from './ui/transition2d.ts';

/** What a battle page let go of when the browser put it in the back/forward cache (QA). */
export interface PageCacheRelease {
  readonly textures: number;
  readonly bitmaps: number;
  readonly contextLost: boolean;
}

/**
 * Leaving a battle (world map, next island: full page loads) can park the page in the browser's
 * back/forward cache, alive with its WebGL context — every GPU texture (430–580 MB on a phone at
 * the late islands) and every decoded sheet — for as long as the browser keeps it. Five island
 * switches could hold five battles (docs/handoff-perf.md, qa/perfMemory.mjs). So when the page
 * is hidden INTO that cache (`pagehide` with `persisted`) while the game itself is leaving it
 * (`navigateWithVeil`: Menu, Next isle, Daily), the battle lets go of the GPU context and closes
 * its decoded images; if the page is ever shown from the cache again it reloads — the run was
 * left through the menu (its result already recorded), so a fresh load is what Back should show.
 * Anything else is untouched: a normal unload (the browser frees it all anyway), the browser's
 * own Back button, and above all an app sent to the background (it must resume its battle).
 */
export function releaseOnPageCache(app: Application, sources: () => Iterable<TextureSource>): () => void {
  let released = false;
  const onHide = (e: PageTransitionEvent): void => {
    if (!e.persisted || !isLeavingPage() || released) return;
    released = true;
    app.ticker.stop();
    const all = new Set<TextureSource>(sources());
    const managed = (app.renderer as unknown as { texture?: { managedTextures?: readonly (TextureSource | null)[] } }).texture?.managedTextures ?? [];
    for (const s of managed) if (s) all.add(s);
    let bitmaps = 0;
    for (const s of all) {
      const r = s.resource as unknown;
      if (typeof ImageBitmap !== 'undefined' && r instanceof ImageBitmap) {
        r.close();
        bitmaps++;
      }
    }
    const gl = (app.renderer as unknown as { gl?: WebGLRenderingContext }).gl;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    const release: PageCacheRelease = { textures: all.size, bitmaps, contextLost: gl?.isContextLost() ?? false };
    (window as unknown as { __pageCacheRelease?: PageCacheRelease }).__pageCacheRelease = release;
  };
  const onShow = (e: PageTransitionEvent): void => {
    if (e.persisted && released) location.reload();
  };
  window.addEventListener('pagehide', onHide);
  window.addEventListener('pageshow', onShow);
  return () => {
    window.removeEventListener('pagehide', onHide);
    window.removeEventListener('pageshow', onShow);
  };
}
