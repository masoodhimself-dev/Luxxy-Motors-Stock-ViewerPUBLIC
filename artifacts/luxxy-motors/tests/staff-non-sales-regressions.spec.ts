import { expect, test } from '@playwright/test';
import { previewSettings } from '../preview/settings';

test.skip(process.env.LUXXY_LOCAL_PREVIEW !== '1', 'Uses synthetic staff records and intercepted writes only.');

test('logging contact preserves the current follow-up unless a replacement is supplied', async ({ page }) => {
  const submissions: Record<string, unknown>[] = [];
  const response = await page.request.get('/api/leads/sample-lead-1');
  const detail = await response.json();
  await page.route('**/api/leads/sample-lead-1', async (route) => {
    await route.fulfill({ json: detail });
  });
  await page.route('**/api/leads/sample-lead-1/activities', async (route) => {
    const submitted = route.request().postDataJSON();
    submissions.push(submitted);
    for (const key of ['nextAction', 'nextActionDueAt']) {
      if (Object.hasOwn(submitted, key)) detail.lead[key] = submitted[key];
    }
    await route.fulfill({ json: {} });
  });
  await page.goto('/portal/leads/sample-lead-1');
  await page.getByTestId('input-activity-body').fill('Customer asked for another photograph.');
  await page.getByTestId('button-log-activity').click();
  await expect(page.getByTestId('input-activity-body')).toHaveValue('');
  expect(submissions[0]).toMatchObject({ kind: 'call', body: 'Customer asked for another photograph.' });
  expect(submissions[0]).not.toHaveProperty('nextAction');
  expect(submissions[0]).not.toHaveProperty('nextActionDueAt');
  await expect(page.getByTestId('next-action-band')).toContainText('Prepare vehicle for viewing');
  await page.getByTestId('button-edit-next-action').click();
  await page.getByTestId('next-action-edit').getByRole('button', { name: 'Cancel' }).click();

  await page.getByTestId('input-activity-body').fill('Agreed a follow-up call.');
  await page.getByTestId('input-activity-next-due').fill('2026-10-01T10:30');
  await page.getByTestId('button-log-activity').click();
  await expect(page.getByRole('alert')).toContainText('Add the next action');
  expect(submissions).toHaveLength(1);
  await page.getByTestId('input-activity-next-action').fill('Call the customer');
  await page.getByTestId('button-log-activity').click();
  await expect(page.getByTestId('input-activity-body')).toHaveValue('');
  expect(submissions[1]).toMatchObject({ nextAction: 'Call the customer' });
  expect(submissions[1].nextActionDueAt).toBeTruthy();
  await expect(page.getByTestId('next-action-band')).toContainText('Call the customer');
  await page.getByTestId('button-edit-next-action').click();
  await expect(page.getByTestId('input-edit-next-action')).toHaveValue('Call the customer');
  await expect(page.getByTestId('input-edit-next-due')).toHaveValue('2026-10-01T10:30');
});

test('next-action failures keep the draft, cancel restores saved values, and retry succeeds', async ({ page }) => {
  let failed = true;
  let completeSave = () => {};
  const pendingSave = new Promise<void>((resolve) => { completeSave = resolve; });
  let holdRefresh = false;
  let completeRefresh = () => {};
  let refreshed = () => {};
  const pendingRefresh = new Promise<void>((resolve) => { completeRefresh = resolve; });
  const refreshStarted = new Promise<void>((resolve) => { refreshed = resolve; });
  const response = await page.request.get('/api/leads/sample-lead-1');
  const detail = await response.json();
  await page.route('**/api/leads/sample-lead-1', async (route) => {
    if (route.request().method() === 'PATCH') {
      if (failed) {
        await route.fulfill({ status: 503, json: { error: 'Synthetic temporary failure' } });
        return;
      }
      await pendingSave;
      detail.lead = { ...detail.lead, ...route.request().postDataJSON() };
      holdRefresh = true;
    } else if (holdRefresh) {
      refreshed();
      await pendingRefresh;
    }
    await route.fulfill({ json: detail });
  });
  await page.goto('/portal/leads/sample-lead-1');
  await page.getByTestId('button-edit-next-action').click();
  await page.getByTestId('input-edit-next-action').fill('Check the service documents');
  await page.getByTestId('button-save-next-action').click();
  await expect(page.getByRole('alert')).toContainText('could not be saved');
  await expect(page.getByTestId('next-action-edit')).toBeVisible();
  await expect(page.getByTestId('input-edit-next-action')).toHaveValue('Check the service documents');
  await page.getByTestId('next-action-edit').getByRole('button', { name: 'Cancel' }).click();
  await page.getByTestId('button-edit-next-action').click();
  await expect(page.getByTestId('input-edit-next-action')).toHaveValue('Prepare vehicle for viewing');
  await page.getByTestId('input-edit-next-action').fill('Confirm the appointment');
  failed = false;
  await page.getByTestId('button-save-next-action').click();
  await expect(page.getByTestId('input-edit-next-action')).toBeDisabled();
  await expect(page.getByTestId('input-edit-next-due')).toBeDisabled();
  await expect(page.getByTestId('button-save-next-action')).toBeDisabled();
  await expect(page.getByTestId('next-action-edit').getByRole('button', { name: 'Cancel' })).toBeDisabled();
  completeSave();
  await refreshStarted;
  await expect(page.getByTestId('input-edit-next-action')).toBeDisabled();
  await expect(page.getByTestId('input-edit-next-due')).toBeDisabled();
  completeRefresh();
  await expect(page.getByTestId('next-action-edit')).toHaveCount(0);
  await expect(page.getByTestId('next-action-band')).toContainText('Confirm the appointment');
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('a channel request failure has an honest error state and can be retried', async ({ page }) => {
  let failed = true;
  await page.route('**/api/leads/summary', async (route) => {
    await route.fulfill(failed
      ? { status: 503, json: { error: 'Synthetic temporary failure' } }
      : { json: [{ source: 'website_form', total: 2, open: 2, won: 0, lost: 0 }] });
  });
  await page.goto('/portal');
  await page.getByTestId('tab-channels').click();
  await expect(page.getByRole('heading', { name: 'Could not load channel results' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText('Nothing to compare yet', { exact: true })).toHaveCount(0);
  failed = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByTestId('channel-row-website_form')).toBeVisible();
});

test('settings cannot publish fallback defaults after an initial load failure', async ({ page }) => {
  let failed = true;
  let writes = 0;
  await page.route('**/api/dealer-settings', async (route) => {
    if (route.request().method() !== 'GET') writes += 1;
    await route.fulfill(failed
      ? { status: 503, json: { error: 'Synthetic temporary failure' } }
      : { json: previewSettings });
  });
  await page.goto('/portal');
  await page.getByTestId('tab-settings').click();
  await expect(page.getByRole('heading', { name: 'Could not load showroom settings' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('button-save-settings')).toHaveCount(0);
  await expect(page.getByTestId('input-identity-name')).toHaveCount(0);
  expect(writes).toBe(0);
  failed = false;
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect(page.getByTestId('input-identity-name')).toHaveValue(previewSettings.identity.name);
  await expect(page.getByTestId('button-save-settings')).toBeEnabled();
  expect(writes).toBe(0);
});
