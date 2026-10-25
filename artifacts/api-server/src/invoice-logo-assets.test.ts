import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { defaultInvoiceSettings, saleWorkspaceTotals, type SaleWorkspaceBranding, type SaleWorkspaceDraft, type SaleWorkspaceRecord } from '@workspace/vehicle-meta';
import { embedInvoiceLogoAsset } from './lib/invoice-logo-assets';
import { PostgresSaleWorkspaceStore, type SaleWorkspaceDatabase } from './lib/sale-workspace-store';

const dealerId = 'shore-drive-logo-fixture';
const origin = 'https://www.shoredrive.uk';
const assetId = '00000000-0000-4000-8000-000000000001';
const otherAssetId = '00000000-0000-4000-8000-000000000002';
const vehicleId = '00000000-0000-4000-8000-000000000003';
const assetPath = `/api/website-assets/${assetId}`;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));
const branding = (logoAsset = ''): SaleWorkspaceBranding => ({
  identity: { name: 'Shore Drive Limited', logoText: 'SHORE DRIVE', logoAsset },
  contact: { phone: '07700 900123', email: 'sales@example.test' },
  address: { street: 'Unit 3, Example Road', city: 'Harrow', region: '', postcode: 'HA2 7LU' },
  legal: { companyName: 'Shore Drive Limited', companyNumber: '', vatNumber: '' },
  invoiceSettings: { ...defaultInvoiceSettings },
});
function image(type: 'png' | 'jpeg' | 'webp' = 'png', colour = '#263d54') {
  const canvas = createCanvas(240, 48), ctx = canvas.getContext('2d');
  ctx.fillStyle = colour; ctx.fillRect(0, 0, 200, 48);
  const bytes = type === 'png' ? canvas.toBuffer('image/png') : canvas.toBuffer(type === 'jpeg' ? 'image/jpeg' : 'image/webp', 90);
  return { bytes, mime_type: `image/${type}`, byte_size: bytes.length, width: 240, height: 48, dataUrl: `data:image/${type};base64,${bytes.toString('base64')}` };
}
function assetClient(row: Record<string, any> | null = image()) {
  const queries: Array<{ text: string; params: any[] }> = [];
  return {
    queries,
    async query(text: string, params: any[] = []) {
      queries.push({ text, params });
      assert.match(text, /FROM dealer_website_assets WHERE dealer_id = \$1 AND id = \$2::uuid/);
      return { rows: params[0] === dealerId && params[1] === assetId && row ? [{ ...row, bytes: Buffer.isBuffer(row.bytes) ? row.bytes.toString('hex') : row.bytes }] : [] };
    },
  };
}

test('same-dealer uploaded PNG and JPEG logos freeze into new branding without changing settings', async () => {
  for (const format of ['png', 'jpeg'] as const) for (const url of [assetPath, `${origin}${assetPath}`]) {
    const logo = image(format), db = assetClient(logo), source = branding(url), before = clone(source);
    const frozen = await embedInvoiceLogoAsset(source, dealerId, db, origin);
    assert.equal(frozen.identity.logoAsset, logo.dataUrl);
    assert.notEqual(frozen, source); assert.notEqual(frozen.identity, source.identity);
    assert.deepEqual(source, before);
    assert.equal(db.queries.length, 1); assert.deepEqual(db.queries[0].params, [dealerId, assetId]);
  }
});

test('WebP website logo becomes a transparent PDF-compatible PNG with its aspect ratio intact', async () => {
  const db = assetClient(image('webp'));
  const result = await embedInvoiceLogoAsset(branding(assetPath), dealerId, db, origin);
  assert.match(result.identity.logoAsset, /^data:image\/png;base64,/);
  const decoded = await loadImage(Buffer.from(result.identity.logoAsset.split(',')[1], 'base64'));
  assert.equal(decoded.width / decoded.height, 5);
  const canvas = createCanvas(decoded.width, decoded.height), ctx = canvas.getContext('2d'); ctx.drawImage(decoded, 0, 0);
  assert.equal(ctx.getImageData(230, 24, 1, 1).data[3], 0);
});

test('valid embedded PNG and JPEG logos are preserved byte-for-byte without an asset query', async () => {
  for (const format of ['png', 'jpeg'] as const) {
    const logo = image(format), db = assetClient();
    assert.equal((await embedInvoiceLogoAsset(branding(logo.dataUrl), dealerId, db, origin)).identity.logoAsset, logo.dataUrl);
    assert.equal(db.queries.length, 0);
  }
});

test('the legacy inline JPG spelling is canonicalised to a PDF-compatible JPEG data URL', async () => {
  const logo = image('jpeg'), db = assetClient();
  const source = logo.dataUrl.replace('data:image/jpeg;', 'data:image/jpg;');
  const frozen = await embedInvoiceLogoAsset(branding(source), dealerId, db, origin);
  assert.equal(frozen.identity.logoAsset, logo.dataUrl);
  assert.equal(db.queries.length, 0);
});

test('an external, credential-bearing, altered, local-file or malformed logo URL never triggers a read or fetch', async () => {
  for (const url of [
    `https://other.example.test${assetPath}`, `https://www.shoredrive.uk.evil.example${assetPath}`, `http://www.shoredrive.uk${assetPath}`,
    `https://user:pass@www.shoredrive.uk${assetPath}`, `${origin}${assetPath}?v=1`, `${origin}${assetPath}#logo`,
    `${origin}/api/website-assets/not-a-uuid`, `//www.shoredrive.uk${assetPath}`, '/etc/passwd', 'file:///etc/passwd',
    `${origin}/private/logo.png`, `${assetPath}/extra`, `${assetPath}?v=1`, 'data:image/svg+xml;base64,PHN2Zy8+',
  ]) {
    const db = assetClient(), source = branding(url);
    const result = await embedInvoiceLogoAsset(source, dealerId, db, origin);
    assert.equal(result.identity.logoAsset, '', url); assert.equal(result.identity.name, source.identity.name);
    assert.equal(db.queries.length, 0, url);
  }
});

test('unknown assets and assets owned by another dealership use the dealer-name fallback', async () => {
  for (const [owner, url] of [[dealerId, `/api/website-assets/${otherAssetId}`], ['different-dealer', assetPath]] as const) {
    const db = assetClient();
    assert.equal((await embedInvoiceLogoAsset(branding(url), owner, db, origin)).identity.logoAsset, '');
    assert.equal(db.queries.length, 1); assert.equal(db.queries[0].params[0], owner);
  }
  assert.equal((await embedInvoiceLogoAsset(branding(assetPath), dealerId, assetClient(null), origin)).identity.logoAsset, '');
});

test('oversized, unsupported, corrupt or inconsistent stored image data cannot enter an invoice', async () => {
  const logo = image();
  const corrupt = Buffer.concat([logo.bytes.subarray(0, 33), logo.bytes.subarray(-12)]);
  for (const bad of [
    { ...logo, mime_type: 'image/svg+xml' }, { ...logo, byte_size: 2_097_153 }, { ...logo, byte_size: logo.byte_size - 1 },
    { ...logo, width: logo.width + 1 }, { ...logo, height: 0 }, { ...logo, bytes: 'not-hex' },
    { ...logo, bytes: corrupt, byte_size: corrupt.length }, { ...logo, bytes: Buffer.alloc(20), byte_size: 20 },
  ]) {
    const result = await embedInvoiceLogoAsset(branding(assetPath), dealerId, assetClient(bad), origin);
    assert.equal(result.identity.logoAsset, '');
  }
});

test('bad embedded data and disabled invoice logos fall back safely without a database read', async () => {
  const logo = image();
  for (const url of ['data:image/png;base64,AAAA===', 'data:image/png;base64,AAAA\n', `data:image/jpeg;base64,${logo.bytes.toString('base64')}`, `data:image/png;base64,${Buffer.alloc(2_097_153).toString('base64')}`, `data:image/png;base64,${logo.bytes.subarray(0, -12).toString('base64')}`]) {
    const db = assetClient();
    assert.equal((await embedInvoiceLogoAsset(branding(url), dealerId, db, origin)).identity.logoAsset, '');
    assert.equal(db.queries.length, 0);
  }
  const source = branding(assetPath); source.invoiceSettings!.showLogo = false;
  const db = assetClient(); assert.equal((await embedInvoiceLogoAsset(source, dealerId, db, origin)).identity.logoAsset, '');
  assert.equal(db.queries.length, 0);
});

function saleFixture() {
  let records = new Map<string, SaleWorkspaceRecord>(), numbers: Record<string, number> = {};
  let currentLogo = '', currentImage = image();
  let vehicle = { inventory_status: 'available', source_status: 'live', source_price: 12000, audit_metadata: { original: 'unchanged' } };
  const logoQueries: any[][] = [];
  const query = async (q: string, p: any[] = []) => {
    if (q.includes('FROM dealer_website_assets')) {
      logoQueries.push(p); assert.deepEqual(p, [dealerId, assetId]);
      return { rows: [{ ...currentImage, bytes: currentImage.bytes.toString('hex') }] };
    }
    if (q.startsWith('SELECT numbers')) return { rows: [{ numbers: clone(numbers) }] };
    if (q.startsWith('SELECT inventory_status')) return { rows: [clone(vehicle)] };
    if (q.startsWith('SELECT id FROM leads')) return { rows: [] };
    if (q.startsWith('SELECT state') && q.includes('FROM sale_workspace')) {
      let values = [...records.values()];
      if (q.includes("state->'requests'")) values = values.filter(row => row.requests?.[p[1]]);
      else if (q.includes('id = $2')) values = values.filter(row => row.id === p[1]);
      return { rows: values.map(state => ({ state: clone(state) })) };
    }
    if (q.startsWith('SELECT id FROM sale_workspace')) return { rows: [] };
    if (q.startsWith('INSERT INTO sale_workspace (')) records.set(p[0], JSON.parse(p[4]));
    if (q.startsWith('UPDATE sale_workspace SET')) records.set(p[1], JSON.parse(p[3]));
    if (q.startsWith('UPDATE sale_workspace_counters')) numbers = JSON.parse(p[1]);
    if (q.startsWith('UPDATE vehicles SET inventory_status')) vehicle = { ...vehicle, inventory_status: p[2], audit_metadata: JSON.parse(p[3]) };
    return { rows: [] };
  };
  const database: SaleWorkspaceDatabase = { query, connect: async () => {
    const before = { records: clone([...records.entries()]), numbers: clone(numbers), vehicle: clone(vehicle) };
    return { query: async (q, p) => { if (q === 'ROLLBACK') { records = new Map(before.records); numbers = before.numbers; vehicle = before.vehicle; } return query(q, p); }, release() {} };
  } };
  const store = new PostgresSaleWorkspaceStore(dealerId, async () => ({ branding: branding(currentLogo), paperwork: { saleTerms: 'Approved terms.', reservationTerms: 'Approved reservation terms.' } }), database);
  return { store, logoQueries, saved: (id: string) => clone(records.get(id)!), setLogo(url: string, next = image()) { currentLogo = url; currentImage = next; } };
}
const draft = (): SaleWorkspaceDraft => ({ id: '', customer: 'Fictional logo-test buyer', email: 'buyer@example.test', phone: '', address: '1 Example Road', vehicleId, vehicle: '2020 Test Car', registration: 'AB20 XYZ', price: '12000', partExchange: false, pxRegistration: '', pxDescription: '', pxValue: '', deposit: '', paymentMethod: '', notes: '', collection: '', preparation: false, documents: false, handover: false });

test('a new deposit/full invoice embeds the current logo while old issued PDFs and the payment ledger remain frozen', async () => {
  const f = saleFixture();
  let sale = (await f.store.mutate({ draft: draft(), requestId: randomUUID(), actor: 'Fixture staff' })).sale;
  sale = (await f.store.mutate({ id: sale.id, expectedRevision: sale.revision, requestId: randomUUID(), actor: 'Fixture staff', command: { action: 'invoice-payment', payment: { amount: '500', method: 'Cash', date: new Date().toISOString().slice(0, 10), reference: 'ALREADY-RECEIVED', kind: 'deposit', status: 'confirmed' } } })).sale;
  sale = (await f.store.mutate({ id: sale.id, expectedRevision: sale.revision, requestId: randomUUID(), actor: 'Fixture staff', command: { action: 'issue-invoice', kind: 'deposit', acknowledge: true } })).sale;
  const oldDocument = clone(sale.documents[0]), oldArchive = clone((await f.store.pdf(sale.id, oldDocument.id)).archive), payments = clone(sale.payments);
  assert.equal(f.logoQueries.length, 0);
  const logo = image(); f.setLogo(assetPath, logo);
  sale = (await f.store.mutate({ id: sale.id, expectedRevision: sale.revision, requestId: randomUUID(), actor: 'Fixture staff', command: { action: 'update', draft: { ...sale.draft, notes: 'Notes reviewed without touching money.' } } })).sale;
  assert.equal(f.logoQueries.length, 0, 'saving a draft must not hydrate old issued documents');
  const input = { id: sale.id, expectedRevision: sale.revision, requestId: randomUUID(), actor: 'Fixture staff', command: { action: 'issue-invoice' as const, kind: 'full' as const, acknowledge: true } };
  const issued = await f.store.mutate(input), fresh = issued.sale.documents.at(-1)!;
  assert.equal(fresh.snapshot.branding.identity.logoAsset, logo.dataUrl);
  assert.deepEqual(issued.sale.documents[0], oldDocument); assert.deepEqual(issued.sale.payments, payments);
  assert.equal(saleWorkspaceTotals(issued.sale.draft, issued.sale.payments).confirmedPaid, 50000);
  assert.equal(saleWorkspaceTotals(issued.sale.draft, issued.sale.payments).balance, 1150000);
  assert.deepEqual((await f.store.pdf(sale.id, oldDocument.id)).archive, oldArchive);
  const freshArchive = clone((await f.store.pdf(sale.id, fresh.id)).archive);
  const pdf = Buffer.from(freshArchive.content, 'base64').toString('latin1');
  assert.match(pdf, /\/Subtype \/Image\b/);
  const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf); assert.ok(box);
  assert.ok(Math.abs(Number(box[1]) - 595.28) < 0.01); assert.ok(Math.abs(Number(box[2]) - 841.89) < 0.01);
  assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 1);
  assert.equal(f.logoQueries.length, 1);
  f.setLogo(assetPath, image('png', '#a62036'));
  const replay = await f.store.mutate(input);
  assert.equal(replay.replayed, true); assert.equal(f.logoQueries.length, 1, 'an idempotent retry must not re-read changed branding');
  assert.deepEqual(replay.sale.payments, payments); assert.deepEqual((await f.store.pdf(sale.id, fresh.id)).archive, freshArchive);
  assert.deepEqual((await f.store.pdf(sale.id, oldDocument.id)).archive, oldArchive);
  assert.deepEqual(f.saved(sale.id).documentArchives?.[fresh.id], freshArchive);
});

test('both newly issued deposit and full invoices archive the logo without adding or changing any payment', async () => {
  for (const kind of ['deposit', 'full'] as const) {
    const f = saleFixture(), logo = image(); f.setLogo(assetPath, logo);
    let sale = (await f.store.mutate({ draft: draft(), requestId: randomUUID(), actor: 'Fixture staff' })).sale;
    sale = (await f.store.mutate({ id: sale.id, expectedRevision: sale.revision, requestId: randomUUID(), actor: 'Fixture staff', command: { action: 'invoice-payment', payment: { amount: '500', method: 'Cash', date: new Date().toISOString().slice(0, 10), reference: 'EXISTING-MONEY', kind: 'deposit', status: 'confirmed' } } })).sale;
    const before = clone(sale.payments);
    assert.equal(f.logoQueries.length, 0);
    const issued = await f.store.mutate({ id: sale.id, expectedRevision: sale.revision, requestId: randomUUID(), actor: 'Fixture staff', command: { action: 'issue-invoice', kind, acknowledge: true } });
    assert.deepEqual(issued.sale.payments, before);
    const doc = issued.sale.documents.at(-1)!;
    assert.equal(doc.invoiceKind, kind); assert.equal(doc.snapshot.branding.identity.logoAsset, logo.dataUrl);
    assert.deepEqual(doc.snapshot.payments, before);
    const pdf = Buffer.from((await f.store.pdf(sale.id, doc.id)).archive.content, 'base64').toString('latin1');
    assert.match(pdf, /\/Subtype \/Image\b/);
    assert.equal((pdf.match(/\/Type \/Page\b/g) ?? []).length, 1);
    assert.equal(f.logoQueries.length, 1);
  }
});
