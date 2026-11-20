// "Feat earned" toasts: a fresh save wins its first island (First Landing, Starcatcher…) and the
// cards are shot over the victory board (EN / TR).
// Usage: node qa/featshot.mjs [--base=..] [--out=/tmp/n2opus-feat] [--size=2000x991] [--touch=1]
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const OUT = arg('out') ?? '/tmp/n2opus-feat';
const SIZE = arg('size') ?? '2000x991';
const [W, H] = SIZE.split('x').map(Number);
const touch = arg('touch') === '1';
mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
let bad = 0;
for (const lang of ['en', 'tr']) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: touch ? 2 : 1, hasTouch: touch, isMobile: touch });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('qa-seeded')) return;
    sessionStorage.setItem('qa-seeded', '1');
    localStorage.clear();
    localStorage.setItem('skyhold_isles_coach2d_v1', '1');
    localStorage.setItem('skyhold2d_coach_v1', 'done');
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(90000);
  await page.goto(`${BASE}/2d.html?level=l1c&hero=bran&lang=${lang}${touch ? '' : '&desktop=1'}`);
  await page.waitForFunction(() => window.__p0?.state && !document.getElementById('boot'));
  await page.waitForTimeout(800);
  await page.evaluate(() => window.__p0.forceEnd('won'));
  await page.waitForFunction(() => !!window.__p0.state().end);
  await page.locator('[data-testid="story2d-skip"]').click({ timeout: 3000 }).catch(() => undefined);
  const got = await page.waitForSelector('[data-testid^="feat2d-toast-"]', { timeout: 20000 }).then(() => true).catch(() => false);
  await page.waitForTimeout(1600);
  const info = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.pu-feat-toast')];
    const board = window.__p0.state().end;
    return { cards: cards.map((c) => ({ id: c.dataset.testid, text: c.innerText.replace(/\s+/g, ' '), bottom: Math.round(c.getBoundingClientRect().bottom) })), boardTop: board?.panel?.y ?? null };
  });
  console.log(lang, SIZE, got ? 'toasts' : 'NO TOAST', JSON.stringify(info));
  if (!got) bad++;
  await page.screenshot({ path: `${OUT}/${lang}-${SIZE}-feats.jpg`, type: 'jpeg', quality: 85, timeout: 120000 });
  await ctx.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
