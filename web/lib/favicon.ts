'use client';
// The tab icon in the accent colour, as the logo mark is (components/Brand.tsx Mark): the same silhouette, the same
// light-to-deep gradient, on the dark ground the icon files have. Drawn once per colour on a canvas and swapped into the
// page's icon links; the PNG icon files stay the first paint, in the default accent, and what an installed app and a bookmark use.
const MASK = '/icons/uchiyomi-mark-mask.png';
const SIZE = 64;

let mask: Promise<HTMLImageElement | null> | null = null;
const loadMask = (): Promise<HTMLImageElement | null> => (mask ??= new Promise((resolve) => {
  const im = new Image();
  im.onload = () => resolve(im);
  im.onerror = () => resolve(null);
  im.src = MASK;
}));

/** `r g b` (the --accent triplet) as the three channels. */
const channels = (t: string): [number, number, number] | null => {
  const m = /^(\d{1,3}) (\d{1,3}) (\d{1,3})$/.exec(t.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
};
const mix = (c: [number, number, number], to: number, k: number) => c.map((v) => Math.round(v + (to - v) * k)).join(',');

/** The icon as a PNG data URL for this accent triplet; null where there is no canvas. */
export async function faviconFor(triplet: string, size = SIZE): Promise<string | null> {
  const c = channels(triplet);
  const im = await loadMask();
  if (!c || !im || typeof document === 'undefined') return null;
  const logo = document.createElement('canvas');
  logo.width = logo.height = size;
  const lx = logo.getContext('2d');
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const ox = out.getContext('2d');
  if (!lx || !ox) return null;
  const g = lx.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, `rgb(${mix(c, 255, 0.55)})`);
  g.addColorStop(0.48, `rgb(${c.join(',')})`);
  g.addColorStop(1, `rgb(${mix(c, 0, 0.38)})`);
  lx.fillStyle = g;
  lx.fillRect(0, 0, size, size);
  lx.globalCompositeOperation = 'destination-in';
  lx.drawImage(im, 0, 0, size, size);
  ox.fillStyle = '#0b0b10';
  ox.beginPath();
  ox.roundRect(0, 0, size, size, size * 0.22);
  ox.fill();
  const pad = size * 0.08;
  ox.drawImage(logo, pad, pad, size - pad * 2, size - pad * 2);
  return out.toDataURL('image/png');
}

let last = '';
/** The icon drawn for `last`: put back as it is whenever the page's links lose it, without drawing it again. */
let lastUrl: string | null = null;

/** Point every icon link at `url`. Only touches a link that points elsewhere, so the head observer below does not chase itself. */
function pointLinks(url: string): void {
  const links = [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')];
  if (!links.length) { const l = document.createElement('link'); l.rel = 'icon'; document.head.appendChild(l); links.push(l); }
  for (const l of links) {
    if (l.getAttribute('href') === url) continue;
    l.type = 'image/png'; l.removeAttribute('sizes'); l.href = url;
  }
}

/** Point the page's icon links at the accent's icon. A failure leaves the file icon where it was. */
export async function applyFavicon(triplet: string): Promise<void> {
  if (typeof document === 'undefined') return;
  if (triplet === last) { if (lastUrl) pointLinks(lastUrl); return; }
  last = triplet;
  const url = await faviconFor(triplet).catch(() => null);
  if (!url || last !== triplet) return;
  lastUrl = url;
  pointLinks(url);
}

/**
 * Keep the tab icon on the accent: once now, again whenever the page's `--accent` changes (the picker, a profile switch, the saved
 * colour arriving after sign-in), and again whenever the page's icon links are put back to the file (2026-11-18): Next re-renders the
 * head's metadata links on some navigations, and the tab then fell back to /icons/favicon.png -- and, on a device whose service worker
 * still cached the old file, to the old purple icon. Watched rather than called from the code that sets either, which is the auth
 * context's and Next's. Returns the stop function.
 */
export function followAccentFavicon(): () => void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
  const root = document.documentElement;
  const sync = () => { const t = root.style.getPropertyValue('--accent').trim(); if (t) void applyFavicon(t); };
  sync();
  const mo = new MutationObserver(sync);
  mo.observe(root, { attributes: true, attributeFilter: ['style'] });
  // An icon link added, removed or re-pointed: put the accent's icon back (pointLinks leaves a link already on it alone).
  const head = new MutationObserver((records) => {
    if (!lastUrl) return;
    const touched = records.some((r) => [...r.addedNodes, r.target].some((n) => n instanceof HTMLLinkElement && /\bicon\b/.test(n.rel)));
    if (touched && [...document.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].some((l) => l.getAttribute('href') !== lastUrl)) pointLinks(lastUrl);
  });
  head.observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'rel'] });
  return () => { mo.disconnect(); head.disconnect(); };
}
