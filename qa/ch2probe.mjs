// Quick probe: open a URL, wait, print boot text / __p0 presence, save a screenshot.
import { chromium } from 'playwright';
const url = process.argv[2];
const ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const browser = await chromium.launch({ args: ARGS });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('console', (m) => console.log('console', m.type(), m.text().slice(0, 200)));
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(url);
await new Promise((r) => setTimeout(r, Number(process.argv[3] ?? 15000)));
console.log(await page.evaluate(() => ({ boot: document.getElementById('boot')?.textContent?.slice(0, 200) ?? null, p0: !!window.__p0, state: !!window.__p0?.state, map: !!window.__map })));
await page.screenshot({ path: '/tmp/ch2/probe.jpg', type: 'jpeg', quality: 70 });
await browser.close();
