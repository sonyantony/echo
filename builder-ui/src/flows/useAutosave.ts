import { useEffect, useRef } from 'react';

interface AutosaveOptions {
  /** Seconds between checks; 0 or undefined turns autosave off. */
  intervalSeconds: number | undefined;
  /** True when there are changes since the last save. */
  dirty: boolean;
  /** True while a save, validate or publish is already running; that tick is skipped. */
  busy: boolean;
  save(): unknown;
}

/** Every intervalSeconds, saves if something changed since the last save and nothing else is running. */
export function useAutosave({ intervalSeconds, dirty, busy, save }: AutosaveOptions) {
  const state = useRef({ dirty, busy, save });
  state.current = { dirty, busy, save };

  useEffect(() => {
    if (!intervalSeconds || intervalSeconds <= 0) return;
    const timer = window.setInterval(() => {
      const { dirty, busy, save } = state.current;
      if (dirty && !busy) save();
    }, intervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [intervalSeconds]);
}
