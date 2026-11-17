import { Texture } from 'pixi.js';

/**
 * Small baked textures for shadows, FX and projectiles (drawn once on a 2D canvas, then batched
 * like any sprite). Painted look: soft edges, warm colours, dark outlines on solid pieces.
 */
export interface ProcTextures {
  readonly shadow: Texture;
  readonly puff: Texture;
  readonly ring: Texture;
  readonly spark: Texture;
  readonly arrow: Texture;
  readonly ball: Texture;
  readonly glow: Texture;
  readonly white: Texture;
  readonly rangeDisc: Texture;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  return [c, ctx];
}

function radial(size: number, stops: ReadonlyArray<[number, string]>): HTMLCanvasElement {
  const [c, ctx] = canvas(size, size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) g.addColorStop(o, col);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export function createProcTextures(): ProcTextures {
  const shadow = radial(128, [
    [0, 'rgba(38,26,14,0.55)'],
    [0.55, 'rgba(38,26,14,0.38)'],
    [1, 'rgba(38,26,14,0)'],
  ]);
  const puff = radial(64, [
    [0, 'rgba(255,250,235,1)'],
    [0.5, 'rgba(255,244,214,0.85)'],
    [1, 'rgba(255,240,200,0)'],
  ]);
  const glow = radial(64, [
    [0, 'rgba(235,252,255,1)'],
    [0.35, 'rgba(140,210,255,0.9)'],
    [1, 'rgba(60,120,255,0)'],
  ]);
  const spark = radial(32, [
    [0, 'rgba(255,255,255,1)'],
    [0.4, 'rgba(255,236,160,0.9)'],
    [1, 'rgba(255,200,80,0)'],
  ]);

  const [ringC, rctx] = canvas(128, 128);
  rctx.strokeStyle = 'rgba(255,224,150,1)';
  rctx.lineWidth = 10;
  rctx.beginPath();
  rctx.arc(64, 64, 56, 0, Math.PI * 2);
  rctx.stroke();
  rctx.strokeStyle = 'rgba(255,255,240,0.8)';
  rctx.lineWidth = 3;
  rctx.beginPath();
  rctx.arc(64, 64, 52, 0, Math.PI * 2);
  rctx.stroke();

  const [arrowC, actx] = canvas(64, 12);
  actx.fillStyle = '#3a2412';
  actx.fillRect(4, 4, 50, 4);
  actx.fillStyle = '#8a5a2a';
  actx.fillRect(5, 5, 48, 2);
  actx.fillStyle = '#e8e2d0';
  actx.beginPath();
  actx.moveTo(64, 6);
  actx.lineTo(52, 0);
  actx.lineTo(52, 12);
  actx.closePath();
  actx.fill();
  actx.fillStyle = '#c0392b';
  actx.fillRect(0, 2, 8, 3);
  actx.fillRect(0, 7, 8, 3);

  const [ballC, bctx] = canvas(32, 32);
  bctx.fillStyle = '#1a1a1a';
  bctx.beginPath();
  bctx.arc(16, 16, 14, 0, Math.PI * 2);
  bctx.fill();
  bctx.fillStyle = '#4a4a4a';
  bctx.beginPath();
  bctx.arc(16, 16, 11, 0, Math.PI * 2);
  bctx.fill();
  bctx.fillStyle = 'rgba(255,255,255,0.6)';
  bctx.beginPath();
  bctx.arc(11, 11, 4, 0, Math.PI * 2);
  bctx.fill();

  const [discC, dctx] = canvas(256, 256);
  dctx.fillStyle = 'rgba(255,240,190,0.16)';
  dctx.strokeStyle = 'rgba(255,244,210,0.85)';
  dctx.lineWidth = 5;
  dctx.setLineDash([18, 10]);
  dctx.beginPath();
  dctx.arc(128, 128, 124, 0, Math.PI * 2);
  dctx.fill();
  dctx.stroke();

  return {
    shadow: Texture.from(shadow),
    puff: Texture.from(puff),
    ring: Texture.from(ringC),
    spark: Texture.from(spark),
    arrow: Texture.from(arrowC),
    ball: Texture.from(ballC),
    glow: Texture.from(glow),
    white: Texture.WHITE,
    rangeDisc: Texture.from(discC),
  };
}
