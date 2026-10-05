import { describe, expect, it } from 'vitest';
import type { Enquiry } from '@workspace/api-client-react';
import { enquiryGroup, enquiryGroupSearchText, enquiryRootRecords, primaryEnquiry } from './enquiry-groups';

const record = (id: string, extra: Partial<Enquiry> = {}) => ({ id, customerName: 'Alex Morgan', reference: `ENQ-${id}`,
  createdAt: '2026-10-05T10:00:00Z', vehicleTitle: 'BMW 320i', message: `Original message ${id}`, ...extra }) as Enquiry;

describe('staff enquiry groups', () => {
  it('shows one combined case while keeping every original and source search term', () => {
    const main = record('main');
    const source = record('source', { mergedIntoId: 'main', vehicleTitle: 'Nissan Qashqai', phone: '+447700900123', message: 'Please arrange a test drive.' });
    const separate = record('separate');
    const all = [source, separate, main];
    expect(enquiryRootRecords(all)).toEqual([separate, main]);
    expect(primaryEnquiry(source, all)).toBe(main);
    expect(enquiryGroup(source, all)).toEqual([main, source]);
    expect(enquiryGroupSearchText(main, all)).toContain('Nissan Qashqai');
    expect(enquiryGroupSearchText(main, all)).toContain('Please arrange a test drive.');
    expect(source.message).toBe('Please arrange a test drive.');
  });

  it('resolves older chains but keeps broken or circular records visible', () => {
    const main = record('main');
    const child = record('child', { mergedIntoId: 'main' });
    const grandchild = record('grandchild', { mergedIntoId: 'child' });
    const missing = record('missing', { mergedIntoId: 'unknown' });
    const cycleA = record('a', { mergedIntoId: 'b' });
    const cycleB = record('b', { mergedIntoId: 'a' });
    const all = [main, child, grandchild, missing, cycleA, cycleB];
    expect(primaryEnquiry(grandchild, all)).toBe(main);
    expect(enquiryGroup(main, all)).toEqual([main, child, grandchild]);
    expect(enquiryRootRecords(all)).toEqual([main, missing, cycleA, cycleB]);
  });
});
