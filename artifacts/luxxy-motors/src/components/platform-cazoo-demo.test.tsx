import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { PlatformCazooDemo } from './platform-cazoo-demo';
import { buildCazooDemoPrompt } from '@/lib/cazoo-demo-prompt';

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

it('reviews and edits public dealership details before creating the demo', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(preview));
  vi.stubGlobal('fetch', fetcher);
  const evidence = { sourceUrl: dealer.sourceUrl, checkedAt: '2026-11-17T10:00:00Z' };
  const dealershipDetails = {
    ...evidence,
    phone: '020 1234 5678',
    email: 'showroom@example.test',
    websiteUrl: 'https://example.test/',
    about: 'Independent showroom.',
    showroomAddress: { ...evidence, street: '10 High Street', city: 'Hayes', postcode: 'UB3 1AA' },
    openingHours: { ...evidence, timezone: 'Europe/London', days: Array.from({ length: 7 }, (_, day) => ({ day, status: 'unknown' })) },
    includedItems: ['6-month warranty'],
  };
  render(<PlatformCazooDemo dealer={dealer} prompt={prompt} busy={false} onBusyChange={() => {}} onManage={() => {}}/>);
  fireEvent.change(screen.getByLabelText('Stock JSON from Grok Bot'), { target: { value: JSON.stringify({ stock, dealershipDetails }) } });
  fireEvent.click(screen.getByText('Public dealership details'));
  expect(screen.getByLabelText('Showroom phone')).toHaveValue(dealershipDetails.phone);
  expect(screen.getByLabelText('Public email')).toHaveValue(dealershipDetails.email);
  fireEvent.change(screen.getByLabelText('Showroom phone'), { target: { value: '020 8765 4321' } });
  fireEvent.change(screen.getByLabelText('Public email'), { target: { value: 'sales@example.test' } });
  fireEvent.click(screen.getByText('Opening hours'));
  fireEvent.change(screen.getByLabelText('Monday opening status'), { target: { value: 'open' } });
  fireEvent.change(screen.getByLabelText('Monday opening time'), { target: { value: '10:00' } });
  fireEvent.change(screen.getByLabelText('Monday closing time'), { target: { value: '18:00' } });
  fireEvent.click(screen.getByText('What the dealership offers'));
  fireEvent.change(screen.getByLabelText('What’s included with every car'), { target: { value: '6-month warranty\nVehicle history check\n' } });
  expect(screen.getByLabelText('What’s included with every car')).toHaveValue('6-month warranty\nVehicle history check\n');
  fireEvent.click(screen.getByRole('button', { name: 'Create private demo' }));
  await screen.findByRole('link', { name: /Open private preview/ });
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toMatchObject({
    sourceUrl: dealer.sourceUrl,
    stock,
    dealershipDetails: {
      ...dealershipDetails,
      phone: '020 8765 4321',
      email: 'sales@example.test',
      includedItems: ['6-month warranty', 'Vehicle history check'],
      openingHours: { ...dealershipDetails.openingHours, days: dealershipDetails.openingHours.days.map(day => day.day === 1 ? { day: 1, status: 'open', open: '10:00', close: '18:00' } : day) },
    },
  });
});

it('lets staff add public contact details to older stock files without inventing opening hours', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(preview));
  vi.stubGlobal('fetch', fetcher);
  render(<PlatformCazooDemo dealer={dealer} prompt={prompt} busy={false} onBusyChange={() => {}} onManage={() => {}}/>);
  fireEvent.change(screen.getByLabelText('Stock JSON from Grok Bot'), { target: { value: JSON.stringify(stock) } });
  fireEvent.click(screen.getByText('Public dealership details'));
  expect(screen.getByText(/This export has no dealership details/)).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Showroom phone'), { target: { value: '020 1234 5678' } });
  fireEvent.click(screen.getByRole('button', { name: 'Create private demo' }));
  await screen.findByRole('link', { name: /Open private preview/ });
  const submitted = JSON.parse(String(fetcher.mock.calls[0][1].body)).dealershipDetails;
  expect(submitted).toEqual({ sourceUrl: dealer.sourceUrl, checkedAt: expect.any(String), phone: '020 1234 5678' });
  expect(Number.isNaN(Date.parse(submitted.checkedAt))).toBe(false);
});

it('asks Grok for public dealer details and preserves uncertainty in the JSON example', () => {
  const generated = buildCazooDemoPrompt(dealer);
  const example = JSON.parse(generated.slice(generated.indexOf('{\n')));
  expect(example.dealershipDetails.sourceUrl).toBe(dealer.sourceUrl);
  expect(example.dealershipDetails.openingHours.days).toHaveLength(7);
  expect(example.dealershipDetails.openingHours.days.every((day: { status: string }) => day.status === 'unknown')).toBe(true);
  expect(example.stock.cars[0].advertUrl).toBeNull();
  expect(generated).toContain('Never treat a promise on one vehicle as a dealership-wide promise.');
});

it('opens required fields for correction and lets staff cancel optional address and hours', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(preview));
  vi.stubGlobal('fetch', fetcher);
  render(<PlatformCazooDemo dealer={dealer} prompt={prompt} busy={false} onBusyChange={() => {}} onManage={() => {}}/>);
  fireEvent.change(screen.getByLabelText('Stock JSON from Grok Bot'), { target: { value: JSON.stringify(stock) } });
  fireEvent.click(screen.getByText('Public dealership details'));
  fireEvent.click(screen.getByText('Showroom address · not supplied'));
  fireEvent.click(screen.getByRole('button', { name: 'Add showroom address' }));
  const street = screen.getByLabelText('Street address');
  const address = street.closest('details')!;
  const allDetails = address.parentElement!.closest('details')!;
  address.open = false;
  allDetails.open = false;
  fireEvent.invalid(street);
  expect(address.open).toBe(true);
  expect(allDetails.open).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Remove showroom address' }));
  expect(screen.queryByLabelText('Street address')).not.toBeInTheDocument();

  fireEvent.click(screen.getByText('Opening hours · not supplied'));
  fireEvent.click(screen.getByRole('button', { name: 'Add opening hours' }));
  fireEvent.change(screen.getByLabelText('Monday opening status'), { target: { value: 'open' } });
  const opening = screen.getByLabelText('Monday opening time');
  const hours = opening.closest('details')!;
  hours.open = false;
  allDetails.open = false;
  fireEvent.invalid(opening);
  expect(hours.open).toBe(true);
  expect(allDetails.open).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Remove opening hours' }));
  expect(screen.queryByLabelText('Monday opening time')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Create private demo' }));
  await screen.findByRole('link', { name: /Open private preview/ });
  const submitted = JSON.parse(String(fetcher.mock.calls[0][1].body)).dealershipDetails;
  expect(submitted.showroomAddress).toBeUndefined();
  expect(submitted.openingHours).toBeUndefined();
});

it.each([0, 7])('rejects repeated or out-of-range weekday %i without rendering invalid labels', day => {
  const fetcher = vi.fn();
  vi.stubGlobal('fetch', fetcher);
  const evidence = { sourceUrl: dealer.sourceUrl, checkedAt: '2026-11-17T10:00:00Z' };
  const dealershipDetails = {
    ...evidence,
    openingHours: { ...evidence, timezone: 'Europe/London', days: Array.from({ length: 7 }, (_, index) => ({ day: index === 6 ? day : index, status: 'unknown' })) },
  };
  render(<PlatformCazooDemo dealer={dealer} prompt={prompt} busy={false} onBusyChange={() => {}} onManage={() => {}}/>);
  fireEvent.change(screen.getByLabelText('Stock JSON from Grok Bot'), { target: { value: JSON.stringify({ stock, dealershipDetails }) } });
  fireEvent.click(screen.getByRole('button', { name: 'Create private demo' }));
  expect(screen.getByRole('alert')).toHaveTextContent('The dealership details are incomplete.');
  expect(fetcher).not.toHaveBeenCalled();
  expect(screen.queryByLabelText('undefined opening status')).not.toBeInTheDocument();
});
