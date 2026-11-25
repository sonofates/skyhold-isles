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
  /** White ring (tint it: wards, pulses, elite rings). */
  readonly wring: Texture;
  /** Soft neutral white orb (tint it; additive glows). */
  readonly orb: Texture;
  /** Scorched / cratered ground blob. */
  readonly crater: Texture;
  /** Light crystal / rock shard, pointing up (tint it: ice, dirt chunks, barrier fragments). */
  readonly shard: Texture;
  /** Warden barrier bubble: transparent body, bright rim and a highlight. */
  readonly bubble: Texture;
  /** Golem cracked-shell overlay. */
  readonly crack: Texture;
  /** Elite crown pip. */
  readonly crown: Texture;
  /** Jammed-tower marker (magenta ring + bolt). */
  readonly jam: Texture;
  /** Burrower dirt mound (used until enemy-burrower-mound.png lands). */
  readonly mound: Texture;
  /** Heavy ballista bolt. */
  readonly bolt: Texture;
  /** Buffed-tower sparkle (small four-point star). */
  readonly star: Texture;
  /** Frosted-tower marker (ice-blue disc with a white six-arm snowflake). */
  readonly ice: Texture;
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

  const orb = radial(64, [
    [0, 'rgba(255,255,255,1)'],
    [0.4, 'rgba(255,255,255,0.7)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
  const crater = radial(128, [
    [0, 'rgba(52,32,16,0.78)'],
    [0.55, 'rgba(66,42,22,0.6)'],
    [0.82, 'rgba(90,60,34,0.3)'],
    [1, 'rgba(90,60,34,0)'],
  ]);

  const [wringC, wc] = canvas(128, 128);
  wc.strokeStyle = 'rgba(255,255,255,0.35)';
  wc.lineWidth = 16;
  wc.beginPath();
  wc.arc(64, 64, 54, 0, Math.PI * 2);
  wc.stroke();
  wc.strokeStyle = 'rgba(255,255,255,1)';
  wc.lineWidth = 7;
  wc.beginPath();
  wc.arc(64, 64, 55, 0, Math.PI * 2);
  wc.stroke();

  const [shardC, sc] = canvas(32, 56);
  const sg = sc.createLinearGradient(0, 0, 32, 56);
  sg.addColorStop(0, '#ffffff');
  sg.addColorStop(0.55, '#dcecf8');
  sg.addColorStop(1, '#a9c4dc');
  sc.fillStyle = sg;
  sc.strokeStyle = 'rgba(60,72,92,0.95)';
  sc.lineWidth = 3;
  sc.lineJoin = 'round';
  sc.beginPath();
  sc.moveTo(16, 2);
  sc.lineTo(29, 22);
  sc.lineTo(23, 54);
  sc.lineTo(9, 54);
  sc.lineTo(3, 22);
  sc.closePath();
  sc.fill();
  sc.stroke();
  sc.strokeStyle = 'rgba(255,255,255,0.85)';
  sc.lineWidth = 2;
  sc.beginPath();
  sc.moveTo(14, 8);
  sc.lineTo(8, 24);
  sc.stroke();

  const [bubbleC, bc] = canvas(128, 128);
  const bg = bc.createRadialGradient(64, 64, 0, 64, 64, 62);
  bg.addColorStop(0, 'rgba(170,220,255,0.05)');
  bg.addColorStop(0.68, 'rgba(160,215,255,0.2)');
  bg.addColorStop(0.9, 'rgba(215,243,255,0.62)');
  bg.addColorStop(0.965, 'rgba(255,255,255,0.95)');
  bg.addColorStop(1, 'rgba(200,235,255,0)');
  bc.fillStyle = bg;
  bc.fillRect(0, 0, 128, 128);
  bc.strokeStyle = 'rgba(255,255,255,0.85)';
  bc.lineWidth = 5;
  bc.lineCap = 'round';
  bc.beginPath();
  bc.arc(64, 64, 46, Math.PI * 1.1, Math.PI * 1.45);
  bc.stroke();
  bc.lineWidth = 3;
  bc.beginPath();
  bc.arc(64, 64, 46, Math.PI * 1.52, Math.PI * 1.58);
  bc.stroke();

  const [crackC, cc] = canvas(128, 128);
  cc.lineCap = 'round';
  cc.lineJoin = 'round';
  const cracks: number[][] = [
    [64, 64, 52, 46, 44, 30, 30, 22, 24, 8],
    [64, 64, 78, 50, 86, 36, 100, 30, 108, 14],
    [64, 64, 50, 80, 36, 88, 26, 104],
    [64, 64, 80, 82, 92, 96, 104, 100, 112, 116],
    [78, 50, 92, 56, 106, 52],
    [44, 30, 56, 20, 60, 8],
  ];
  for (const [w, col] of [
    [7, 'rgba(30,50,80,0.8)'],
    [4, 'rgba(150,215,245,1)'],
    [1.6, 'rgba(255,255,255,1)'],
  ] as const) {
    cc.strokeStyle = col;
    cc.lineWidth = w;
    for (const c of cracks) {
      cc.beginPath();
      cc.moveTo(c[0], c[1]);
      for (let i = 2; i < c.length; i += 2) cc.lineTo(c[i], c[i + 1]);
      cc.stroke();
    }
  }

  const [crownC, kc] = canvas(48, 36);
  kc.fillStyle = '#f6bd41';
  kc.strokeStyle = '#4a2c10';
  kc.lineWidth = 3;
  kc.lineJoin = 'round';
  kc.beginPath();
  kc.moveTo(5, 30);
  kc.lineTo(3, 10);
  kc.lineTo(14, 20);
  kc.lineTo(24, 4);
  kc.lineTo(34, 20);
  kc.lineTo(45, 10);
  kc.lineTo(43, 30);
  kc.closePath();
  kc.fill();
  kc.stroke();
  kc.fillStyle = '#e85d5d';
  kc.beginPath();
  kc.arc(24, 22, 3.4, 0, Math.PI * 2);
  kc.fill();
  kc.fillStyle = 'rgba(255,255,255,0.7)';
  kc.fillRect(8, 24, 32, 2);

  const [jamC, jc] = canvas(64, 64);
  jc.strokeStyle = '#3a1048';
  jc.lineWidth = 8;
  jc.beginPath();
  jc.arc(32, 32, 24, 0, Math.PI * 2);
  jc.stroke();
  jc.strokeStyle = '#d45cff';
  jc.lineWidth = 4.5;
  jc.setLineDash([9, 6]);
  jc.beginPath();
  jc.arc(32, 32, 24, 0, Math.PI * 2);
  jc.stroke();
  jc.setLineDash([]);
  jc.fillStyle = '#ffe27a';
  jc.strokeStyle = '#3a1048';
  jc.lineWidth = 2.5;
  jc.lineJoin = 'round';
  jc.beginPath();
  jc.moveTo(36, 12);
  jc.lineTo(24, 34);
  jc.lineTo(31, 34);
  jc.lineTo(27, 52);
  jc.lineTo(41, 28);
  jc.lineTo(33, 28);
  jc.closePath();
  jc.fill();
  jc.stroke();

  const [moundC, mc] = canvas(128, 80);
  mc.lineJoin = 'round';
  mc.fillStyle = 'rgba(40,24,10,0.35)';
  mc.beginPath();
  mc.ellipse(64, 60, 58, 14, 0, 0, Math.PI * 2);
  mc.fill();
  mc.strokeStyle = '#3a2412';
  mc.lineWidth = 4;
  const mg = mc.createLinearGradient(0, 14, 0, 66);
  mg.addColorStop(0, '#b5834f');
  mg.addColorStop(0.6, '#97663a');
  mg.addColorStop(1, '#6f4726');
  mc.fillStyle = mg;
  mc.beginPath();
  mc.moveTo(8, 62);
  mc.bezierCurveTo(10, 40, 26, 30, 36, 24);
  mc.bezierCurveTo(46, 10, 80, 8, 92, 24);
  mc.bezierCurveTo(104, 32, 118, 44, 120, 62);
  mc.bezierCurveTo(90, 72, 36, 72, 8, 62);
  mc.closePath();
  mc.fill();
  mc.stroke();
  mc.fillStyle = 'rgba(214,170,116,0.7)';
  mc.beginPath();
  mc.ellipse(56, 24, 22, 6, -0.15, 0, Math.PI * 2);
  mc.fill();
  mc.fillStyle = '#5b3a1e';
  for (const [x, y, r] of [[30, 50, 5], [52, 58, 4], [88, 52, 6], [104, 58, 3.5], [70, 36, 3.5]] as const) {
    mc.beginPath();
    mc.arc(x, y, r, 0, Math.PI * 2);
    mc.fill();
  }

  const [boltC, btx] = canvas(96, 16);
  btx.fillStyle = '#3a2412';
  btx.fillRect(6, 5, 64, 6);
  btx.fillStyle = '#9a6a34';
  btx.fillRect(7, 6.5, 62, 3);
  btx.fillStyle = '#2a2f38';
  btx.beginPath();
  btx.moveTo(96, 8);
  btx.lineTo(68, 0);
  btx.lineTo(72, 8);
  btx.lineTo(68, 16);
  btx.closePath();
  btx.fill();
  btx.fillStyle = '#cfd6df';
  btx.beginPath();
  btx.moveTo(92, 8);
  btx.lineTo(72, 3);
  btx.lineTo(75, 8);
  btx.closePath();
  btx.fill();
  btx.fillStyle = '#c0392b';
  btx.fillRect(0, 2, 14, 4);
  btx.fillRect(0, 10, 14, 4);

  const [starC, stc] = canvas(32, 32);
  stc.fillStyle = 'rgba(255,255,255,1)';
  stc.beginPath();
  stc.moveTo(16, 0);
  stc.quadraticCurveTo(17.5, 14.5, 32, 16);
  stc.quadraticCurveTo(17.5, 17.5, 16, 32);
  stc.quadraticCurveTo(14.5, 17.5, 0, 16);
  stc.quadraticCurveTo(14.5, 14.5, 16, 0);
  stc.fill();

  const [iceC, ic] = canvas(64, 64);
  ic.fillStyle = '#1d4a6a';
  ic.beginPath();
  ic.arc(32, 32, 27, 0, Math.PI * 2);
  ic.fill();
  ic.fillStyle = '#7cc8ea';
  ic.beginPath();
  ic.arc(32, 32, 23, 0, Math.PI * 2);
  ic.fill();
  ic.strokeStyle = '#ffffff';
  ic.lineCap = 'round';
  ic.lineWidth = 4;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 - Math.PI / 2;
    const cx = Math.cos(a);
    const sy = Math.sin(a);
    ic.beginPath();
    ic.moveTo(32, 32);
    ic.lineTo(32 + cx * 17, 32 + sy * 17);
    ic.stroke();
    // Little barbs two thirds of the way out.
    const bx = 32 + cx * 11;
    const by = 32 + sy * 11;
    for (const side of [-1, 1]) {
      const b = a + side * 0.75;
      ic.beginPath();
      ic.moveTo(bx, by);
      ic.lineTo(bx + Math.cos(b) * 6, by + Math.sin(b) * 6);
      ic.stroke();
    }
  }

  return {
    ice: Texture.from(iceC),
    wring: Texture.from(wringC),
    orb: Texture.from(orb),
    crater: Texture.from(crater),
    shard: Texture.from(shardC),
    bubble: Texture.from(bubbleC),
    crack: Texture.from(crackC),
    crown: Texture.from(crownC),
    jam: Texture.from(jamC),
    mound: Texture.from(moundC),
    bolt: Texture.from(boltC),
    star: Texture.from(starC),
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
