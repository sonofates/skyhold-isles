// Text size check: on each painted screen, every visible text node's rendered font size (css px).
// Reports the smallest sizes and anything under --min (default 10 px) with its element.
// Usage: node qa/textsize.mjs [--base=..] [--size=844x390] [--min=10] [--lang=tr]
import { chromium } from 'playwright';

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const BASE = arg('base') ?? 'http://127.0.0.1:4381';
const MIN = Number(arg('min') ?? 10);
const LANG = arg('lang') ?? 'tr';
const [W, H] = (arg('size') ?? '844x390').split('x').map(Number);
const touch = H < 500;
const IDS = ['l1c', ...Array.from({ length: 24 }, (_, i) => `i${String(i + 1).padStart(2, '0')}`)];
const pad = (a, v) => [...a, ...Array(Math.max(0, 25 - a.length)).fill(v)];
const SEED = JSON.stringify({ ids: IDS, progress: { version: 2, unlockedLevelIndex: 9, bestStars: pad([3, 3, 2, 3, 1, 2, 3, 2, 3], 0), clears: pad([2, 1, 1, 1, 1, 1, 1, 1, 1], 0), heroes: { selectedHero: 'bran', roster: { bran: { xp: 3200, skills: [] } } } } });
const SCREENS = [
  ['map', ''],
  ['brief', '?screen=brief&island=1'],
  ['workshop', '?screen=workshop'],
  ['heroes', '?screen=heroes'],
  ['herosel', '?screen=herosel'],
  ['logbook', '?screen=logbook'],
  ['daily', '?screen=daily'],
  ['settings', '?screen=settings'],
  ['controls', '?screen=settings&settab=controls'],
  ['credits', '?screen=credits'],
  ['title', '?title=1&titlemenu=1'],
  ['hud', '?level=i02&hero=bran'],
];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const small = [];
for (const [name, q] of SCREENS) {
  const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: touch ? 2 : 1, isMobile: touch, hasTouch: touch });
  await ctx.addInitScript(([s, l]) => {
    if (sessionStorage.getItem('qa-seeded')) return;
    sessionStorage.setItem('qa-seeded', '1');
    localStorage.clear();
    localStorage.setItem('skyhold_isles_language_v1', l);
    localStorage.setItem('skyhold_isles_settings_v1', JSON.stringify({ language: l }));
    localStorage.setItem('skyhold_isles_progress2d_v1', s);
    localStorage.setItem('skyhold_isles_coach2d_v1', '1');
    localStorage.setItem('skyhold2d_coach_v1', 'done');
  }, [SEED, LANG]);
  const page = await ctx.newPage();
  const sep = q ? '&' : '?';
  await page.goto(`${BASE}/2d.html${q}${sep}lang=${LANG}&desktop=${touch ? 0 : 1}`);
  await page.waitForFunction(() => !document.getElementById('boot'), null, { timeout: 60000 });
  await page.waitForTimeout(name === 'hud' || name === 'title' ? 2500 : 1400);
  const r = await page.evaluate(() => {
    const out = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.textContent.trim();
      if (!text) continue;
      const e = n.parentElement;
      if (!e || !e.closest('.pu')) continue;
      const rect = e.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1 || rect.bottom < 0 || rect.top > innerHeight) continue;
      const cs = getComputedStyle(e);
      if (cs.visibility === 'hidden' || Number(cs.opacity) < 0.05 || e.closest('[hidden]')) continue;
      out.push({ size: parseFloat(cs.fontSize), text: text.slice(0, 40), cls: `${e.tagName.toLowerCase()}.${[...e.classList].join('.')}`.slice(0, 70) });
    }
    return out;
  });
  r.sort((a, b) => a.size - b.size);
  const min = r[0]?.size ?? 0;
  const under = r.filter((x) => x.size < MIN);
  console.log(`${name}: ${r.length} texts, smallest ${min.toFixed(1)}px, under ${MIN}px: ${under.length}`);
  for (const u of under.slice(0, 6)) console.log(`   ${u.size.toFixed(1)}px ${u.cls} "${u.text}"`);
  small.push(...under.map((u) => ({ ...u, screen: name })));
  await ctx.close();
}
await browser.close();
console.log(`text size: ${small.length} texts under ${MIN}px at ${W}x${H}`);
