import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WebsiteImageField } from './website-image-field';

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), prepare: vi.fn() }));
vi.mock('@workspace/api-client-react', () => ({ customFetch: mocks.fetch }));
vi.mock('@/lib/website-image', () => ({ prepareWebsiteImage: mocks.prepare }));
const image = 'data:image/png;base64,example';
const asset = { id: '11111111-1111-4111-8111-111111111111', url: 'https://dealer.example.test/api/website-assets/11111111-1111-4111-8111-111111111111', mimeType: 'image/png', width: 600, height: 160, byteSize: 100, replayed: false };
function upload() { fireEvent.change(screen.getByLabelText('Choose header logo file'), { target: { files: [new File(['image'], 'logo.png', { type: 'image/png' })] } }); }

describe('website image upload', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.prepare.mockResolvedValue(image); mocks.fetch.mockResolvedValue(asset); });
  it('puts an uploaded asset in the draft without publishing settings', async () => {
    const change = vi.fn(), busy = vi.fn();
    render(<WebsiteImageField label="Header logo" value="" onChange={change} onBusyChange={busy} />);
    upload();
    await waitFor(() => expect(change).toHaveBeenCalledWith(asset.url));
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    const [url, request] = mocks.fetch.mock.calls[0];
    expect(url).toBe('/api/staff/website-assets');
    expect(JSON.parse(request.body)).toEqual({ image, requestId: expect.stringMatching(/^[a-f0-9-]{36}$/) });
    expect(busy.mock.calls).toEqual([[true], [false]]);
    expect(screen.getByRole('status')).toHaveTextContent('draft');
  });
  it('retries the identical upload identity after a lost response and retains the old image on failure', async () => {
    const change = vi.fn(); mocks.fetch.mockRejectedValueOnce(new Error('Connection interrupted.'));
    render(<WebsiteImageField label="Header logo" value="https://dealer.example.test/old.png" onChange={change} />);
    upload();
    await screen.findByRole('alert');
    expect(change).not.toHaveBeenCalled();
    const first = mocks.fetch.mock.calls[0][1].body;
    fireEvent.click(screen.getByRole('button', { name: 'Retry upload' }));
    await waitFor(() => expect(change).toHaveBeenCalledWith(asset.url));
    expect(mocks.fetch.mock.calls[1][1].body).toBe(first);
    expect(mocks.prepare).toHaveBeenCalledTimes(1);
  });
  it('shows an invalid file error without uploading or changing the draft', async () => {
    const change = vi.fn(); mocks.prepare.mockRejectedValueOnce(new Error('Choose PNG or JPEG.'));
    render(<WebsiteImageField label="Header logo" value="https://dealer.example.test/old.png" onChange={change} />);
    upload();
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose PNG or JPEG.');
    expect(mocks.fetch).not.toHaveBeenCalled(); expect(change).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Retry upload' })).not.toBeInTheDocument();
  });
  it('aborts when changing settings areas and ignores a late response', async () => {
    const change = vi.fn(), busy = vi.fn();
    let complete!: (value: typeof asset) => void;
    mocks.fetch.mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
    const view = render(<WebsiteImageField label="Header logo" value="" onChange={change} onBusyChange={busy} />);
    upload(); await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    const signal = mocks.fetch.mock.calls[0][1].signal;
    view.unmount(); expect(signal.aborted).toBe(true);
    await act(async () => complete(asset));
    expect(change).not.toHaveBeenCalled(); expect(busy.mock.calls).toEqual([[true], [false]]);
  });
  it('keeps hosted URL editing and removing an image as draft changes', () => {
    const change = vi.fn();
    render(<WebsiteImageField label="Header logo" value="https://dealer.example.test/old.png" onChange={change} />);
    fireEvent.click(screen.getByText('Use an image link'));
    fireEvent.change(screen.getByLabelText('Header logo image URL'), { target: { value: 'https://dealer.example.test/new.png' } });
    expect(change).toHaveBeenLastCalledWith('https://dealer.example.test/new.png');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(change).toHaveBeenLastCalledWith(''); expect(mocks.fetch).not.toHaveBeenCalled();
  });
});
