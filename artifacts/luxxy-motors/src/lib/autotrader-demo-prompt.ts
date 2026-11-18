import { buildStockDemoPrompt } from './cazoo-demo-prompt';

export function buildAutoTraderDemoPrompt(dealer: { sourceUrl: string; retailerId: string }) {
  return buildStockDemoPrompt(dealer, 'autotrader');
}
