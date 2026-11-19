'use client';

// The app's background: one STILL layer under the content -- the accent glow the mesh used to drift, plus the
// vignette's darkened edges -- drawn once and never animated, filtered or blended. Nothing sits over the content,
// so scrolling costs what a plain page does. (The animated mesh, grain and over-content vignette were removed
// 2026-11-19; see lib/effects.ts.)
export function CinematicFX() {
  return <div className="fx-backdrop" />;
}
