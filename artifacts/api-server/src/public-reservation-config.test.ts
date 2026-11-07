import assert from 'node:assert/strict';
import test from 'node:test';
import {
  publicReservationCheckoutSettings,
  publicReservationDepositPence,
  publicReservationStripeSettings,
  publicReservationTerms,
} from './lib/public-reservation-config';
import { isPrivateSeoPath } from './lib/seo-crawl';
import { privateRequestLogUrl } from './middlewares/private-capability';
import type { TenantContext } from './lib/tenant-context';

const tenant: TenantContext = {
  dealerId: 'fictional-dealer',
  canonicalOrigin: 'https://multichoicemotors.co.uk',
  platform: 'cazoo',
  retailerId: 'fictional',
  sourceUrl: 'https://example.test',
  kind: 'website',
};
const keys = {
  MULTICHOICE_RESERVATION_STRIPE_KEY: 'rk_live_FictionalKey',
  MULTICHOICE_RESERVATION_STRIPE_WEBHOOK_SECRET: 'whsec_FictionalSigningSecret',
};
const enabled = { ...keys, MULTICHOICE_RESERVATIONS_ENABLED: 'true' };

test('opens new checkout only for the approved tenant with a deliberate live enable flag', () => {
  assert.equal(publicReservationCheckoutSettings(tenant, keys), undefined);
  assert.equal(publicReservationCheckoutSettings(tenant, { ...enabled, MULTICHOICE_RESERVATION_STRIPE_KEY: 'sk_test_FictionalKey' }), undefined);
  assert.equal(publicReservationCheckoutSettings(tenant, { ...enabled, MULTICHOICE_RESERVATION_STRIPE_WEBHOOK_SECRET: '' }), undefined);
  assert.equal(publicReservationCheckoutSettings({ ...tenant, canonicalOrigin: 'https://other-dealer.example.test' }, enabled), undefined);
  assert.equal(publicReservationCheckoutSettings({ ...tenant, kind: 'import' }, enabled), undefined);
  assert.equal(publicReservationCheckoutSettings({ ...tenant, demo: true }, enabled), undefined);
  assert.equal(publicReservationCheckoutSettings(tenant, enabled)?.mode, 'live');
  assert.equal(publicReservationDepositPence, 9900);
  assert.match(publicReservationTerms, /refund the full £99 to your original payment method/);
});

test('disabling new checkout preserves verification and recovery for existing payments', () => {
  assert.equal(publicReservationCheckoutSettings(tenant, keys), undefined);
  assert.equal(publicReservationStripeSettings(tenant, keys)?.mode, 'live');
  assert.equal(publicReservationStripeSettings({ ...tenant, demo: true }, keys), undefined);
});

test('keeps payment confirmation out of search and strips capability queries from logs', () => {
  assert.ok(isPrivateSeoPath('/reservation-payment'));
  assert.ok(isPrivateSeoPath('/reserve/payment-return'));
  assert.equal(privateRequestLogUrl('/reservation-payment?reference=private&token=secret'), '/reservation-payment');
});
