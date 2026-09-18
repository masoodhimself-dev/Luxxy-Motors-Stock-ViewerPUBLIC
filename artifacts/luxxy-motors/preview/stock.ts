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
    // Explicit sample copy demonstrates optional buyer fields; never used by production stock.
    ...(position === 0
      ? {
          specifications: {
            serviceHistory: "Sample: service records available to view",
            motExpiry: "Sample: confirm the expiry date before purchase",
            numberOfKeys: 2,
            conditionNotes:
              "Sample condition notes: inspect the vehicle and review the available repair information at your appointment.",
            warrantyDetails:
              "Sample: ask which warranty options apply to this vehicle",
            includedItems: [
              "Sample: vehicle documents",
              "Sample: supplied accessories to be confirmed",
            ],
          },
        }
      : {}),
  })),
} as StockData;
