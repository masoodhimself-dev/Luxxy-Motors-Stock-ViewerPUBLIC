import assert from 'node:assert/strict';
import test from 'node:test';
import { shareRequestOrigin } from './lib/share-origin';
import { runWithTenant } from './lib/tenant-context';
import { buildMissingVehicleSharePreview, renderSharePreviewHtml } from './lib/share-preview';

const request = (host: string, forwarded = 'evil.example', protocol = 'javascript') => ({ secure: false, get: (name: string) => ({ host, 'x-forwarded-host': forwarded, 'x-forwarded-proto': protocol } as Record<string, string>)[name] });
const tenant = { dealerId: 'dealer-a', canonicalOrigin: 'https://dealer-a.example', platform: 'autotrader' as const, retailerId: 'fictional', sourceUrl: 'https://www.autotrader.co.uk/fictional' };
test('shared vehicle metadata and browser redirects ignore forged forwarding headers and retain the tenant canonical origin', () => {
  runWithTenant(tenant, () => {
    const origin = shareRequestOrigin(request('www.dealer-a.example'));
    assert.equal(origin, tenant.canonicalOrigin);
    const preview = renderSharePreviewHtml(buildMissingVehicleSharePreview({ vehicleId: 'fictional-car', dealer: { name: 'Dealer A' }, origin }));
    assert.match(preview, /https:\/\/dealer-a\.example\/vehicle\/fictional-car/);
    assert.doesNotMatch(preview, /evil\.example|javascript:/);
  });
  for (const bad of ['http://dealer-a.example', 'https://user:secret@dealer-a.example', 'https://dealer-a.example/path', 'https://dealer-a.example:444']) {
    assert.throws(() => runWithTenant({ ...tenant, canonicalOrigin: bad }, () => shareRequestOrigin(request('dealer-a.example'))));
  }
});
test('standalone share links preserve an approved public origin or a validated local LAN origin', () => {
  const oldOrigin = process.env.PUBLIC_SITE_URL, oldMode = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development'; delete process.env.PUBLIC_SITE_URL;
    assert.equal(shareRequestOrigin(request('192.168.1.114:4175')), 'http://192.168.1.114:4175');
    assert.equal(shareRequestOrigin(request('[::1]:4175')), 'http://[::1]:4175');
    for (const bad of ['', 'dealer.example/path', 'user@dealer.example', 'dealer.example,evil.example']) assert.throws(() => shareRequestOrigin(request(bad)));
    process.env.NODE_ENV = 'production'; process.env.PUBLIC_SITE_URL = 'https://approved.example';
    assert.equal(shareRequestOrigin(request('evil.example')), 'https://approved.example');
    delete process.env.PUBLIC_SITE_URL; assert.throws(() => shareRequestOrigin(request('dealer.example')));
  } finally {
    if (oldOrigin === undefined) delete process.env.PUBLIC_SITE_URL; else process.env.PUBLIC_SITE_URL = oldOrigin;
    if (oldMode === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = oldMode;
  }
});
