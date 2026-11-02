import { afterEach, expect, it, vi } from 'vitest';
import { watchPopupViewport } from './popup-viewport';

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });
function setup() {
  const viewport = Object.assign(new EventTarget(), { height: 400, offsetTop: 12, scale: 1 });
  vi.stubGlobal('visualViewport', viewport);
  vi.stubGlobal('innerHeight', 852);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1; });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  const content = document.createElement('div');
  const input = document.createElement('input');
  input.scrollIntoView = vi.fn();
  content.append(input); document.body.append(content);
  return { viewport, content, input };
}
it('follows keyboard height and offset only for a focused field in this popup', () => {
  const { viewport, content, input } = setup();
  const stop = watchPopupViewport(content);
  expect(content).not.toHaveAttribute('data-popup-keyboard');
  input.focus();
  expect(content).toHaveAttribute('data-popup-keyboard', 'true');
  expect(content.style.getPropertyValue('--popup-viewport-height')).toBe('400px');
  expect(input.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
  const calls = vi.mocked(input.scrollIntoView).mock.calls.length;
  viewport.offsetTop = 24; viewport.dispatchEvent(new Event('scroll'));
  expect(content.style.getPropertyValue('--popup-viewport-top')).toBe('24px');
  expect(input.scrollIntoView).toHaveBeenCalledTimes(calls);
  viewport.height = 852; viewport.dispatchEvent(new Event('resize'));
  expect(content).not.toHaveAttribute('data-popup-keyboard');
  expect(content.style.getPropertyValue('--popup-viewport-height')).toBe('');
  stop();
});
it('ignores pinch zoom and a keyboard opened in a different popup', () => {
  const { viewport, content, input } = setup();
  const stop = watchPopupViewport(content);
  viewport.scale = 2; input.focus();
  expect(content).not.toHaveAttribute('data-popup-keyboard');
  viewport.scale = 1;
  const outside = document.createElement('input'); document.body.append(outside); outside.focus();
  viewport.dispatchEvent(new Event('resize'));
  expect(content).not.toHaveAttribute('data-popup-keyboard');
  stop();
});
it('removes viewport styles and listeners when the popup closes', () => {
  const { viewport, content, input } = setup(); input.focus();
  const stop = watchPopupViewport(content);
  expect(content).toHaveAttribute('data-popup-keyboard');
  stop();
  expect(content).not.toHaveAttribute('data-popup-keyboard');
  viewport.dispatchEvent(new Event('resize'));
  expect(content.style.getPropertyValue('--popup-viewport-height')).toBe('');
});
