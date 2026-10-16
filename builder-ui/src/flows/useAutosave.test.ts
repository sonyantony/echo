import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAutosave } from './useAutosave';

describe('useAutosave', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('saves on each interval only while there are unsaved changes', () => {
    const save = vi.fn();
    const { rerender } = renderHook((props) => useAutosave(props), {
      initialProps: { intervalSeconds: 10, dirty: false, busy: false, save },
    });

    vi.advanceTimersByTime(10_000);
    expect(save).not.toHaveBeenCalled();

    rerender({ intervalSeconds: 10, dirty: true, busy: false, save });
    vi.advanceTimersByTime(9_999);
    expect(save).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(save).toHaveBeenCalledTimes(1);

    rerender({ intervalSeconds: 10, dirty: false, busy: false, save });
    vi.advanceTimersByTime(30_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('skips a tick while another save is running', () => {
    const save = vi.fn();
    const { rerender } = renderHook((props) => useAutosave(props), {
      initialProps: { intervalSeconds: 10, dirty: true, busy: true, save },
    });
    vi.advanceTimersByTime(10_000);
    expect(save).not.toHaveBeenCalled();

    rerender({ intervalSeconds: 10, dirty: true, busy: false, save });
    vi.advanceTimersByTime(10_000);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('is off when the interval is 0', () => {
    const save = vi.fn();
    renderHook(() => useAutosave({ intervalSeconds: 0, dirty: true, busy: false, save }));
    vi.advanceTimersByTime(60_000);
    expect(save).not.toHaveBeenCalled();
  });
});
