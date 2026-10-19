'use client';
// The two-step "Sure?" press: the first press arms the button, a second inside the window confirms, and an armed
// button that is left alone disarms itself. the admin console's Gather and Relocate use it.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { t as tr } from '@/lib/i18n';
import { coarsePointer } from '@/lib/touch';

export function useArmed(ms = 4000) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const h = setTimeout(() => setArmed(false), ms);
    return () => clearTimeout(h);
  }, [armed, ms]);
  const arm = useCallback(() => setArmed(true), []);
  const disarm = useCallback(() => setArmed(false), []);
  return { armed, arm, disarm };
}

/** A button whose first press says "Sure?" and whose second runs `onConfirm`. `twoStep={false}` runs it at once. */
export function ArmButton({ armed, arm, onConfirm, twoStep = true, busy, disabled, className, type, children }: {
  armed: boolean;
  arm: () => void;
  onConfirm: () => void;
  twoStep?: boolean;
  busy?: boolean;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
  children: ReactNode;
}) {
  return (
    <button type={type} onClick={() => { if (twoStep && !armed) arm(); else onConfirm(); }} disabled={disabled} className={className}>
      {busy ? tr('Working…') : twoStep && armed ? tr('Sure?') : children}
    </button>
  );
}

/**
 * A key that does something one mis-tap should not: on a phone or tablet its first press says "Sure?" and a second
 * within the window runs `onConfirm`; with a mouse it acts at once, as it always did (a click is deliberate).
 * `always` asks the two steps of a mouse too.
 */
export function ConfirmKey({ onConfirm, className, ariaLabel, always = false, children }: {
  onConfirm: () => void;
  className?: string;
  ariaLabel?: string;
  always?: boolean;
  children: ReactNode;
}) {
  const { armed, arm, disarm } = useArmed();
  return (
    <button type="button" aria-label={armed ? undefined : ariaLabel} className={className}
      onClick={() => { if ((always || coarsePointer()) && !armed) arm(); else { disarm(); onConfirm(); } }}>
      {armed ? tr('Sure?') : children}
    </button>
  );
}
