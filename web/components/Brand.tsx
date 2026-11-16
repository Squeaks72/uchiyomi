export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-brand font-bold tracking-tight ${className}`}>
      uchiyomi<span className="text-accent">.</span>
    </span>
  );
}

// The Uchiyomi logo mark -- a kanji-for-"read" monogram under a roof. It is a silhouette (public/icons/uchiyomi-mark-mask.png,
// derived from the original artwork) filled with the user's accent, so it follows the accent picker: a light-to-deep
// gradient of `--accent`, with a soft glow. The PNG favicon/PWA icons stay the original artwork; they cannot follow a runtime setting.
export function Mark({ size = 40, className = '' }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        background:
          'linear-gradient(160deg, color-mix(in srgb, rgb(var(--accent)) 55%, white) 0%, rgb(var(--accent)) 48%, color-mix(in srgb, rgb(var(--accent)) 62%, black) 100%)',
        WebkitMaskImage: 'url(/icons/uchiyomi-mark-mask.png)',
        maskImage: 'url(/icons/uchiyomi-mark-mask.png)',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        filter: 'drop-shadow(0 0 6px rgb(var(--accent) / 0.45))',
      }}
    />
  );
}

// Mark + wordmark lockup for nav/header bars.
export function Lockup({ className = '', markSize = 24 }: { className?: string; markSize?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <Mark size={markSize} />
      <Wordmark className={className} />
    </span>
  );
}
