// Owner feedback 2026-11-18 QA shots, against `vite preview` (default port 4317):
//  - play:    l1c, i05, i12, i16 in wave 1 at 1920x1080 (DPR 1, 2), 2560x1440, phone 844x390 (DPR 3),
//             full frame + a native-pixel crop of every cave and the castle (with the render
//             resolution / tier / canvas / map texture logged per shot),
//  - banner:  the wave banner at 844x390, 1600x900, 1920x1080, 2560x1080 in EN and TR, with the
//             measured offset between the lettering's centre and the red cloth's centre,
//  - hud / settings: the top-right row, the Paused plate with its Settings plank, and the Settings
//             overlay over a run (EN + TR, desktop + phone).
// Writes JPEGs to docs/fb-shots/ and prints a summary.
// Usage: node qa/fbshots.mjs [play|banner|hud|all] [--base=http://127.0.0.1:4317] [--out=docs/fb-shots]
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4317';
const OUT = arg('out') ?? 'docs/fb-shots';
const what = process.argv.slice(2).find((a) => !a.startsWith('--')) ?? 'all';
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });

async function open(size, query) {
  const ctx = await browser.newContext({
    viewport: { width: size.w, height: size.h },
    deviceScaleFactor: size.dpr,
    isMobile: !!size.touch,
    hasTouch: !!size.touch,
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/2d.html?${query}`);
  await page.waitForFunction(() => !!window.__p0?.state, null, { timeout: 90000 });
  await page.waitForTimeout(400);
  return { ctx, page };
}
const state = (page) => page.evaluate(() => window.__p0.state());

if (what === 'play' || what === 'all') {
  const SIZES = [
    { key: '1920x1080-dpr1', w: 1920, h: 1080, dpr: 1 },
    { key: '1920x1080-dpr2', w: 1920, h: 1080, dpr: 2 },
    { key: '2560x1440-dpr1', w: 2560, h: 1440, dpr: 1 },
    { key: 'phone-844x390-dpr3', w: 844, h: 390, dpr: 3, touch: true },
  ];
  for (const id of ['l1c', 'i05', 'i12', 'i16']) {
    const L = JSON.parse(readFileSync(`src/data/levels2d/${id}.json`, 'utf8'));
    const gates = [...L.entrances.map((e) => ['cave-' + e.id, e.gate.front]), ['castle', L.goalGate.front]];
    for (const s of SIZES) {
      const { ctx, page } = await open(s, `level=${id}&lang=en`);
      await page.evaluate(() => window.__p0.skipToWave?.(1));
      await page.waitForTimeout(3500);
      const st = await state(page);
      const r = st.render;
      console.log(
        `${id} ${s.key}: tier=${st.quality} res=${r.resolution.toFixed(2)} canvas=${r.canvasPx.join('x')} ` +
          `map=${st.mapInfo.texturePx.join('x')} (${st.mapInfo.texelScale.toFixed(2)} texel/px, need ${(st.fit.scale * r.resolution).toFixed(2)}) wave=${st.waveState}`,
      );
      await page.screenshot({ path: `${OUT}/play-${id}-${s.key}.jpg`, type: 'jpeg', quality: 82 });
      if (s.key !== '1920x1080-dpr2' && s.key !== 'phone-844x390-dpr3') {
        await ctx.close();
        continue;
      }
      // native-pixel crops of each gate
      for (const [name, f] of gates) {
        if (!f) continue;
        const [x, y, w, h] = f.rect;
        const pad = Math.max(w, h) * 0.3;
        const clip = {
          x: Math.max(0, st.fit.offsetX + (x - pad) * st.fit.scale),
          y: Math.max(0, st.fit.offsetY + (y - pad) * st.fit.scale),
          width: (w + 2 * pad) * st.fit.scale,
          height: (h + 2 * pad) * st.fit.scale,
        };
        clip.width = Math.min(clip.width, s.w - clip.x);
        clip.height = Math.min(clip.height, s.h - clip.y);
        if (clip.width > 8 && clip.height > 8) await page.screenshot({ path: `${OUT}/gate-${id}-${name}-${s.key}.jpg`, type: 'jpeg', quality: 88, clip });
      }
      await ctx.close();
    }
  }
}

if (what === 'banner' || what === 'all') {
  const SIZES = [
    { key: '844x390', w: 844, h: 390, dpr: 2, touch: true },
    { key: '1600x900', w: 1600, h: 900, dpr: 1 },
    { key: '1920x1080', w: 1920, h: 1080, dpr: 1 },
    { key: '2560x1080', w: 2560, h: 1080, dpr: 1 },
  ];
  for (const lang of ['en', 'tr']) {
    for (const s of SIZES) {
      const { ctx, page } = await open(s, `level=l1c&lang=${lang}`);
      const st = await state(page);
      const b = st.hud.banner;
      const clip = { x: b.x - 6, y: b.y - 6, width: b.w + 12, height: b.h + 12 };
      const path = `${OUT}/banner-${lang}-${s.key}.png`;
      await page.screenshot({ path, clip });
      // measure: cream lettering rows vs the red cloth rows (middle 40% of the columns)
      const m = await page.evaluate(async ({ src }) => {
        const img = new Image();
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        const x0 = Math.round(c.width * 0.3);
        const x1 = Math.round(c.width * 0.7);
        const red = [];
        const cream = [];
        for (let y = 0; y < c.height; y++) {
          let r = 0;
          let k = 0;
          for (let x = x0; x < x1; x++) {
            const i = (y * c.width + x) * 4;
            const [R, G, B] = [d[i], d[i + 1], d[i + 2]];
            if (R > 110 && G < 90 && B < 90 && R > G * 1.8) r++;
            if (R > 225 && G > 205 && B > 160) k++;
          }
          if (r > (x1 - x0) * 0.4) red.push(y);
          if (k > 2) cream.push(y);
        }
        const mid = (a) => (a.length ? (a[0] + a[a.length - 1]) / 2 : NaN);
        return { cloth: [red[0], red[red.length - 1]], text: [cream[0], cream[cream.length - 1]], clothMid: mid(red), textMid: mid(cream), h: c.height };
      }, { src: `data:image/png;base64,${readFileSync(path).toString('base64')}` });
      // the cloth band includes the ragged hem; its solid body ends ~86% down the art
      console.log(
        `banner ${lang} ${s.key}: "${await page.evaluate(() => window.__p0.hudWave())}" banner ${Math.round(b.w)}x${Math.round(b.h)} ` +
          `cloth rows ${m.cloth.join('-')} text rows ${m.text.join('-')} -> text centre ${(m.textMid - m.clothMid).toFixed(1)} px from cloth centre`,
      );
      await ctx.close();
    }
  }
}

if (what === 'hud' || what === 'all') {
  const SIZES = [
    { key: '1920x1080', w: 1920, h: 1080, dpr: 1 },
    { key: 'phone-844x390', w: 844, h: 390, dpr: 3, touch: true },
  ];
  for (const lang of ['en', 'tr']) {
    for (const s of SIZES) {
      const { ctx, page } = await open(s, `level=l1c&lang=${lang}`);
      const st = await state(page);
      const top = { x: s.w * 0.55, y: 0, width: s.w * 0.45, height: Math.min(s.h, st.buttons.pause.y * 2.6) };
      await page.screenshot({ path: `${OUT}/hud-${lang}-${s.key}.jpg`, type: 'jpeg', quality: 88, clip: top });
      // pause → plate + Settings plank
      const tapAt = async (p) => (s.touch ? page.touchscreen.tap(p.x, p.y) : page.mouse.click(p.x, p.y));
      await tapAt(st.buttons.pause);
      await page.waitForTimeout(400);
      const plank = await page.locator('[data-testid="pause2d-settings"]').boundingBox();
      console.log(`hud ${lang} ${s.key}: settings button ${JSON.stringify(await page.locator('[data-testid="settings2d-open"]').boundingBox())} pause plank ${JSON.stringify(plank)}`);
      await page.screenshot({ path: `${OUT}/paused-${lang}-${s.key}.jpg`, type: 'jpeg', quality: 85 });
      // open Settings from the plank, check the run stays paused, close, check it is still paused (player paused it)
      await page.locator('[data-testid="pause2d-settings"]').click();
      await page.waitForSelector('[data-testid="settings2d"]');
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${OUT}/settings-${lang}-${s.key}.jpg`, type: 'jpeg', quality: 85 });
      const pausedOpen = (await state(page)).paused;
      await page.locator('[data-testid="settings2d-close"]').click();
      await page.waitForTimeout(200);
      const pausedAfter = (await state(page)).paused;
      // unpause, open from the HUD button: pauses while open, resumes after
      await tapAt(st.buttons.pause);
      await page.waitForTimeout(200);
      await page.locator('[data-testid="settings2d-open"]').click();
      await page.waitForSelector('[data-testid="settings2d"]');
      const pausedBtn = (await state(page)).paused;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
      const resumed = !(await state(page)).paused;
      console.log(`  settings: paused while open (from plank)=${pausedOpen}, still paused after close=${pausedAfter}, paused while open (from button)=${pausedBtn}, resumed after=${resumed}`);
      await ctx.close();
    }
  }
}
await browser.close();
