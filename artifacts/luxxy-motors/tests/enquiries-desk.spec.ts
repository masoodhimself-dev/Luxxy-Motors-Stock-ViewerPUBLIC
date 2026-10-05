import { expect, test, type Page } from "@playwright/test";

test.skip(
  process.env.LUXXY_LOCAL_PREVIEW !== "1",
  "Mocked local preview only.",
);
const id = "08e3fe3f-35b3-43d0-8e3e-6ca02991d046";
const car = {
  id,
  advertId: "1234567",
  title: "2019 Ford Focus",
  make: "Ford",
  model: "Focus",
  year: 2019,
  price: 10995,
  transmission: "Manual",
  plate: "AB19 XYZ",
  inventoryStatus: "available",
  heroImage: null,
  images: [],
  mileage: 42000, fuel: 'Petrol', sourceExtras: { advertDescription: 'A carefully maintained example with documented servicing.', featureList: ['Heated seats', 'Rear parking sensors'], serviceHistory: 'Full service history', specCategories: [{ category: 'Performance', items: [{ name: 'Engine power', value: '125 BHP' }] }] },
};
const existing = {
  id: "enquiry-one",
  reference: "CALL-123",
  customerName: "Alex Caller",
  phone: "07700 900123",
  email: null,
  vehicleId: id,
  vehicleTitle: car.title,
  vehicleRegistration: car.plate,
  type: "viewing",
  appointmentAt: "2027-01-05T11:00:00Z",
  appointmentRevision: 0,
  appointmentStatus: "confirmed",
  appointmentCancelledAt: null,
  message: "Please prepare the service history.",
};
async function setup(page: Page) {
  await page.route("**/api/**", (route) =>
    ["GET", "HEAD"].includes(route.request().method())
      ? route.continue()
      : route.abort(),
  );
  await page.route("**/api/stock", (route) =>
    route.fulfill({
      json: {
        schemaVersion: 1,
        count: 2,
        cars: [
          car,
          {
            ...car,
            id: "reserved-car",
            title: "Reserved Ford Fiesta",
            model: "Fiesta",
            inventoryStatus: "reserved",
          },
        ],
      },
    }),
  );
  await page.route("**/api/enquiries", (route) =>
    route.fulfill({ json: [existing] }),
  );
  await page.route("**/api/**/availability?*", (route) =>
    route.fulfill({
      json: {
        date: "2027-01-05",
        timezone: "Europe/London",
        slots: [
          {
            startAt: `${new URL(route.request().url()).searchParams.get("date")}T12:00:00Z`,
            label: "12:00",
            available: true,
          },
        ],
      },
    }),
  );
  await page.goto("/portal");
  await page.getByTestId("tab-enquiries").click();
}
for (const width of [390, 820, 1440]) {
  test(`call desk searches stock and saves a phone-only enquiry at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    let payload: any;
    await page.route("**/api/staff/enquiries", (route) => {
      payload = route.request().postDataJSON();
      return route.fulfill({
        status: 201,
        json: {
          ...existing,
          ...payload,
          appointmentStatus: null,
          reference: "CALL-NEW",
          source: "phone",
        },
      });
    });
    await page.getByLabel("Search showroom stock").fill("AB19XYZ");
    await page.getByRole("button", { name: /Ford Focus/ }).click();
    await page.getByLabel("Customer name", { exact: true }).fill("New Caller");
    await page.getByLabel("Phone number", { exact: true }).fill("07700 900456");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
    await page.screenshot({
      path: `/tmp/luxxy-enquiry-desk-${width}.png`,
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Save phone enquiry", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("CALL-NEW saved");
    expect(payload).toMatchObject({
      vehicleId: id,
      customerName: "New Caller",
      email: null,
      preferredContact: "phone",
      type: "general",
      appointmentAt: null,
    });
  });
  test(`call desk moves an appointment with its reviewed revision at ${width}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    let payload: any;
    await page.route(
      "**/api/staff/enquiries/enquiry-one/appointment",
      (route) => {
        payload = route.request().postDataJSON();
        return route.fulfill({
          json: {
            ...existing,
            appointmentAt: payload.appointmentAt,
            appointmentRevision: 1,
          },
        });
      },
    );
    await page
      .getByRole("tab", { name: "Find enquiry or appointment", exact: true })
      .click();
    await page.getByLabel("Find a customer or car").fill("07700900123");
    await page.getByRole("button", { name: "Open enquiry for Alex Caller, CALL-123" }).click();
    await expect(page.getByRole("region", { name: "Selected enquiry: Alex Caller" })).toContainText("Alex Caller");
    await page
      .getByRole("button", { name: "Change appointment", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "12:00", exact: true }).click();
    await page.screenshot({ path: `/tmp/luxxy-enquiry-change-${width}.png` });
    await page
      .getByRole("button", { name: "Save new appointment", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(payload).toEqual({
      action: "reschedule",
      appointmentAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T12:00:00Z$/),
      expectedRevision: 0,
    });
  });
}
test("staff must review an out-of-hours reschedule before it is sent", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  let payload: any;
  await page.route("**/api/staff/enquiries/enquiry-one/appointment", route => {
    payload = route.request().postDataJSON();
    return route.fulfill({ json: { ...existing, appointmentAt: payload.appointmentAt, appointmentOutsideHours: true, appointmentRevision: 1 } });
  });
  await page.getByRole("tab", { name: "Find enquiry or appointment", exact: true }).click();
  await page.getByLabel("Find a customer or car").fill("07700900123");
    await page.getByRole("button", { name: "Open enquiry for Alex Caller, CALL-123" }).click();
  await page.getByRole("button", { name: "Change appointment", exact: true }).click();
  await page.getByRole("button", { name: "Choose a specific UK time" }).click();
  await page.getByLabel("Staff appointment date and time (UK)").fill("2027-01-06T20:00");
  await page.getByLabel("Allow outside normal booking hours or a closed date").check();
  await page.getByRole("button", { name: "Review staff exception" }).click();
  await expect(page.getByRole("dialog", { name: "Review staff booking exception" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  expect(payload).toBeUndefined();
  await page.getByRole("button", { name: "Confirm staff exception" }).click();
  await expect.poll(() => payload).toMatchObject({ action: "reschedule", allowOutsideHours: true, expectedRevision: 0 });
});

test("enquiry stock photos enlarge on hover and show only supplied plate details", async ({ page }) => {
  await setup(page);
  const image = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#346181"/></svg>').toString('base64')}`;
  await page.route("**/api/stock", route => route.fulfill({ json: { schemaVersion: 1, count: 2, cars: [
    { ...car, heroImage: image, colour: "Blue" },
    { ...car, id: "without-plate", title: "2018 Ford Fiesta", model: "Fiesta", heroImage: image, plate: null, vrm: null, registration: "2018 (68 reg)" },
  ] } }));
  await page.reload();
  await page.getByTestId("tab-enquiries").click();
  await page.getByRole("tab", { name: "All cars", exact: true }).click();
  await page.getByRole("img", { name: "Preview Ford Focus" }).hover();
  const preview = page.getByRole("status", { name: "Enlarged photo of Ford Focus" });
  await expect(preview).toContainText("Colour: Blue");
  await expect(preview).toContainText("AB19 XYZ");
  await page.getByRole("img", { name: "Preview 2018 Ford Fiesta" }).hover();
  await expect(page.getByRole("status", { name: "Enlarged photo of 2018 Ford Fiesta" })).toContainText("Number plate not supplied");
  await page.getByRole("button", { name: "View photos of 2018 Ford Fiesta" }).click();
  await expect(page.getByRole("dialog", { name: "2018 Ford Fiesta" })).toBeVisible();
});

test("reserved stock cannot be booked and failed requests retain caller details", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: /Reserved Ford Fiesta/ }).click();
  await page.getByLabel("Book a test drive", { exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Save test-drive booking" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Change selected car" }).click();
  await page.getByRole("button", { name: /Ford Focus/ }).click();
  await page
    .getByLabel("Customer name", { exact: true })
    .fill("Conflict Caller");
  await page.getByLabel("Phone number", { exact: true }).fill("07700900123");
  await page.getByRole("button", { name: "12:00", exact: true }).click();
  await page.route("**/api/staff/enquiries", (route) =>
    route.fulfill({
      status: 409,
      json: { error: "That time has just been booked." },
    }),
  );
  await page.getByRole("button", { name: "Save test-drive booking" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "That time has just been booked.",
  );
  await expect(page.getByLabel("Customer name", { exact: true })).toHaveValue(
    "Conflict Caller",
  );
});
test("cancellation requires a second deliberate action", async ({ page }) => {
  await setup(page);
  let writes = 0;
  await page.route(
    "**/api/staff/enquiries/enquiry-one/appointment",
    (route) => {
      writes++;
      return route.fulfill({
        json: { ...existing, appointmentCancelledAt: new Date().toISOString() },
      });
    },
  );
  await page
    .getByRole("tab", { name: "Find enquiry or appointment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Change appointment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Cancel appointment instead", exact: true })
    .click();
  expect(writes).toBe(0);
  await page
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("appointment cancelled");
  expect(writes).toBe(1);
});

for (const width of [390, 820, 1440]) {
  test(`full vehicle information stays in the call workspace at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await setup(page);
    await page.getByRole('button', { name: /Select Ford Focus/ }).click();
    await page.getByLabel('Customer name', { exact: true }).fill('Keep This Caller');
    await page.getByRole('button', { name: 'View full vehicle information', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText('42,000 miles'); await expect(dialog).toContainText('Full service history');
    await expect(dialog).toContainText('Heated seats'); await expect(dialog).toContainText('A carefully maintained example');
    await dialog.getByText('Technical specifications', { exact: true }).click();
    await expect(dialog.getByText('125 BHP', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/luxxy-enquiry-info-${width}.png` });
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('Keep This Caller');
  });
  test(`ad hoc enquiry with follow-up needs no appointment at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 }); await setup(page);
    let payload: any;
    await page.route('**/api/staff/enquiries', route => { payload = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { ...existing, ...payload, vehicleTitle: payload.adHocVehicle.title, reference: 'ADHOC-1' } }); });
    await page.getByLabel('Vehicle source', { exact: true }).selectOption('adhoc');
    await page.getByLabel('Vehicle make and model', { exact: true }).fill('2018 Volkswagen Golf');
    await page.getByLabel('Vehicle registration (optional)', { exact: true }).fill('AB18 XYZ');
    await page.getByLabel('Quoted vehicle price (£, optional)', { exact: true }).fill('9000');
    await page.getByLabel('Customer name', { exact: true }).fill('Ad Hoc Caller');
    await page.getByLabel('Phone number', { exact: true }).fill('07700900123');
    await expect(page.getByLabel('Log call / enquiry only', { exact: true })).toBeChecked();
    await expect(page.getByLabel('Book a test drive', { exact: true })).toBeDisabled();
    await page.getByLabel('Request a follow-up', { exact: true }).check();
    await page.getByLabel('Follow-up date and time (UK)', { exact: true }).fill('2027-01-05T10:00');
    await page.getByLabel('Follow-up note (optional)', { exact: true }).fill('Check service history and call back.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `/tmp/luxxy-enquiry-adhoc-${width}.png`, fullPage: true });
    await page.getByRole('button', { name: 'Save phone enquiry', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('ADHOC-1 saved');
    expect(payload).toMatchObject({ vehicleId: null, type: 'general', appointmentAt: null, adHocVehicle: { title: '2018 Volkswagen Golf', registration: 'AB18 XYZ', price: 9000 }, followUpAt: '2027-01-05T10:00:00.000Z', followUpNote: 'Check service history and call back.' });
  });
}
test('due follow-up queue can complete a request with the reviewed revision', async ({ page }) => {
  await setup(page);
  let entry = { ...existing, appointmentAt: null, followUpAt: '2026-01-01T10:00:00Z', followUpNote: 'Discuss delivery', followUpCompletedAt: null as string | null, followUpRevision: 2 };
  await page.route('**/api/enquiries', route => route.fulfill({ json: [entry] }));
  await page.getByRole('button', { name: 'Refresh enquiries and stock' }).click();
  await page.getByRole('button', { name: 'Overdue now (1)' }).click();
  await page.getByRole('button', { name: 'Open enquiry for Alex Caller, CALL-123' }).click();
  await expect(page.getByRole('region', { name: 'Selected enquiry: Alex Caller' })).toContainText('Follow-up overdue');
  let payload: any;
  await page.route('**/api/staff/enquiries/enquiry-one/follow-up', route => { payload = route.request().postDataJSON(); entry = { ...entry, followUpRevision: 3, followUpCompletedAt: new Date().toISOString() }; return route.fulfill({ json: entry }); });
  await page.getByRole('button', { name: 'Manage follow-up', exact: true }).click();
  await page.getByRole('button', { name: 'Mark follow-up done', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('follow-up completed');
  await expect(page.getByRole('button', { name: 'Overdue now (0)' })).toBeVisible();
  expect(payload).toMatchObject({ action: 'complete', expectedRevision: 2 });
});
test('a general call can be saved even if showroom stock cannot be loaded', async ({ page }) => {
  await setup(page);
  await page.route('**/api/stock', route => route.fulfill({ status: 503, json: { error: 'Offline' } }));
  await page.getByRole('button', { name: 'Refresh enquiries and stock' }).click();
  await page.getByLabel('Vehicle source', { exact: true }).selectOption('none');
  await page.getByLabel('Customer name', { exact: true }).fill('General Caller');
  await page.getByLabel('Phone number', { exact: true }).fill('07700900123');
  let payload: any;
  await page.route('**/api/staff/enquiries', route => { payload = route.request().postDataJSON(); return route.fulfill({ status: 201, json: { ...existing, ...payload, reference: 'GENERAL-1' } }); });
  await page.getByRole('button', { name: 'Save phone enquiry', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('GENERAL-1 saved');
  expect(payload).toMatchObject({ vehicleId: null, adHocVehicle: null, type: 'general', appointmentAt: null });
});

for (const width of [390, 820, 1440]) {
  test(`stock workspace keeps caller draft and gates booking at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    await page.getByLabel('Customer name', { exact: true }).fill('Draft Caller');
    await page.getByRole('tab', { name: 'All cars', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'All cars', exact: true });
    await expect(panel.getByRole('listitem')).toHaveCount(2);
    await expect(panel.getByRole('listitem').filter({ hasText: 'Reserved Ford Fiesta' }).getByRole('button', { name: 'Book test drive' })).toBeDisabled();
    await panel.getByLabel('Stock availability').selectOption('available');
    await expect(panel.getByRole('listitem')).toHaveCount(1);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `/tmp/enquiry-workspace-${width}.png`, fullPage: true });
    await panel.getByRole('button', { name: 'Log enquiry', exact: true }).click();
    await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('Draft Caller');
    await expect(page.getByRole('radio', { name: 'Log call / enquiry only' })).toBeChecked();
    await page.getByRole('tab', { name: 'All cars', exact: true }).click();
    await panel.getByRole('button', { name: 'Book test drive' }).click();
    await expect(page.getByRole('radio', { name: 'Book a test drive', exact: true })).toBeChecked();
    await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('Draft Caller');
  });
}

for (const width of [390, 820, 1440]) {
  test(`calendar combines website and staff appointments at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await setup(page);
    await page.route('**/api/enquiries', route => route.fulfill({ json: [
      { ...existing, source: 'website', customerName: 'Website Customer' },
      { ...existing, id: 'staff-two', reference: 'STAFF-2', source: 'phone', customerName: 'Phone Customer', appointmentAt: '2027-01-05T14:00:00Z', appointmentStatus: 'pending' },
      { ...existing, id: 'cancelled-three', reference: 'CANCEL-3', source: 'website', customerName: 'Cancelled Customer', appointmentCancelledAt: '2026-10-01T10:00:00Z' },
      { ...existing, id: 'no-appointment', customerName: 'Enquiry Only', appointmentAt: null },
    ] }));
    await page.getByRole('button', { name: 'Refresh enquiries and stock' }).click();
    await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
    const panel = page.getByRole('tabpanel', { name: 'Calendar', exact: true });
    await panel.getByLabel('Calendar month').fill('2027-01');
    await panel.getByRole('button', { name: 'Tuesday 5 January 2027, 2 appointments', exact: true }).click();
    await expect(panel.getByText('Website booking', { exact: false })).toBeVisible();
    await expect(panel.getByText('Awaiting approval · Staff booking', { exact: false })).toBeVisible();
    await expect(panel.getByText('Enquiry Only', { exact: false })).toHaveCount(0);
    await panel.getByLabel('Show cancelled').check();
    await expect(panel.getByText('Cancelled Customer', { exact: false })).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `/tmp/enquiry-calendar-${width}.png`, fullPage: true });
    await panel.getByRole('button', { name: 'Change appointment', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: 'Change appointment' })).toBeVisible();
    await page.getByRole('button', { name: 'Keep existing appointment' }).click();
    await panel.getByRole('button', { name: 'Next month' }).click();
    await expect(panel.getByLabel('Calendar month')).toHaveValue('2027-02');
    await expect(panel.getByText('No appointments on this day.')).toBeVisible();
  });
}

test('workspace draft survives refresh and universal search opens the existing enquiry', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Customer name', { exact: true }).fill('Draft Caller');
  await page.getByLabel('Phone number', { exact: true }).fill('07700900456');
  await expect(page.getByText('Draft saved', { exact: true })).toBeVisible();
  await page.reload();
  await page.getByTestId('tab-enquiries').click();
  await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('Draft Caller');
  await page.getByLabel('Search the workspace').fill('CALL-123');
  await page.getByRole('button', { name: /CALL-123/ }).click();
  await expect(page.getByRole('button', { name: 'Update enquiry', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await page.screenshot({ path: '/tmp/luxxy-today-workspace.png', fullPage: true });
  await page.getByRole('tab', { name: 'New call', exact: true }).click();
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('');
});

for (const [width, height] of [[1024, 768], [1440, 900], [1920, 1080]]) {
  test(`desktop call desk keeps the save action in view with long details at ${width}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await setup(page);
    await page.route('**/api/stock', route => route.fulfill({ json: {
      schemaVersion: 1, count: 1, cars: [{ ...car, sourceExtras: {
        ...car.sourceExtras,
        advertDescription: 'Documented service and preparation information. '.repeat(80),
        featureList: Array.from({ length: 40 }, (_, index) => `Supplied equipment item ${index + 1}`),
      } }],
    } }));
    await page.getByRole('button', { name: 'Refresh enquiries and stock' }).click();
    await page.getByRole('button', { name: /Select Ford Focus/ }).click();
    await page.getByLabel('Customer name', { exact: true }).fill('Desktop Caller');
    await page.getByLabel('Phone number', { exact: true }).fill('07700900456');
    await page.getByLabel('Book a test drive', { exact: true }).check();
    await page.getByRole('button', { name: '12:00', exact: true }).click();
    await page.locator('.enquiry-vehicle-context summary').filter({ hasText: /^Description$/ }).click();
    await page.getByLabel('Request a follow-up', { exact: true }).check();
    await page.getByLabel('Follow-up date and time (UK)').fill('2027-01-07T10:00');
    await page.getByLabel('Follow-up note (optional)').fill('Discuss delivery after the test drive.');
    const save = page.getByRole('button', { name: 'Save test-drive booking', exact: true });
    await expect(save).toBeEnabled();
    // Inputs can scroll within their columns; a booking never pushes Save down the document.
    await page.evaluate(() => window.scrollTo(0, 0));
    const geometry = await page.evaluate(() => {
      const sections = [...document.querySelectorAll('.enquiry-new-call > fieldset')].map(element => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight };
      });
      const box = document.querySelector('.enquiry-save-action')!.getBoundingClientRect();
      const workspace = document.querySelector('.portal-workspace-inner')!.getBoundingClientRect();
      return { sections, saveBottom: box.bottom, saveTop: box.top, workspaceWidth: workspace.width, scrollX: window.scrollX, overflow: document.documentElement.scrollWidth > window.innerWidth };
    });
    expect(geometry.sections).toHaveLength(3);
    expect(geometry.sections[0].x).toBeLessThan(geometry.sections[1].x);
    expect(geometry.sections[1].x).toBeLessThan(geometry.sections[2].x);
    expect(Math.abs(geometry.sections[0].y - geometry.sections[2].y)).toBeLessThan(2);
    expect(geometry.sections[0].scrollHeight).toBeGreaterThan(geometry.sections[0].clientHeight);
    expect(geometry.saveBottom).toBeLessThanOrEqual(height);
    expect(geometry.saveTop).toBeGreaterThan(0);
    expect(geometry.workspaceWidth).toBeGreaterThanOrEqual(width - 50);
    expect(geometry.overflow).toBe(false);
    await page.screenshot({ path: `/tmp/luxxy-enquiry-desktop-fit-${width}.png` });
    await page.getByRole('tab', { name: 'All cars', exact: true }).click();
    await page.getByRole('tab', { name: 'New call', exact: true }).click();
    await expect(page.getByLabel('Customer name', { exact: true })).toHaveValue('Desktop Caller');
    await expect(page.getByLabel('Request a follow-up', { exact: true })).toBeChecked();
    await expect(page.getByRole('button', { name: '12:00', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('tab', { name: 'Calendar', exact: true }).click();
    await expect(page.locator('.enquiry-calendar-day')).toHaveCount(42);
    const lastDay = page.locator('.enquiry-calendar-day').last();
    if (height < 900) await lastDay.scrollIntoViewIfNeeded();
    const diary = await page.evaluate(() => {
      const month = document.querySelector('.enquiry-calendar-month')!.getBoundingClientRect();
      const agenda = document.querySelector('.enquiry-calendar-agenda')!.getBoundingClientRect();
      const days = [...document.querySelectorAll('.enquiry-calendar-day')];
      return { monthRight: month.right, agendaLeft: agenda.left, monthBottom: month.bottom, lastBottom: days.at(-1)!.getBoundingClientRect().bottom };
    });
    expect(diary.monthRight).toBeLessThan(diary.agendaLeft);
    expect(diary.lastBottom).toBeLessThanOrEqual(diary.monthBottom);
    expect(diary.lastBottom).toBeLessThanOrEqual(height);
    await page.screenshot({ path: `/tmp/luxxy-enquiry-calendar-fit-${width}.png` });
  });
}
