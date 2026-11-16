// Navigation-only A/B: home <-> library through the top nav, 3 rounds, median, CPU throttled. CSS variants are injected, nothing is rebuilt.
//   VARS='{"base":"","grain-off":".fx-grain{display:none!important}"}' RATE=4 BASE=http://127.0.0.1:18140 node test/perf/nav.mjs
import { makeBrowser, signIn, installFixture, cpu, sleep, setCss, RECORDER, COLLECT, BASE } from './lib.mjs';
const VARS = JSON.parse(process.env.VARS || '{"base":""}');
const RATE = Number(process.env.RATE || 4);
const b = await makeBrowser(); const page = await signIn(b); await installFixture(page);
await page.setViewport({ width: 1440, height: 900 });
const click = (h) => page.evaluate((h) => { [...document.querySelectorAll('header a')].find((x) => x.getAttribute('href')?.startsWith(h))?.click(); }, h);
for (const [name, css] of Object.entries(VARS)) {
  const rows = [];
  for (let r = 0; r < 3; r++) {
    await cpu(page, 1);
    await page.goto(BASE + '/', { waitUntil: 'networkidle2' }); await sleep(2000);
    await setCss(page, css); await sleep(300);
    await cpu(page, RATE);
    await page.evaluate(RECORDER);
    for (const h of ['/library', '/', '/library', '/']) { await click(h); await sleep(1300); }
    rows.push(await page.evaluate(COLLECT));
  }
  const med = (k) => rows.map((x) => x[k]).sort((a, c) => a - c)[1];
  console.log(`${name.padEnd(16)} fps ${med('fps')}  p95 ${med('p95')}  max ${med('max')}  >33ms ${med('over33')}%  long ${med('longTasks')}/${med('longMs')}ms`);
}
await b.close();
