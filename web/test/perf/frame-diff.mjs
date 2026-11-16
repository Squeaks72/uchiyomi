// Pixel-compare CSS variants against the shipped look with every animation frozen, so only the variant differs.
//   VARS='{"grain-off":".fx-grain{display:none!important}"}' BASE=http://127.0.0.1:18140 node test/perf/frame-diff.mjs
// Prints, per page: share of pixels that differ, RMS and max channel difference, and the mean brightness shift of dark / bright pixels.
import { makeBrowser, signIn, installFixture, sleep, setCss, BASE } from './lib.mjs';
const VARS = JSON.parse(process.env.VARS);
const b = await makeBrowser(); const page = await signIn(b); await installFixture(page);
await page.setViewport({ width: 1440, height: 900 });
const FREEZE = '*,*::before,*::after{animation-play-state:paused!important;animation-delay:0s!important;transition:none!important}';
const shot = async (css) => { await setCss(page, FREEZE + css); await sleep(900); return (await page.screenshot({ type: 'png' })).toString('base64'); };
for (const url of ['/', '/library']) {
  await page.goto(BASE + url, { waitUntil: 'networkidle2' }); await sleep(3500);
  const ref = await shot('');
  for (const [name, css] of Object.entries(VARS)) {
    const v = await shot(css);
    const r = await page.evaluate(async (a, c) => {
      const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = 'data:image/png;base64,' + s; });
      const [ia, ic] = await Promise.all([load(a), load(c)]);
      const mk = (i) => { const k = document.createElement('canvas'); k.width = i.width; k.height = i.height; const x = k.getContext('2d'); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
      const A = mk(ia), C = mk(ic); let n = 0, sum = 0, max = 0, big = 0;
      for (let p = 0; p < A.length; p += 4) { let d = 0; for (let k = 0; k < 3; k++) d = Math.max(d, Math.abs(A[p + k] - C[p + k])); if (d) n++; sum += d * d; if (d > max) max = d; if (d > 2) big++; }
      let sd=0,nd=0,sb=0,nb=0; for (let p=0;p<A.length;p+=4){const l=(A[p]+A[p+1]+A[p+2])/3,d=(C[p]+C[p+1]+C[p+2])/3-l; if(l<20){sd+=d;nd++}else if(l>100){sb+=d;nb++}} return { darkMeanShift: +(sd/nd).toFixed(2), brightMeanShift: +(sb/nb).toFixed(2), differing: +(100 * n / (A.length / 4)).toFixed(2) + '%', rms: +Math.sqrt(sum / (A.length / 4)).toFixed(3), max, over2: big };
    }, ref, v);
    console.log(url.padEnd(9), name.padEnd(18), JSON.stringify(r));
  }
}
await b.close();
