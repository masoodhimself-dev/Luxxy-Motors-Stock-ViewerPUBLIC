import { expect, it } from 'vitest';
import { questionKeyForLabel, questionMessage } from './vehicle-questions';
import { buyerInformation } from './buyer-information';
import type { Car } from './stock-context';
it('only recognised buyer questions become editable enquiry text', () => {
  expect(questionKeyForLabel('MOT expiry')).toBe('mot');
  expect(questionMessage('mot')).toContain('MOT expiry');
  expect(questionMessage('constructor')).toBe('');
  expect(questionMessage('<script>')).toBe('');
});
it('expands supplied categories without inventing missing history', () => {
  expect(buyerInformation({writeOffCategory: 'S'} as Car).find(x => x.label === 'Insurance history')?.value).toBe('Category S recorded');
  expect(buyerInformation({writeOffCategory: 'Cat N'} as Car).find(x => x.label === 'Insurance history')?.value).toBe('Category N recorded');
  expect(buyerInformation({} as Car).find(x => x.label === 'Insurance history')?.value).toBeNull();
});
