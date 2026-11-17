/**
 * Optional art provider for the Codex screen. The 3D game never registers one, so its codex keeps
 * the built-in SVG icons; the 2D entry (2d.html) registers a resolver that returns the painted
 * front sprite of an enemy / tower and the codex then shows an <img> instead of the icon.
 */
export type CodexArtKind = 'enemy' | 'tower';

/** Returns an image URL for the entry, or null to keep the SVG icon. */
export type CodexArtResolver = (kind: CodexArtKind, id: string) => string | null;

let resolver: CodexArtResolver | null = null;

export function setCodexArtResolver(fn: CodexArtResolver | null): void {
  resolver = fn;
}

/** `<img>` markup for an entry's painted art, or null when no resolver / no art. */
export function codexArtHtml(kind: CodexArtKind, id: string): string | null {
  const url = resolver?.(kind, id) ?? null;
  if (!url) return null;
  return `<img class="cx-art" src="${url.replace(/"/g, '%22')}" alt="" draggable="false">`;
}
