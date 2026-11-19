// Font probe: which Fredoka faces the page has, their status, and whether Turkish letters are drawn
// with Fredoka (canvas width under two different fallbacks must match).
// Usage: node qa/fontprobe.mjs [--base=..] [--lang=tr]
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const lang = arg('lang') ?? 'tr';
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const reqs = [];
page.on('request', (r) => {
  if (/woff2?/.test(r.url())) reqs.push(r.url().replace(BASE, ''));
});
await page.goto(`${BASE}/2d.html?lang=${lang}&screen=brief&island=0`);
await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 60000 });
await page.waitForTimeout(1500);
const r = await page.evaluate(async () => {
  const faces = [];
  document.fonts.forEach((f) => faces.push({ family: f.family, weight: f.weight, range: f.unicodeRange.slice(0, 30), status: f.status }));
  const cv = document.createElement('canvas').getContext('2d');
  const w = (ch, fb, wt) => {
    cv.font = `${wt} 48px "Fredoka Variable", ${fb}`;
    return cv.measureText(ch).width;
  };
  const glyphs = {};
  for (const ch of 'Aşğıİçöü') glyphs[ch] = [700, 600, 400].map((wt) => [w(ch, 'monospace', wt).toFixed(2), w(ch, 'serif', wt).toFixed(2)].join('/')).join(' ');
  const check = { ş700: document.fonts.check('700 20px "Fredoka Variable"', 'ş'), ş600: document.fonts.check('600 20px "Fredoka Variable"', 'ş') };
  return { faces, glyphs, check };
});
console.log(JSON.stringify({ reqs, ...r }, null, 1));
// A specimen: the Turkish letters next to Fredoka's own accented ones, at the UI's weights.
const shot = arg('shot');
if (shot) {
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.style.cssText = 'position:fixed;inset:0;z-index:999;background:#f6e7c4;color:#4a2a12;padding:24px;font-family:"Fredoka Variable","Fredoka TR",sans-serif;font-size:64px;line-height:1.25';
    d.innerHTML = [700, 600, 500, 400].map((w) => `<div style="font-weight:${w}">${w} şŞğĞİ çÇüÜöÖ Demirmeşe Şövalye Ağaç İpuçları</div>`).join('') +
      '<div style="font-weight:700;font-family:sans-serif">fallback: şŞğĞİ Demirmeşe</div>';
    document.body.append(d);
  });
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot });
}
await browser.close();
