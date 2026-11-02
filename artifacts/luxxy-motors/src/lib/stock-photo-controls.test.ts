import { expect, it } from 'vitest';
import { stockPhotoControlsEnabled } from './stock-photo-controls';

const documentAt = (origin: string, canonical?: string) => ({
  querySelector: () => canonical ? { content: canonical } : null,
  location: { origin },
}) as unknown as Document;

it.each(['https://multichoicemotors.co.uk', 'https://www.multichoicemotors.co.uk'])('simplifies stock photos for the Multi-Choice domain %s', origin => {
  expect(stockPhotoControlsEnabled(documentAt(origin))).toBe(false);
});

it.each(['http://127.0.0.1:4286', 'http://192.168.1.24:4286', 'https://multi-choice-motors-cazoo-test.demo.luxxyexmaplenumber2.uk'])('uses the tenant-verified canonical origin for a Multi-Choice preview at %s', origin => {
  expect(stockPhotoControlsEnabled(documentAt(origin, 'https://multichoicemotors.co.uk'))).toBe(false);
});

it.each(['https://shoredrive.uk', 'https://luxxymotors.uk', 'http://localhost:4285', 'https://multichoicemotors.co.uk.other.uk'])('uses the shared clean photograph presentation on %s', origin => {
  expect(stockPhotoControlsEnabled(documentAt(origin))).toBe(false);
});

it('uses the shared clean presentation for another dealership on a preview', () => {
  expect(stockPhotoControlsEnabled(documentAt('http://127.0.0.1:4286', 'https://shoredrive.uk'))).toBe(false);
});

it('keeps the shared presentation independent of shell location', () => {
  expect(stockPhotoControlsEnabled(documentAt('invalid'))).toBe(false);
  expect(stockPhotoControlsEnabled()).toBe(false);
});
