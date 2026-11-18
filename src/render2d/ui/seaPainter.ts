/**
 * Placeholder painted sea for the world map, drawn once per size on a canvas: layered teal washes,
 * soft brush dabs, little wave crests, an edge vignette and a compass rose. Seeded, so it looks the
 * same every visit. To be replaced by a painted sea chart (docs/p3-art-needs.md).
 */
import { t } from '../../i18n/index.ts';

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

export function paintSea(canvas: HTMLCanvasElement, w: number, h: number, dpr: number): void {
  // Keep the backing store reasonable on wide scrolling maps.
  const k = Math.max(0.5, Math.min(dpr, 4096 / Math.max(1, w), 2));
  canvas.width = Math.round(w * k);
  canvas.height = Math.round(h * k);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const g = canvas.getContext('2d');
  if (!g) return;
  g.setTransform(k, 0, 0, k, 0, 0);
  const r = rng(0x5ea + Math.round(w) * 7 + Math.round(h));

  const base = g.createLinearGradient(0, 0, 0, h);
  base.addColorStop(0, '#1d5b78');
  base.addColorStop(0.45, '#2c829d');
  base.addColorStop(1, '#3596a9');
  g.fillStyle = base;
  g.fillRect(0, 0, w, h);

  // Big soft light / shade washes.
  for (let i = 0; i < Math.max(4, w / 260); i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = (0.25 + r() * 0.35) * Math.max(h, 300);
    const light = r() < 0.55;
    const grd = g.createRadialGradient(x, y, 0, x, y, rad);
    grd.addColorStop(0, light ? 'rgba(120, 205, 210, 0.28)' : 'rgba(10, 50, 75, 0.25)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grd;
    g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  // Brush dabs: short, flat, slightly tilted strokes.
  const dabs = Math.round((w * h) / 2600);
  const tones = ['rgba(150, 220, 222, 0.10)', 'rgba(20, 70, 100, 0.12)', 'rgba(90, 175, 190, 0.12)', 'rgba(230, 245, 230, 0.06)'];
  for (let i = 0; i < dabs; i++) {
    const x = r() * w;
    const y = r() * h;
    g.save();
    g.translate(x, y);
    g.rotate((r() - 0.5) * 0.35);
    g.fillStyle = tones[(r() * tones.length) | 0];
    g.beginPath();
    g.ellipse(0, 0, 14 + r() * 36, 2.5 + r() * 5, 0, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // Wave crests: little cream double arcs.
  const crests = Math.round((w * h) / 24000);
  g.lineCap = 'round';
  for (let i = 0; i < crests; i++) {
    const x = r() * w;
    const y = r() * h;
    const s = 6 + r() * 7;
    g.strokeStyle = `rgba(240, 250, 235, ${0.22 + r() * 0.25})`;
    g.lineWidth = 1.6 + r() * 1.2;
    g.beginPath();
    g.arc(x - s, y, s, Math.PI * 1.1, Math.PI * 1.9);
    g.arc(x + s * 0.9, y, s, Math.PI * 1.1, Math.PI * 1.9);
    g.stroke();
  }

  // Edge vignette (old chart feel).
  const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(8, 30, 45, 0.45)');
  g.fillStyle = vg;
  g.fillRect(0, 0, w, h);

  compassRose(g, w - Math.min(110, h * 0.2), h - Math.min(100, h * 0.19), Math.min(70, h * 0.13));
}

function compassRose(g: CanvasRenderingContext2D, cx: number, cy: number, R: number): void {
  g.save();
  g.translate(cx, cy);
  g.globalAlpha = 0.85;
  g.lineJoin = 'round';
  const point = (angle: number, len: number, wid: number, fill: string): void => {
    g.save();
    g.rotate(angle);
    g.beginPath();
    g.moveTo(0, -len);
    g.lineTo(wid, 0);
    g.lineTo(0, wid * 0.6);
    g.lineTo(-wid, 0);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.strokeStyle = '#3a2412';
    g.lineWidth = 2;
    g.stroke();
    g.restore();
  };
  g.beginPath();
  g.arc(0, 0, R * 0.62, 0, Math.PI * 2);
  g.strokeStyle = 'rgba(255, 244, 220, 0.7)';
  g.lineWidth = 2;
  g.stroke();
  for (let i = 0; i < 4; i++) point(Math.PI / 4 + (i * Math.PI) / 2, R * 0.6, R * 0.12, '#e8d6ac');
  for (let i = 0; i < 4; i++) point((i * Math.PI) / 2, R, R * 0.17, i === 0 ? '#c8341f' : '#fff4dc');
  g.beginPath();
  g.arc(0, 0, R * 0.09, 0, Math.PI * 2);
  g.fillStyle = '#f2b33d';
  g.fill();
  g.stroke();
  g.font = `700 ${Math.round(R * 0.3)}px "Fredoka Variable", sans-serif`;
  g.textAlign = 'center';
  g.fillStyle = '#fff4dc';
  g.strokeStyle = '#3a2412';
  g.lineWidth = 3;
  const north = t('map.compassN');
  g.strokeText(north, 0, -R - 6);
  g.fillText(north, 0, -R - 6);
  g.restore();
}
