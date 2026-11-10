import { test, expect, type Page } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Only runs against the isolated local fixture preview.');
const origin = 'http://127.0.0.1:4294';
const output = process.env.INBOX_REBUILD_OUTPUT || '/Users/masoodhaqdad/Documents/ChatGPT/Offline POS KDS system/output/inbox-rebuild-2026-11-02';
const ids = {
  cazoo: '00000000-0000-4000-8000-000000009801',
  website: '00000000-0000-4000-8000-000000009802',
  booking: '00000000-0000-4000-8000-000000009803',
  closed: '00000000-0000-4000-8000-000000009804',
  reply: '00000000-0000-4000-8000-000000009805',
};

test.afterEach(async ({ page }, info) => {
  if (info.status !== info.expectedStatus && !page.isClosed()) {
    await mkdir(output, { recursive: true });
    await page.screenshot({ path: path.join(output, `${info.project.name}-failure.png`), fullPage: true }).catch(() => {});
  }
});

async function fits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page should not scroll sideways').toBe(true);
  expect(await page.locator('.inbox-desk').evaluate(element => element.getBoundingClientRect().right <= innerWidth + 1)).toBe(true);
}

async function leaveMessage(page: Page, action: () => Promise<void>, accept: boolean) {
  const shown = page.waitForEvent('dialog', { timeout: 5_000 });
  const clicked = action();
  const dialog = await shown;
  expect(dialog.type()).toBe('confirm');
  expect(dialog.message()).toMatch(/unsaved customer message or note/i);
  if (accept) await dialog.accept(); else await dialog.dismiss();
  await clicked;
}

test('one Inbox handles website, Cazoo and bookings with direct reply and on-demand car tools', async ({ page, request }, info) => {
  const archived = await (await request.get('/api/stock')).json();
  const settings = await (await request.get('/api/dealer-settings')).json();
  const car = { ...archived.cars[0], title: 'Audi A5', make: 'Audi', model: 'A5', plate: 'MW62VLP', registration: 'MW62VLP', price: 5490,
    inventoryStatus: 'available', heroImage: '/src/assets/demo-car-hero.jpg', images: [{ url: '/src/assets/demo-car-hero.jpg', caption: 'Front view' }] };
  const at = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  const record = (id: string, customerName: string, extra: Record<string, unknown> = {}) => ({
    id, reference: `TEST-${id.slice(-4)}`, dealerId: 'fictional-browser-inbox', customerName,
    email: `${id.slice(-4)}@example.test`, phone: '07700900123', preferredContact: 'email',
    vehicleId: car.id, vehicleTitle: car.title, vehicleRegistration: car.plate, vehiclePrice: car.price,
    vehicleUrl: `/vehicle/${car.id}`, type: 'general', source: 'website', status: 'new', message: 'Is this car still available?',
    createdAt: at(25), updatedAt: at(25), workspaceRevision: 1, followUpRevision: 1, appointmentRevision: 1,
    staffNote: null, assignedToId: 'preview-alex', assignedToName: 'Alex', attendance: 'scheduled',
    appointmentAt: null, appointmentStatus: null, appointmentCancelledAt: null, followUpAt: null, followUpCompletedAt: null,
    events: [], ...extra,
  });
  const bookingAt = new Date(); bookingAt.setHours(11, 0, 0, 0); bookingAt.setDate(bookingAt.getDate() + 1);
  const records = [
    record(ids.cazoo, 'Ellie Carter', { source: 'cazoo', aiProvider:'cazoo',aiDraftStatus:'ready', message: 'Would you consider £4,000? I would like to see the Audi.', createdAt: at(5), updatedAt: at(5) }),
    record(ids.website, 'Sam Patel', { type: 'part_exchange', partExchangeRegistration: 'AB12CDE', partExchangeMileage: 45000, message: 'Can I part exchange my Ford Fiesta?' }),
    record(ids.booking, 'Alex Morgan', { type: 'viewing', appointmentAt: bookingAt.toISOString(), appointmentStatus: 'pending', appointmentDurationMinutes: 60, message: 'Please book a test drive tomorrow.' }),
    record(ids.closed, 'Jamie Wood', { status: 'closed', callOutcome: 'not_interested', message: 'Thank you, I have bought another car.', createdAt: at(1440), updatedAt: at(60) }),
  ];
  const errors: string[] = [], unexpectedWrites: string[] = [], external: string[] = [], previews: Record<string, unknown>[] = [], savedDrafts: Record<string, unknown>[] = [];
  let failEnquiryReads = false;
  let linkedReply = false;
  let repliesConnected = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.context().route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname;
    if (url.origin !== origin) { external.push(url.origin); await route.abort(); return; }
    if (!p.startsWith('/api/')) { await route.continue(); return; }
    if (p.startsWith('/api/staff/workspace/presence/')) { await route.fulfill({ json: { presence: null } }); return; }
    if (!['GET', 'HEAD'].includes(req.method())) {
      if(p===`/api/staff/enquiries/${ids.cazoo}/archive`||p===`/api/staff/enquiries/${ids.cazoo}/restore`){
        const entry=records.find(item=>item.id===ids.cazoo)!;
        expect(req.postDataJSON().expectedRevision).toBe(entry.workspaceRevision);
        const archiving=p.endsWith('/archive');
        Object.assign(entry,{workspaceRevision:entry.workspaceRevision+1,archivedAt:archiving?at(0):null,archiveDeleteAt:archiving?new Date(Date.now()+30*86400000).toISOString():null,archiveHoldReason:null});
        await route.fulfill({json:entry});return;
      }
      if (p === `/api/staff/enquiries/${ids.cazoo}/email-draft`) {
        savedDrafts.push(req.postDataJSON().content);
        await route.fulfill({ json: { version: 1 + savedDrafts.length } }); return;
      }
      if (p === `/api/staff/enquiries/${ids.cazoo}/email-preview`) {
        const body = req.postDataJSON(); previews.push(body);
        await route.fulfill({ json: { to: body.to, subject: body.subject, text: body.message, from: 'Multi Choice Motors <sales@example.test>', repliesInInbox: repliesConnected, previewHash: 'a'.repeat(64), attachments: body.attachVehiclePdf ? [{ id: `vehicle-pdf:${car.id}`, filename: 'Audi-A5-MW62VLP.pdf', byteSize: 12000 }] : [] } });
        return;
      }
      unexpectedWrites.push(`${req.method()} ${p}`);
      await route.fulfill({ status: 405, json: { error: 'Read-only local Inbox browser audit: nothing was saved or sent.' } }); return;
    }
    if (p === '/api/staff/mot-history' && linkedReply) {
      expect(url.searchParams.get('registration')).toBe('PX12ABC');
      await route.fulfill({ json: { status: 'available', history: {
        registration: 'PX12ABC', make: 'Ford', model: 'Focus', checkedAt: at(0), recall: 'Unknown',
        tests: [{ result: 'PASSED', completedDate: '2026-05-19', expiryDate: '2027-05-18', mileage: '132000', mileageUnit: 'MI', defects: [] }],
      } } });
      return;
    }
    if (p === '/api/stock') { await route.fulfill({ json: { ...archived, cars: [car], count: 1 } }); return; }
    if (p === '/api/dealer-settings') { await route.fulfill({ json: settings }); return; }
    if (p === '/api/enquiries' || p === '/api/test-drive-bookings') {
      if (p === '/api/enquiries' && failEnquiryReads) { await route.fulfill({ status: 503, json: { error: 'Fictional background refresh failure' } }); return; }
      await route.fulfill({ json: p === '/api/enquiries' ? records : records.filter(entry => entry.type === 'viewing') }); return;
    }
    if (p === '/api/staff/email/reply-attention') { await route.fulfill({ json: url.searchParams.has('enquiryId') ? { pending: 0, review: 0 } : { enquiries: [] } }); return; }
    if (p === '/api/staff/email') {
      const messages = linkedReply && url.searchParams.get('enquiryId') === ids.cazoo
        ? [{
            key: `reply:${ids.reply}`, kind: 'reply', enquiry_id: ids.cazoo, status: 'reply_needed',
            subject: 'Re: Your Audi A5 enquiry', message: 'Could I bring my part exchange on Saturday?',
            created_at: at(0),
          }]
        : [];
      await route.fulfill({ json: { messages, hasMore: false } });
      return;
    }
    if (p === '/api/staff/email-drafts') { await route.fulfill({ json: { drafts: [], hasMore: false } }); return; }
    if (/\/conversations$/.test(p)) { await route.fulfill({ json: { events: [], total: 0, nextCursor: null } }); return; }
    if(p.endsWith('/ai-checks')){await route.fulfill({json:{requestId:'fixture-ai-check',model:'gpt-6-luna',createdAt:at(4),contextAudit:{checkedAt:at(4),questions:[{question:'What is the MOT history?',topic:'mot',outcome:'unavailable',source:'DVSA MOT history',checkedAt:at(4)},{question:'Parking sensors?',topic:'equipment',outcome:'not_recorded',source:'Published vehicle listing',checkedAt:at(4)}],lookups:[{kind:'mot',status:'unavailable',source:'DVSA MOT history',checkedAt:at(4),errorCode:'not_found'}]}}});return;}
    if (/\/email-context$/.test(p)) {
      const entry = records.find(item => p.includes(item.id))!;
      const content = { to: entry.email, subject: 'Your Audi A5 enquiry', message: 'Hi Ellie, thank you for your offer. Our sales team will review it and get back to you.', includeVehicle: false, attachVehiclePdf: false, includeAppointment: false, photoIds: [], documentIds: [], vehiclePhotoIndices: [], expectedRevision: 1 };
      const replyId = url.searchParams.get('enquiryReplyId');
      await route.fulfill({ json: { version: entry.id === ids.cazoo ? 1 : 0, savedDraft: entry.id === ids.cazoo ? { version: 1, status: 'draft', source: 'ai', content, updatedAt: at(4) } : null,
        ...(replyId === ids.reply ? { replyRecipient: { id: ids.reply, from: 'ellie.corrected@example.test', subject: 'Re: Your Audi A5 enquiry' } } : {}),
        email: entry.email, customerName: entry.customerName, vehicleId: car.id, vehicleTitle: car.title, reference: entry.reference, revision: 1,
        vehicleAvailable: true, vehiclePdfAvailable: true, appointmentAvailable: !!entry.appointmentAt, defaults: { subject: 'Your enquiry', message: '' }, ready: linkedReply, photos: [], vehiclePhotos: [], invoices: [], deliveries: [], templates: [] } }); return;
    }
    if (p === '/api/staff/ai/status') { await route.fulfill({ json: { enabled: false, remaining: 0, limit: 10 } }); return; }
    await route.continue();
  });

  await page.goto('/portal?section=notifications&workView=customers');
  const desk = page.getByRole('region', { name: 'Inbox conversations', exact: true });
  await expect(desk).toBeVisible();
  if (info.project.use.viewport!.width >= 900) {
    const pinned = page.getByRole('article', { name: 'Customer workspace for Alex Morgan', exact: true });
    const pinnedMessage = pinned.getByRole('textbox', { name: 'Message', exact: true });
    await expect(pinnedMessage).toHaveCount(0);
    await pinned.getByRole('button', { name: 'Reply', exact: true }).click();
    await expect(pinnedMessage).toBeVisible();
    await pinnedMessage.fill('Keep this unsaved message during a failed background refresh.');
    failEnquiryReads = true;
    await desk.getByRole('button', { name: 'Refresh inbox', exact: true }).click();
    await expect(desk.getByRole('alert').filter({ hasText: 'Your conversation and draft are kept' })).toBeVisible({ timeout: 15_000 });
    await expect(pinnedMessage).toHaveValue('Keep this unsaved message during a failed background refresh.');
    failEnquiryReads = false;
    await desk.getByRole('button', { name: 'Retry update', exact: true }).click();
    await expect(desk.getByRole('alert').filter({ hasText: 'Your conversation and draft are kept' })).toHaveCount(0);
    await expect(pinnedMessage).toHaveValue('Keep this unsaved message during a failed background refresh.');
    await leaveMessage(page, () => desk.locator('[data-filter="all"]').click(), true);
  }
  await desk.locator('[data-filter="all"]').click();
  await expect(desk.getByRole('button', { name: 'Open enquiry for Ellie Carter, Audi A5', exact: true })).toBeVisible();
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, `${info.project.name}-queue.png`), fullPage: true });
  await desk.getByRole('tab',{name:'AI enquiries',exact:true}).click();
  await expect(desk.getByRole('button', { name: 'Open enquiry for Ellie Carter, Audi A5', exact: true })).toBeVisible();
  await expect(desk.locator('.inbox-source').filter({ hasText: 'Cazoo' })).toBeVisible();
  await expect(desk.locator('.inbox-status').filter({ hasText: 'Needs you' }).first()).toBeVisible();
  expect(await desk.getByRole('textbox', { name: 'Search enquiries', exact: true }).evaluate(element => getComputedStyle(element).borderTopWidth)).toBe('0px');
  const filterBounds = await desk.locator('[aria-label="Filter conversations"]').boundingBox();
  for (const button of await desk.locator('[data-filter]').all()) {
    const bounds = await button.boundingBox();
    expect(bounds!.x + bounds!.width <= filterBounds!.x + filterBounds!.width + 1, 'All primary filters fit without horizontal scrolling').toBe(true);
  }
  await fits(page);
  await mkdir(output, { recursive: true });
  await page.screenshot({ path: path.join(output, `${info.project.name}-inbox.png`), fullPage: true });

  await desk.getByRole('button', { name: 'Open enquiry for Ellie Carter, Audi A5', exact: true }).click();
  const customer = page.getByRole('article', { name: 'Customer workspace for Ellie Carter', exact: true });
  await expect(customer).toBeVisible();
  await expect(customer.getByRole('complementary', { name: 'Vehicle and checks', exact: true })).toHaveCount(0);
  const message = customer.getByRole('textbox', { name: 'Message', exact: true });
  await expect(message).toHaveCount(0);
  await page.screenshot({ path: path.join(output, `${info.project.name}-case.png`), fullPage: true });
  await customer.getByRole('button', { name: /^(?:Review draft|Reply)$/ }).click();
  await expect(message).toHaveValue(/thank you for your offer/);
  await message.fill('Unsaved message that must not disappear without confirmation.');
  await expect(message).toHaveValue('Unsaved message that must not disappear without confirmation.');
  const mobile = info.project.use.viewport!.width < 900;
  const leaveAction = () => mobile
    ? desk.getByRole('button', { name: 'Back to Inbox', exact: true }).click()
    : desk.getByRole('tab', { name: /^Enquiries/ }).click();
  await leaveMessage(page, leaveAction, false);
  await expect(customer).toBeVisible();
  await expect(message).toHaveValue('Unsaved message that must not disappear without confirmation.');
  await leaveMessage(page, leaveAction, true);
  await expect(page.locator('[aria-label="Customer workspace for Ellie Carter"]')).toHaveCount(0);
  await expect(page.locator('textarea').filter({ hasText: 'Unsaved message that must not disappear without confirmation.' })).toHaveCount(0);
  await desk.getByRole('tab',{name:'AI enquiries',exact:true}).click();
  await desk.getByRole('button', { name: 'Open enquiry for Ellie Carter, Audi A5', exact: true }).click();
  await customer.getByRole('button', { name: /^(?:Review draft|Reply)$/ }).click();
  await expect(message).toHaveValue(/thank you for your offer/);
  await expect(message).not.toHaveValue(/Unsaved message that must not disappear/);
  await message.fill('Hi Ellie, thank you for your offer. I can help with the Audi.');
  await expect(message).toHaveValue('Hi Ellie, thank you for your offer. I can help with the Audi.');
  await customer.getByRole('button', { name: 'Details', exact: true }).click();
  const tools = page.getByRole('dialog', { name: 'Enquiry details', exact: true });
  await expect(tools).toBeVisible();
  await expect(tools.getByRole('button', { name: /MOT history/ })).toBeVisible();
  await fits(page);
  await page.screenshot({ path: path.join(output, `${info.project.name}-car-tools.png`), fullPage: true });
  await tools.getByRole('button', { name: 'Close details', exact: true }).click();
  await expect(message).toHaveValue('Hi Ellie, thank you for your offer. I can help with the Audi.');
  if (mobile) {
    expect((await message.boundingBox())!.height, 'Compact phone message field').toBeLessThanOrEqual(125);
  }
  if (!mobile) {
    const sendBounds=await customer.getByRole('button',{name:'Review & send',exact:true}).boundingBox();
    expect(sendBounds!.y+sendBounds!.height <= info.project.use.viewport!.height, 'Review action stays in the desktop viewport').toBe(true);
  }
  await page.screenshot({ path: path.join(output, `${info.project.name}-reply.png`), fullPage: true });
  await customer.getByRole('button', { name: 'Attach', exact: true }).click();
  await customer.getByRole('checkbox', { name: /Attach vehicle PDF/ }).check();
  await customer.getByRole('button', { name: 'Attach', exact: true }).click();
  await customer.getByRole('button', { name: 'Review & send', exact: true }).click();
  await expect(customer.getByText('Audi-A5-MW62VLP.pdf', { exact: false })).toBeVisible();
  expect(previews).toHaveLength(1); expect(previews[0].attachVehiclePdf).toBe(true);
  expect(savedDrafts).toHaveLength(1); expect(savedDrafts[0].attachVehiclePdf).toBe(true);
  expect(previews[0].message).toBe('Hi Ellie, thank you for your offer. I can help with the Audi.');
  await fits(page);
  await page.screenshot({ path: path.join(output, `${info.project.name}-conversation.png`), fullPage: true });

  if (info.project.use.viewport!.width < 900) {
    // Real browser history must clear the explicit selection as well as the
    // on-screen Back button. The reviewed draft is already saved in memory.
    await page.goBack();
    await expect(page).not.toHaveURL(/enquiryId=/);
    await expect(desk.locator('.inbox-desk-list')).toBeVisible();
    await expect(desk.getByRole('tab',{name:'AI enquiries',exact:true})).toHaveAttribute('aria-selected','true');
    await expect(desk.locator('[data-filter="needs-you"]')).toHaveAttribute('aria-pressed', 'true');
  }
  await page.goto('/portal?section=notifications&workView=customers');
  await desk.getByRole('tab',{name:/^Enquiries/}).click();
  await desk.locator('.inbox-tools-menu > summary').click();
  await desk.getByRole('button', { name: 'Test drives', exact: true }).click();
  await expect(desk.getByRole('button', { name: 'Open enquiry for Alex Morgan, Audi A5', exact: true })).toBeVisible();
  await desk.getByRole('button', { name: 'Open enquiry for Alex Morgan, Audi A5', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Customer workspace for Alex Morgan', exact: true }).getByText(/requested|request|approval/i).first()).toBeVisible();
  await fits(page);
  await page.goto('/portal?section=notifications&workView=test-drives&deskView=calendar');
  await expect(page.getByRole('region', { name: 'Appointment calendar', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.goto('/portal?section=enquiries&enquiryId=' + ids.cazoo);
  await expect(page.getByRole('article', { name: 'Customer workspace for Ellie Carter', exact: true })).toBeVisible();
  await expect(desk.locator('.inbox-folder-tabs [aria-selected=true]')).toHaveText('Enquiries');
  const finalCase=page.getByRole('article',{name:'Customer workspace for Ellie Carter',exact:true});
  await finalCase.getByRole('button',{name:'Details',exact:true}).click();
  const finalDetails = page.getByRole('dialog',{name:'Enquiry details',exact:true});
  await finalDetails.getByRole('button',{name:'Activity',exact:true}).click();
  await finalDetails.getByText('What AI checked',{exact:true}).click();
  await expect(finalDetails.getByText('Could not verify',{exact:true})).toBeVisible();
  await page.screenshot({path:path.join(output,`${info.project.name}-ai-checks.png`),fullPage:true});
  await finalDetails.getByRole('button',{name:'Close details',exact:true}).click();
  await finalCase.getByRole('button',{name:'More enquiry actions',exact:true}).click();
  await page.getByRole('menuitem',{name:'Archive enquiry',exact:true}).click();
  await page.getByRole('alertdialog').getByRole('button',{name:'Archive enquiry',exact:true}).click();
  await expect(finalCase.getByRole('region',{name:'Archived enquiry',exact:true})).toBeVisible();
  await expect(finalCase.getByRole('textbox',{name:'Message',exact:true})).toHaveCount(0);
  await page.screenshot({path:path.join(output,`${info.project.name}-archived.png`),fullPage:true});
  await finalCase.getByRole('button',{name:'Restore enquiry',exact:true}).click();
  await expect(finalCase.getByRole('button',{name:/^(?:Review draft|Reply)$/})).toBeVisible();
  linkedReply = true;
  const original = records.find(item => item.id === ids.cazoo)!;
  Object.assign(original, {
    email: '', type: 'part_exchange', partExchangeRegistration: 'PX12 ABC', partExchangeMileage: 140000,
  });
  const replyLink = `/portal?section=notifications&workView=customers&enquiryId=${ids.cazoo}`;
  await page.goto(`${replyLink}&enquiryAction=fix-email`);
  const tradeIn = finalCase.getByRole('region', { name: 'Part exchange', exact: true });
  await expect(tradeIn.getByText(/140,000 miles reported by customer/)).toBeVisible();
  await expect(tradeIn.getByText(/Ford Focus · Recorded MOT expiry 18 May 2027/)).toBeVisible();
  const recipient = finalCase.getByRole('textbox', { name: 'Customer email', exact: true });
  await expect(recipient).toBeVisible();
  await expect(recipient).toHaveValue('');
  await fits(page);
  await page.screenshot({ path: path.join(output, `${info.project.name}-linked-reply.png`), fullPage: true });
  await recipient.fill('ellie@example.test');
  await finalCase.getByRole('button', { name: 'Review & send', exact: true }).click();
  const review = finalCase.getByRole('region', { name: 'Email preview' });
  await expect(review.getByText(/Sending from this link is paused/)).toBeVisible();
  await expect(review.getByRole('button', { name: 'Send email', exact: true })).toBeDisabled();
  repliesConnected = true;
  await review.getByRole('button', { name: 'Edit message', exact: true }).click();
  await finalCase.getByRole('button', { name: 'Review & send', exact: true }).click();
  await expect(review.getByText('Customer replies will appear in this conversation.')).toBeVisible();
  await expect(review.getByText('Multi Choice Motors <sales@example.test>')).toBeVisible();
  await expect(review.getByText('ellie@example.test', { exact: true })).toBeVisible();
  await fits(page);
  await page.screenshot({ path: path.join(output, `${info.project.name}-linked-review.png`), fullPage: true });
  Object.assign(original, { email: 'ellie@example.test' });
  await page.goto(`${replyLink}&enquiryAction=reply`);
  await expect(finalCase.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
  await expect(finalCase.getByText('Fix email address', { exact: true })).toBeVisible();
  await expect(finalCase.getByRole('textbox', { name: 'Customer email', exact: true })).not.toBeVisible();
  await page.goto(`${replyLink}&enquiryAction=reply&enquiryReplyId=${ids.reply}`);
  await expect(finalCase.getByText(/This reply came from ellie.corrected@example.test/)).toBeVisible();
  await expect(finalCase.getByText('Could I bring my part exchange on Saturday?', { exact: true })).toBeVisible();
  await expect(finalCase.getByRole('button', { name: 'Review & send', exact: true })).toBeDisabled();
  await finalCase.getByRole('button', { name: 'Use reply address', exact: true }).click();
  await finalCase.getByRole('button', { name: 'Review & send', exact: true }).click();
  await expect(review.getByText('ellie.corrected@example.test', { exact: true })).toBeVisible();
  expect(previews.at(-1)).toMatchObject({ enquiryReplyId: ids.reply, to: 'ellie.corrected@example.test' });
  await fits(page);
  await page.screenshot({ path: path.join(output, `${info.project.name}-forwarded-customer-reply.png`), fullPage: true });
  expect(unexpectedWrites).toEqual([]);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
