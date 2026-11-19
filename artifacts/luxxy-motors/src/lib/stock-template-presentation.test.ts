import { afterEach, expect, it, vi } from 'vitest';
import { LEGACY_STOCK_VIEW_KEY, readStockView, stockTemplatePresentation, stockViewStorageKey, writeStockView } from './stock-template-presentation';

afterEach(() => { vi.restoreAllMocks(); window.localStorage.clear(); });

it('isolates a preference by dealership, template and private demo dealer without changing the legacy key', () => {
  expect(stockViewStorageKey(null, 'https://one.example')).toBe(LEGACY_STOCK_VIEW_KEY);
  const one = stockViewStorageKey('grand-touring', 'https://one.example'), two = stockViewStorageKey('grand-touring', 'https://two.example'), otherLayout = stockViewStorageKey('showroom', 'https://one.example');
  writeStockView(one, 'compact');
  expect(readStockView(one)).toBe('compact');
  expect(readStockView(two)).toBeNull(); expect(readStockView(otherLayout)).toBeNull(); expect(readStockView(LEGACY_STOCK_VIEW_KEY)).toBeNull();
  expect(stockViewStorageKey('panorama', 'https://shared.example', 'demo-one')).not.toBe(stockViewStorageKey('panorama', 'https://shared.example', 'demo-two'));
  expect(stockViewStorageKey('showroom', 'https://ONE.example/')).toBe(stockViewStorageKey('showroom', 'https://one.example'));
});

it('ignores malformed preferences and keeps an explicit choice usable when browser storage is blocked', () => {
  window.localStorage.setItem('bad-choice', 'row'); expect(readStockView('bad-choice')).toBeNull();
  const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked'); });
  expect(readStockView('key')).toBeNull(); get.mockRestore();
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Blocked'); });
  expect(() => writeStockView('key', 'compact')).not.toThrow();
});

it('retains legacy cards/list while an explicit List choice wins over each template default', () => {
  expect(stockTemplatePresentation(null, 'cards')).toMatchObject({ cardLayout: 'card', filters: 'sidebar', imageSizes: undefined });
  expect(stockTemplatePresentation(null, 'compact').cardLayout).toBe('compact');
  expect(stockTemplatePresentation('grand-touring', null).cardLayout).toBe('row');
  expect(stockTemplatePresentation('grand-touring', 'cards').cardLayout).toBe('card');
  expect(stockTemplatePresentation('forecourt', null).cardLayout).toBe('compact');
  for (const template of ['showroom', 'grand-touring', 'forecourt', 'panorama'] as const) expect(stockTemplatePresentation(template, 'compact').cardLayout).toBe('compact');
});

it('requests narrow phone images for the compact catalogue without shrinking full-width gallery cards', () => {
  expect(stockTemplatePresentation('forecourt', null).imageSizes).toMatch(/^\(max-width: 700px\) 39vw/);
  for (const template of ['showroom', 'grand-touring', 'forecourt', 'panorama'] as const) {
    expect(stockTemplatePresentation(template, 'compact').imageSizes).toMatch(/^\(max-width: 700px\) 39vw/);
    expect(stockTemplatePresentation(template, 'cards').imageSizes).toMatch(/^\(max-width: 767px\) 100vw/);
  }
  expect(stockTemplatePresentation(null, 'compact').imageSizes).toBeUndefined();
});
