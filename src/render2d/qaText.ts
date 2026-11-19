/**
 * QA (`window.__p0.textAudit()`): canvas lettering measured against the painted box it belongs to
 * (the DOM UI has qa/uiAuditLib.mjs). Each piece lists its visible texts with the box they must sit
 * in — the wave banner's cloth, the plaque's number slots, the horn's piece, the end board's
 * parchment or ribbon, the ring tooltip's parchment — and the screen. A text breaks the rule when
 * its drawn bounds come closer than `gap` to the box's edge or leave the screen.
 */
import type { Container } from 'pixi.js';
import type { Rect } from './uiLayout.ts';

export interface QaTextItem {
  readonly name: string;
  readonly text: Container & { readonly text: string; readonly visible: boolean };
  readonly box: Rect;
  /** Minimum gap to the box's edges (px); default 2. */
  readonly gap?: number;
}

export interface QaTextProblem {
  readonly kind: 'canvas';
  readonly name: string;
  readonly text: string;
  readonly detail: string;
}

function shown(o: Container | null): boolean {
  for (let n: Container | null = o; n; n = n.parent) if (!n.visible || n.alpha <= 0.02) return false;
  return true;
}

export function auditCanvasTexts(items: readonly QaTextItem[], screenW: number, screenH: number): QaTextProblem[] {
  const out: QaTextProblem[] = [];
  for (const it of items) {
    const label = String(it.text.text ?? '').trim();
    if (!label || !shown(it.text)) continue;
    const b = it.text.getBounds();
    const g = it.gap ?? 2;
    const d = {
      left: b.x - it.box.x,
      right: it.box.x + it.box.w - (b.x + b.width),
      top: b.y - it.box.y,
      bottom: it.box.y + it.box.h - (b.y + b.height),
    };
    const bad = Object.entries(d).filter(([, v]) => v < g);
    if (bad.length) out.push({ kind: 'canvas', name: it.name, text: label, detail: `outside its box by ${bad.map(([k, v]) => `${k} ${v.toFixed(1)}`).join(', ')} (min gap ${g})` });
    if (b.x < -1 || b.y < -1 || b.x + b.width > screenW + 1 || b.y + b.height > screenH + 1) out.push({ kind: 'canvas', name: it.name, text: label, detail: 'off the screen' });
  }
  return out;
}
