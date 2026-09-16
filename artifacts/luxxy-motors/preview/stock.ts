import type { StockData } from '../src/lib/stock-context';
import archivedStock from '../../mockup-sandbox/src/components/mockups/luxxy-fluid/_stock-snapshot.json';

// Existing repository photography and matching vehicle records. These are archived
// examples, not today's stock; this module is only used by the local review server.
export const previewStock = {
  ...archivedStock,
  count: 6,
  cars: [3, 8, 1, 15, 20, 0].map((index, position) => ({
    ...archivedStock.cars[index],
    id: `preview-${position + 1}`,
  })),
} as StockData;
