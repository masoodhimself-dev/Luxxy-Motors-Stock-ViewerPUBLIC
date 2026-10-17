import { act, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { stockHeaderMedia, useStockHeader } from './use-stock-header';

const originalWindowProperties = Object.fromEntries(
  ['scrollY', 'innerHeight', 'innerWidth'].map(key => [key, Object.getOwnPropertyDescriptor(window, key)]),
);
let media: MediaQueryList;
let touch = true;

function setWindowProperty(key: string, value: number) {
  Object.defineProperty(window, key, { configurable: true, writable: true, value });
}

function Harness({ enabled = true, menuOpen = false, routeKey = '/stock' }: { enabled?: boolean; menuOpen?: boolean; routeKey?: string }) {
  const header = useRef<HTMLElement>(null);
  const { hidden, reveal } = useStockHeader(enabled, menuOpen, header, routeKey);
  return <><header ref={header} onFocusCapture={reveal}><button type="button">Header menu</button></header><output data-testid="header-state">{hidden ? 'hidden' : 'visible'}</output><button type="button">Outside header</button></>;
}

function scrollTo(y: number) {
  act(() => {
    setWindowProperty('scrollY', y);
    window.dispatchEvent(new Event('scroll'));
  });
}

function viewport(width: number, isTouch = true) {
  touch = isTouch;
  setWindowProperty('innerWidth', width);
}

beforeEach(() => {
  setWindowProperty('scrollY', 0);
  setWindowProperty('innerHeight', 800);
  viewport(390);
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(119);
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(3000);
  const target = new EventTarget();
  Object.defineProperties(target, {
    matches: { get: () => window.innerWidth <= 1023 || (touch && window.innerWidth <= 1366) },
    media: { value: stockHeaderMedia },
  });
  media = target as MediaQueryList;
  vi.stubGlobal('matchMedia', vi.fn(() => media));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const [key, descriptor] of Object.entries(originalWindowProperties)) {
    if (descriptor) Object.defineProperty(window, key, descriptor);
  }
});

it('hides only after scrolling below the measured header plus its breathing room', () => {
  render(<Harness />);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  scrollTo(140);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  scrollTo(143);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  scrollTo(144);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
});

it('accumulates a deliberate twelve-pixel upward scroll before restoring navigation', () => {
  render(<Harness />);
  scrollTo(200);
  scrollTo(196);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
  scrollTo(192);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
  scrollTo(188);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
});

it('starts upward accumulation again when touch jitter reverses direction', () => {
  render(<Harness />);
  scrollTo(200);
  scrollTo(198);
  scrollTo(202);
  scrollTo(192);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
  scrollTo(190);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
});

it('reveals near the top and treats negative and bottom rubber-band overscroll as page edges', () => {
  render(<Harness />);
  scrollTo(200);
  scrollTo(-20);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  scrollTo(200);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
  scrollTo(40);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  scrollTo(99999);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
  scrollTo(99900);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
});

it('pins navigation while its menu is open and resets tracking when the menu closes', () => {
  const view = render(<Harness />);
  scrollTo(200);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
  view.rerender(<Harness menuOpen />);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  scrollTo(250);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  view.rerender(<Harness />);
  scrollTo(255);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  scrollTo(262);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
});

it('reveals immediately for header focus and stays visible while keyboard focus remains there', () => {
  render(<Harness />);
  scrollTo(200);
  const menu = screen.getByRole('button', { name: 'Header menu' });
  vi.spyOn(menu, 'matches').mockImplementation(selector => selector === ':focus-visible');
  act(() => menu.focus());
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  scrollTo(260);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  act(() => screen.getByRole('button', { name: 'Outside header' }).focus());
  scrollTo(280);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
});

it('does not let retained pointer focus permanently pin the header', () => {
  render(<Harness />);
  const menu = screen.getByRole('button', { name: 'Header menu' });
  vi.spyOn(menu, 'matches').mockReturnValue(false);
  act(() => menu.focus());
  scrollTo(200);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
});

it('resets on resize and media changes, including wide landscape touch tablets', () => {
  render(<Harness />);
  expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 1023px), (hover: none) and (pointer: coarse) and (max-width: 1366px)');
  scrollTo(200);
  act(() => window.dispatchEvent(new Event('resize')));
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  scrollTo(220);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
  viewport(1440, false);
  act(() => media.dispatchEvent(new Event('change')));
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  scrollTo(300);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  viewport(1366, true);
  act(() => media.dispatchEvent(new Event('change')));
  scrollTo(320);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
});

it('keeps desktop and non-stock routes visible and starts fresh when stock browsing resumes', () => {
  viewport(1280, false);
  const view = render(<Harness />);
  scrollTo(300);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  viewport(390);
  act(() => media.dispatchEvent(new Event('change')));
  scrollTo(320);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
  view.rerender(<Harness enabled={false} />);
  scrollTo(400);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  view.rerender(<Harness />);
  scrollTo(406);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  scrollTo(412);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
});

it('removes its listeners after unmounting', () => {
  const removeWindow = vi.spyOn(window, 'removeEventListener');
  const removeMedia = vi.spyOn(media, 'removeEventListener');
  const view = render(<Harness />);
  view.unmount();
  expect(removeWindow).toHaveBeenCalledWith('scroll', expect.any(Function));
  expect(removeWindow).toHaveBeenCalledWith('resize', expect.any(Function));
  expect(removeMedia).toHaveBeenCalledWith('change', expect.any(Function));
  fireEvent.scroll(window);
});

it('starts each vehicle and stock route with visible navigation even when both use the scrolling header', () => {
  const view = render(<Harness />);
  scrollTo(300);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
  view.rerender(<Harness routeKey="/vehicle/car-one" />);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  scrollTo(320);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
  view.rerender(<Harness routeKey="/vehicle/car-two" />);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
  scrollTo(340);
  expect(screen.getByTestId('header-state')).toHaveTextContent('hidden');
  view.rerender(<Harness routeKey="/stock" />);
  expect(screen.getByTestId('header-state')).toHaveTextContent('visible');
});
