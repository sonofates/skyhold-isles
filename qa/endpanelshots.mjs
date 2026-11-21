// End board QA (task 2026-11-21 endpanel-fix): every board variant (victory ± hero row ± crystals,
// defeat, mode notes) at desktop / MacBook / phone / narrow phone / portrait, TR + EN. Fails when a
// board text (stats row, caption, star rule, hero row) overlaps a button circle or label.
// Works against the vite dev server or a preview:
//   node qa/endpanelshots.mjs --base=http://127.0.0.1:4427 [--out=qa-output/endpanel] [--shots=1] [--only=phone]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4427';
const OUT = arg('out') ?? 'qa-output/endpanel';
const SHOTS = arg('shots') === '1';
const ONLY = arg('only')?.split(',');
const LANGS = (arg('langs') ?? 'tr,en').split(',');
mkdirSync(OUT, { recursive: true });
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const SIZES = {
  desk: { w: 1440, h: 900 },
  mac: { w: 1280, h: 800 },
  phone: { w: 844, h: 390, touch: true },
  narrow: { w: 667, h: 375, touch: true },
  portrait: { w: 390, h: 844, touch: true },
};
const NOTE_CHALLENGE = { caption: 'Challenge badge earned: Iron Will · Swift Hands · No Hero needed', reward: true };
const NOTE_ENDLESS = { title: 'Endless Run', line1: 'Wave 27', caption: 'New best: wave 27 · Silver medal', victoryBoard: true, reward: true };
const VARIANTS = {
  crystals: { q: 'end=won&crystals=42' },
  plain: { q: 'end=won' },
  hero: { q: 'hero=bran&end=won&crystals=42' },
  heroPlain: { q: 'hero=bran&end=won' },
  lost: { q: 'end=lost' },
  note: { q: 'end=won&crystals=42', note: NOTE_CHALLENGE },
  endless: { q: 'end=lost', note: NOTE_ENDLESS },
};
const log = (...a) => console.log(...a);
let fails = 0;
const fail = (m) => {
  fails++;
  log('FAIL', m);
};

/** Rect vs circle overlap (with `pad` px of clearance demanded). */
const hitsCircle = (b, c, pad) => {
  const nx = Math.max(b.x, Math.min(c.x, b.x + b.w));
  const ny = Math.max(b.y, Math.min(c.y, b.y + b.h));
  return (nx - c.x) ** 2 + (ny - c.y) ** 2 < (c.r + pad) ** 2;
};
const hitsRect = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

const rows = [];
for (const [sk, s] of Object.entries(SIZES)) {
  if (ONLY && !ONLY.includes(sk)) continue;
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1, isMobile: !!s.touch, hasTouch: !!s.touch });
  for (const lang of LANGS) {
    for (const [vk, v] of Object.entries(VARIANTS)) {
      const page = await ctx.newPage();
      page.on('pageerror', (e) => log('pageerror', e.message));
      await page.goto(`${BASE}/2d.html?level=l1c&lang=${lang}&${v.q}`);
      await page.waitForFunction(() => !!window.__p0?.state?.()?.end, null, { timeout: 120000 });
      await page.waitForTimeout(1200);
      if (v.note) await page.evaluate((n) => window.__p0.endAnnotate?.(n), v.note);
      await page.waitForTimeout(2200);
      const end = await page.evaluate(() => window.__p0.state().end);
      const boxes = end.boxes ?? [];
      const texts = boxes.filter((b) => !b.name.startsWith('label:'));
      const labels = boxes.filter((b) => b.name.startsWith('label:'));
      const btnTop = Math.min(...end.buttons.map((b) => b.y - b.r));
      const textBottom = Math.max(...texts.map((b) => b.y + b.h));
      const bad = [];
      for (const t of texts) {
        for (const c of end.buttons) if (hitsCircle(t, c, 0)) bad.push(`${t.name}×btn:${c.action}`);
        for (const l of labels) if (hitsRect(t, l)) bad.push(`${t.name}×${l.name}`);
      }
      const rule = texts.some((b) => b.name === 'rule');
      const lowest = labels.length ? Math.max(...labels.map((l) => l.y + l.h)) : 0;
      const P = end.panel;
      const row = { size: sk, lang, variant: vk, rule, clear: +(btnTop - textBottom).toFixed(1), labelBottomFrac: +((lowest - P.y) / P.h).toFixed(3), bad: bad.join(' ') };
      rows.push(row);
      log(JSON.stringify(row));
      if (arg('verbose') === '1') log('  boxes', JSON.stringify(boxes.map((b) => [b.name, +b.h.toFixed(1)])));
      if (!boxes.length) fail(`${sk}/${lang}/${vk}: no text boxes (old build?)`);
      if (bad.length) fail(`${sk}/${lang}/${vk}: overlaps ${row.bad}`);
      if (row.labelBottomFrac > 0.95) fail(`${sk}/${lang}/${vk}: labels off the parchment (${row.labelBottomFrac})`);
      const audit = await page.evaluate(() => window.__p0.textAudit?.() ?? []);
      const endAudit = audit.filter((p) => String(p.name ?? '').startsWith('end.'));
      if (endAudit.length) fail(`${sk}/${lang}/${vk}: textAudit ${JSON.stringify(endAudit).slice(0, 300)}`);
      if (SHOTS) await page.screenshot({ path: `${OUT}/${sk}-${lang}-${vk}.png`, clip: { x: P.x - 8, y: P.y - 8, width: P.w + 16, height: P.h + 16 }, timeout: 120000 });
      await page.close();
    }
  }
  await ctx.close();
}

await browser.close();
log(`hidden rule on: ${rows.filter((r) => !r.rule && ['crystals', 'plain', 'hero', 'heroPlain'].includes(r.variant)).map((r) => `${r.size}/${r.lang}/${r.variant}`).join(', ') || 'none'}`);
log(fails ? `${fails} FAIL` : 'all ok');
process.exit(fails ? 1 : 0);
