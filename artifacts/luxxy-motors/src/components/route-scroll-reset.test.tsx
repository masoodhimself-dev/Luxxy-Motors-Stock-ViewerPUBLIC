import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteScrollReset } from './route-scroll-reset';
import { requestBrowseRestore } from '@/lib/browse-session';

let currentLocation = '/';

vi.mock('wouter', () => ({
  useLocation: () => [currentLocation, vi.fn()],
}));
vi.mock('@/lib/browse-session', () => ({ requestBrowseRestore: vi.fn() }));

describe('RouteScrollReset', () => {
  beforeEach(() => {
    currentLocation = '/';
    window.scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
    vi.mocked(requestBrowseRestore).mockClear();
  });

  it('opens the initial route at the top and resets again after navigation', () => {
    const view = render(<RouteScrollReset />);

    expect(window.history.scrollRestoration).toBe('manual');
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 0,
      left: 0,
      behavior: 'instant',
    });

    currentLocation = '/saved';
    view.rerender(<RouteScrollReset />);

    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 0,
      left: 0,
      behavior: 'instant',
    });
  });
  it('opens a vehicle immediately from scrolled stock without inheriting smooth page scrolling', () => {
    currentLocation = '/stock';
    const view = render(<RouteScrollReset />);
    vi.mocked(window.scrollTo).mockClear();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1650 });
    currentLocation = '/vehicle/selected-car';
    view.rerender(<RouteScrollReset />);

    expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, left: 0, behavior: 'instant' });
    expect(requestBrowseRestore).not.toHaveBeenCalled();
    expect(window.history.scrollRestoration).toBe('manual');
  });

  it('requests the saved stock position on returning from a vehicle and never starts a smooth reset', () => {
    currentLocation = '/vehicle/selected-car';
    const view = render(<RouteScrollReset />);
    vi.mocked(window.scrollTo).mockClear();
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 920 });
    currentLocation = '/stock';
    view.rerender(<RouteScrollReset />);

    expect(requestBrowseRestore).toHaveBeenCalledOnce();
    expect(window.scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, left: 0, behavior: 'instant' });
    // A stock rerender (for example after restoring filters) must not reset the
    // position again or consume another restore request.
    view.rerender(<RouteScrollReset />);
    expect(requestBrowseRestore).toHaveBeenCalledOnce();
    expect(window.scrollTo).toHaveBeenCalledTimes(1);
  });
});
