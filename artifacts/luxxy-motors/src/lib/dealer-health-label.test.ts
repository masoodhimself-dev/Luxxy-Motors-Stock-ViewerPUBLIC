import { expect, it } from 'vitest';
import { dealerHealthLabel } from './dealer-health-label';
it('uses the same decisive state for overview and operations', () => {
 expect(dealerHealthLabel({connectionConfigured:false,freshness:'critical',lastAttemptStatus:'failed'})).toBe('Import credential missing');
 expect(dealerHealthLabel({connectionConfigured:true,freshness:'critical',lastAttemptStatus:'completed'})).toBe('Stock overdue · 14h+');
 expect(dealerHealthLabel({connectionConfigured:true,freshness:'fresh',lastAttemptStatus:'quarantined'})).toBe('Last import held for review');
 expect(dealerHealthLabel({connectionConfigured:true,freshness:'fresh',lastAttemptStatus:'completed'})).toBe('Stock up to date');
});
