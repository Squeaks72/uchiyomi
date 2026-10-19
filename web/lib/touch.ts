/**
 * True on a phone or tablet: the PRIMARY pointer is a finger. Used to skip focusing a text field the moment a
 * dialog opens -- on iOS that raises the keyboard straight over the dialog's own buttons, and the page zooms.
 * (Hover-capable laptops with a touchscreen report `fine`, so they keep the autofocus.)
 */
export function coarsePointer(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
}
