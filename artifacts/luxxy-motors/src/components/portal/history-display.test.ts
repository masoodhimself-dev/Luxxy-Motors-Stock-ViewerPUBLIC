import { expect, it } from 'vitest';
import type { DealerRelationships } from '@workspace/vehicle-meta';
import { historyDescription } from './history-display';

type Activity = DealerRelationships['vehicles'][number]['activities'][number];
const activity = (extra: Partial<Activity> = {}) => ({ id: 'enquiry-event:merge', kind: 'note', recordType: 'enquiry', recordId: 'original-id', reference: 'ENQ-ORIGINAL', description: '', ...extra } as Activity);

it('hides a known identifier in an old generated merge summary without changing its saved text or staff note', () => {
  const record = activity({ description: 'Record combined into case primary-id by Alex\n\nAlex: Bank reference ENQ-ORIGINAL is correct.' });
  const original = record.description;
  expect(historyDescription(record, [record, activity({ recordId: 'primary-id' })])).toBe('Record combined into the main case by Alex\n\nAlex: Bank reference ENQ-ORIGINAL is correct.');
  expect(record.description).toBe(original);
});

it('keeps official document numbers, payment references and arbitrary customer text intact', () => {
  const records = [activity({ id: 'sale:document', kind: 'document', description: 'INV-000123' }), activity({ id: 'sale:payment', kind: 'payment', description: 'Bank transfer · CUSTOMER-REF-123' }), activity({ id: 'enquiry:received', kind: 'enquiry', description: 'Please mention ENQ-ORIGINAL when calling.' })];
  for (const record of records) expect(historyDescription(record, records)).toBe(record.description);
});
