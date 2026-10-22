import { useEffect } from 'react';

/**
 * Closes an open tab-line menu on any press outside it and on Escape, wherever they happen.
 * PatternFly's own outside-click check listens for clicks on this window, which never sees a click
 * inside the Apicurio frame (Openapi Design) and can miss one the Kaoto canvas swallows. So this
 * listens for presses in the capture phase, and treats the window losing focus to a frame as a press.
 */
export function useDismissMenu(open: boolean, setOpen: (open: boolean) => void) {
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      // Inside the open menu (appended to body), or on its own toggle, which toggles it itself.
      if (target?.closest('.pf-v6-c-menu, .pf-v6-c-menu-toggle[aria-expanded="true"]')) return;
      close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    // A press in a frame moves focus to it, so this window only sees a blur.
    const onBlur = () =>
      setTimeout(() => {
        if (document.activeElement instanceof HTMLIFrameElement) close();
      });
    window.addEventListener('pointerdown', onPointerDown, true);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [open, setOpen]);
}
