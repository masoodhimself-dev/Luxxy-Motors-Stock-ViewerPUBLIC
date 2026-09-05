import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RouteScrollReset } from './route-scroll-reset';

let currentLocation = '/';

vi.mock('wouter', () => ({
  useLocation: () => [currentLocation, vi.fn()],
}));

describe('RouteScrollReset', () => {
  beforeEach(() => {
    currentLocation = '/';
    window.scrollTo = vi.fn();
  });

  it('opens the initial route at the top and resets again after navigation', () => {
    const view = render(<RouteScrollReset />);

    expect(window.history.scrollRestoration).toBe('manual');
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 0,
      left: 0,
      behavior: 'auto',
    });

    currentLocation = '/find-my-car';
    view.rerender(<RouteScrollReset />);

    expect(window.scrollTo).toHaveBeenCalledTimes(2);
    expect(window.scrollTo).toHaveBeenLastCalledWith({
      top: 0,
      left: 0,
      behavior: 'auto',
    });
  });
});