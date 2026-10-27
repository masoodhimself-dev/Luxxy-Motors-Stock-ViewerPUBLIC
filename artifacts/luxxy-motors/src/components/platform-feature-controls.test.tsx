import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDealerFeatures } from '@workspace/vehicle-meta';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: mocks.fetch }));
import { PlatformFeatureControls } from './platform-feature-controls';
const policy = (extra = {}) => ({ scope: 'dealer', dealerId: 'sample', evaluatedAt: '2026-10-18T12:00:00Z', features: resolveDealerFeatures({}, {}), audit: [], ...extra });
beforeEach(() => { mocks.fetch.mockReset(); });
describe('platform feature controls', () => {
  it('ignores a late response from a previously selected dealer', async () => {
    let finishA!: (value: unknown) => void;
    mocks.fetch.mockImplementation((url: string) => url.includes('/dealer-a/') ? new Promise(resolve => { finishA = resolve; }) : Promise.resolve(policy({ dealerId: 'dealer-b', features: resolveDealerFeatures({}, { publicEnquiries: { mode: 'disabled', disabledAt: null, revision: 7, reason: '', updatedAt: null, updatedBy: null } }) })));
    const view = render(<PlatformFeatureControls dealerId="dealer-a" />);
    view.rerender(<PlatformFeatureControls dealerId="dealer-b" />);
    expect(await screen.findByLabelText('Website enquiries availability')).toHaveValue('disabled');
    await act(async () => finishA(policy({ dealerId: 'dealer-a' })));
    expect(screen.getByLabelText('Website enquiries availability')).toHaveValue('disabled');
  });
  it('locks previous controls when a reload fails until a successful reload', async () => {
    mocks.fetch.mockResolvedValueOnce(policy()).mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(policy());
    render(<PlatformFeatureControls dealerId="sample" />);
    expect(await screen.findByLabelText('Website enquiries availability')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload controls' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Website enquiries availability')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Reload controls' }));
    await waitFor(() => expect(screen.getByLabelText('Website enquiries availability')).toBeEnabled());
  });
  it('keeps release-restricted features uneditable and requires a reason for a scoped change', async () => {
    mocks.fetch.mockResolvedValue(policy()); render(<PlatformFeatureControls dealerId="sample" />);
    const availability = await screen.findByLabelText('Website enquiries availability');
    const form = availability.closest('form')!;
    expect(within(form).getByRole('button', { name: 'Save dealer setting' })).toBeDisabled();
    expect(screen.queryByLabelText('Website chat availability')).not.toBeInTheDocument();
    fireEvent.change(availability, { target: { value: 'disabled' } });
    fireEvent.change(screen.getByLabelText('Website enquiries reason'), { target: { value: 'Dealer asked to pause enquiries' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Save dealer setting' }));
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalledWith('/api/platform/dealers/sample/features/publicEnquiries', expect.objectContaining({ method: 'PUT' })));
    const request = mocks.fetch.mock.calls.find(([, init]) => init?.method === 'PUT');
    expect(JSON.parse(request![1].body)).toEqual({ mode: 'disabled', disabledAt: null, reason: 'Dealer asked to pause enquiries', expectedRevision: 0 });
    expect(await screen.findByRole('status')).toHaveTextContent('Website enquiries controls saved');
  });
  it('makes local preview read-only and shows an honest error with retry', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('Offline')).mockResolvedValue(policy({ readOnly: true }));
    render(<PlatformFeatureControls />);
    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    fireEvent.click(screen.getByRole('button', { name: 'Reload controls' }));
    expect(await screen.findByText('Local layout preview. Feature changes require the configured platform backend.')).toBeInTheDocument();
    expect(screen.getByLabelText('Website enquiries availability')).toBeDisabled();
  });
  it('reports stale revision conflicts without pretending the change was saved', async () => {
    mocks.fetch.mockResolvedValueOnce(policy()).mockRejectedValueOnce({ data: { error: 'These controls changed in another session. Reload before saving.' } });
    render(<PlatformFeatureControls dealerId="sample" />);
    const reason = await screen.findByLabelText('Website enquiries reason'); fireEvent.change(reason, { target: { value: 'Pause new enquiries' } });
    fireEvent.click(within(reason.closest('form')!).getByRole('button', { name: 'Save dealer setting' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Reload before saving');
    expect(screen.queryByText(/controls saved/)).not.toBeInTheDocument();
  });
});
