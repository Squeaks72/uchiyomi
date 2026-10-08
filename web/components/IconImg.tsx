'use client';
// An image that is replaced by a lettered tile if it will not load: the one behaviour behind SourceTile's icon,
// SourcePicker's icon and ExtensionBits' ExtIcon. Each keeps its own look by passing the `fallback` tile and
// the <img> classes; this owns the failed-state and the <img> itself.
import { useState, type CSSProperties, type ReactNode } from 'react';

export function IconImg({ src, skip, fallback, size, className, style, ariaHidden, decoding }: {
  src: string;
  /** Draw the fallback straight away (no icon known, or the source is gone) instead of after a failed request. */
  skip?: boolean;
  fallback: ReactNode;
  size: number;
  className?: string;
  style?: CSSProperties;
  ariaHidden?: boolean;
  decoding?: 'async';
}) {
  const [failed, setFailed] = useState(false);
  if (skip || failed) return <>{fallback}</>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" aria-hidden={ariaHidden || undefined} width={size} height={size} loading="lazy" decoding={decoding}
    onError={() => setFailed(true)} style={style} className={className} />;
}
