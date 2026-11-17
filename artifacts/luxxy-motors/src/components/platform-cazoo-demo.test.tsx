import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlatformCazooDemo } from './platform-cazoo-demo';

const dealer = {
  sourceUrl: 'https://www.cazoo.co.uk/dealers/example-motors-1234/',
  retailerId: 'cazoo-1234',
};
const prompt = `Collect the stock at ${dealer.sourceUrl}.`;
const stock = { schemaVersion: 1, source: 'grok', retailerId: dealer.retailerId, cars: [{ advertId: '123' }] };
const preview = {
  dealerId: 'demo-example-motors',
  dealerName: 'Example Motors',
  previewPath: '/platform/preview/demo-example-motors',
  received: 1,
  hasLogo: false,
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('copies the prompt and creates a branded private demo from a fenced JSON response', async () => {
  const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard });
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ...preview, hasLogo: true }));
  vi.stubGlobal('fetch', fetcher);
  const onManage = vi.fn();
  const onBusyChange = vi.fn();
  try {
    render(<PlatformCazooDemo dealer={dealer} prompt={prompt} busy={false} onBusyChange={onBusyChange} onManage={onManage}/>);
    fireEvent.click(screen.getByRole('button', { name: 'Copy prompt' }));
    await screen.findByText('Prompt copied.');
    expect(clipboard.writeText).toHaveBeenCalledWith(prompt);

    const logoData = 'data:image/png;base64,iVBORw0KGgo=';
    const json = screen.getByLabelText('Stock JSON from Grok Bot');
    fireEvent.change(json, { target: { value: `\`\`\`json\n${JSON.stringify({ stock, logoData })}\n\`\`\`` } });
    fireEvent.click(screen.getByRole('button', { name: 'Create private demo' }));

    const link = await screen.findByRole('link', { name: /Open private preview/ });
    expect(link).toHaveAttribute('href', preview.previewPath);
    expect(link).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('1 vehicle imported into the private demo.');
    expect(screen.getByText('The dealership logo is included.')).toBeInTheDocument();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [path, init] = fetcher.mock.calls[0];
    expect(path).toBe('/api/platform/demos/from-cazoo');
    expect(JSON.parse(String(init.body))).toEqual({ sourceUrl: dealer.sourceUrl, stock, logoData });
    expect(onBusyChange.mock.calls).toEqual([[true], [false]]);
    fireEvent.click(screen.getByRole('button', { name: 'Manage demo' }));
    expect(onManage).toHaveBeenCalledWith(preview.dealerId);
  } finally {
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it('imports a downloaded raw stock JSON file and shows the dealership name where there is no logo', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(preview));
  vi.stubGlobal('fetch', fetcher);
  render(<PlatformCazooDemo dealer={dealer} prompt={prompt} busy={false} onBusyChange={() => {}} onManage={() => {}}/>);
  const contents = JSON.stringify(stock);
  const file = new File([contents], 'cazoo-stock.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: async () => contents });
  fireEvent.change(screen.getByLabelText('Choose JSON file'), { target: { files: [file] } });
  await screen.findByText('cazoo-stock.json');
  expect(screen.getByLabelText('Stock JSON from Grok Bot')).toHaveValue(contents);
  fireEvent.click(screen.getByRole('button', { name: 'Create private demo' }));
  await screen.findByText('The preview uses the dealership name as its logo.');
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({ sourceUrl: dealer.sourceUrl, stock });
});

it('uses a local dealership logo in place of the logo in the JSON', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ ...preview, hasLogo: true }));
  const bitmap = { width: 1200, height: 240, close: vi.fn() };
  const drawImage = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(bitmap));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  const logoData = 'data:image/png;base64,bG9jYWw=';
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(logoData);

  render(<PlatformCazooDemo dealer={dealer} prompt={prompt} busy={false} onBusyChange={() => {}} onManage={() => {}}/>);
  const logoFile = new File(['image'], 'dealer-logo.webp', { type: 'image/webp' });
  fireEvent.change(screen.getByLabelText('Add logo (optional)'), { target: { files: [logoFile] } });
  await screen.findByText('dealer-logo.webp');
  expect(drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 600, 120);
  expect(bitmap.close).toHaveBeenCalled();

  fireEvent.change(screen.getByLabelText('Stock JSON from Grok Bot'), {
    target: { value: JSON.stringify({ stock, logoData: 'data:image/png;base64,ZXhwb3J0ZWQ=' }) },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Create private demo' }));
  await screen.findByRole('link', { name: /Open private preview/ });
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({ sourceUrl: dealer.sourceUrl, stock, logoData });
});

it('keeps the pasted JSON available after errors and only accepts a local preview that matches the result', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ error: 'This stock is incomplete.' }, { status: 422 }))
    .mockResolvedValueOnce(Response.json({ ...preview, previewPath: '//example.com/demo' }));
  vi.stubGlobal('fetch', fetcher);
  render(<PlatformCazooDemo dealer={dealer} prompt={prompt} busy={false} onBusyChange={() => {}} onManage={() => {}}/>);
  const json = screen.getByLabelText('Stock JSON from Grok Bot');
  const submit = screen.getByRole('button', { name: 'Create private demo' });
  expect(submit).toBeDisabled();
  const contents = JSON.stringify(stock);
  fireEvent.change(json, { target: { value: `Here is the stock:\n${contents}` } });
  fireEvent.click(submit);
  expect(screen.getByRole('alert')).toHaveTextContent('Paste the full JSON response');
  expect(fetcher).not.toHaveBeenCalled();

  fireEvent.change(json, { target: { value: JSON.stringify({ ...stock, retailerId: 'cazoo-9000' }) } });
  fireEvent.click(submit);
  expect(screen.getByRole('alert')).toHaveTextContent('This stock JSON is for a different Cazoo dealership.');
  expect(fetcher).not.toHaveBeenCalled();

  fireEvent.change(json, { target: { value: contents } });
  fireEvent.click(submit);
  await screen.findByText('This stock is incomplete.');
  expect(json).toHaveValue(contents);
  await waitFor(() => expect(submit).toBeEnabled());

  fireEvent.click(submit);
  await screen.findByText('Could not confirm the private demo. Check your connection and try again.');
  expect(screen.queryByRole('link', { name: /Open private preview/ })).not.toBeInTheDocument();
  expect(json).toHaveValue(contents);
});
