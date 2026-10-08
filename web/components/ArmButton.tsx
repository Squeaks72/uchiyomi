'use client';
// The two-step "Sure?" press: the first press arms the button, a second inside the window confirms, and an armed
// button that is left alone disarms itself. ConfirmDialog's twoStep and the admin console's Gather use it.
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { t as tr } from '@/lib/i18n';

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
