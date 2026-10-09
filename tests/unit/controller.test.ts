import { afterEach, describe, expect, it, vi } from 'vitest';
import { SearchController } from '../../src/search/controller';

describe('search scheduling', () => {
  afterEach(() => vi.useRealTimers());
  it('debounces all nonempty input, including a single character', () => {
    vi.useFakeTimers();
    const start = vi.fn(); const clear = vi.fn();
    const controller = new SearchController({ start, clear });
    controller.update('q');
    vi.advanceTimersByTime(399);
    expect(start).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(start).toHaveBeenCalledWith(1, 'q');
  });
  it('invalidates work immediately, flushes on Enter, and never accepts stale results', () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const controller = new SearchController({ start, clear: vi.fn() });
    controller.update('one'); controller.flush();
    controller.update('two');
    expect(controller.accepts(1)).toBe(false);
    expect(controller.accepts(2)).toBe(true);
    expect(controller.flush()).toBe(true);
    expect(controller.flush()).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(start).toHaveBeenCalledTimes(2);
  });
  it('clears whitespace without inference and preserves long queries', () => {
    vi.useFakeTimers();
    const start = vi.fn();
    const controller = new SearchController({ start, clear: vi.fn() });
    controller.update('  '); vi.advanceTimersByTime(1000);
    expect(start).not.toHaveBeenCalled();
    const query = 'a'.repeat(10000);
    controller.update(query); controller.flush();
    expect(start).toHaveBeenCalledWith(2, query);
  });
});
