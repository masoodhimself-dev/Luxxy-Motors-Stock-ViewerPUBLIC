import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { beforeAll, expect, it, vi } from 'vitest';
import { Gallery } from './gallery';
import type { Car } from '@/lib/stock-context';
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

vi.mock('@/components/vehicle-call', () => ({ VehicleCall: () => null }));

beforeAll(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
it('removes failed images from thumbnails and counts, and handles all failing', () => {
  render(<Gallery images={['https://example.com/one.jpg', 'https://example.com/two.jpg']} />);
  const fail = (src: string) => {
    const img = document.querySelector(`img[src="${src}"]`) as HTMLImageElement;
    fireEvent.error(img);
    if (img.isConnected) fireEvent.error(img);
  };
  fail('https://example.com/two.jpg');
  expect(screen.getByText('1 / 1 photographs')).toBeInTheDocument();
  expect(screen.queryByText('Photograph unavailable')).not.toBeInTheDocument();
  fail('https://example.com/one.jpg');
  expect(screen.getByText('Photos couldn’t be loaded')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try photos again' }));
  expect(screen.getByText('1 / 2 photographs')).toBeInTheDocument();
  expect(screen.getByText('Loading photo…')).toBeInTheDocument();
});

it('uses photographs to follow only when no photographs were supplied', () => {
  render(<Gallery images={[]} />);
  expect(screen.getByText('Photographs to follow')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Try photos/ })).not.toBeInTheDocument();
});

const labelledPhotos = [
  { url: 'https://example.com/front.jpg', caption: 'Front right' },
  { url: 'https://example.com/seats.jpg', caption: 'Interior seats' },
  { url: 'https://example.com/wheel.jpg', caption: 'Alloy wheel' },
  { url: 'https://example.com/other.jpg', caption: 'Another photograph' },
];

it('filters customer photographs by supplied captions and retains all photographs', async () => {
  render(<Gallery customerView images={labelledPhotos} />);
  expect(screen.getByLabelText('Photograph sections')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Show photograph/ })).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Interior' }));
  expect(screen.getByRole('button', { name: 'Interior' })).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(document.querySelector(`.gallery-photo[src="${labelledPhotos[1].url}"]`)).not.toBeNull());
  expect(screen.getByText('1 / 1 photographs')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All photographs' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 2 of 4' }));
  expect(screen.getByText('2 / 4 photographs')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(within(screen.getByRole('dialog')).getByLabelText('Photograph sections')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
  expect(screen.getByText('3 / 4')).toBeInTheDocument();
});

it('retains photograph sections for the staff gallery', () => {
  render(<Gallery images={labelledPhotos} />);
  expect(screen.getByLabelText('Photograph sections')).toBeInTheDocument();
  screen.getByRole('button', { name: 'Show photograph 2 of 4' }).scrollIntoView = vi.fn();
  fireEvent.click(screen.getByRole('button', { name: 'Interior' }));
  expect(screen.getByText('1 / 1 photographs')).toBeInTheDocument();
});

it('does not invent photograph groups for uncaptioned photos', () => {
  render(<Gallery customerView images={['https://example.com/one.jpg', 'https://example.com/two.jpg']} />);
  expect(screen.queryByLabelText('Photograph sections')).not.toBeInTheDocument();
});

it('mounts a compact lazy overview only when requested and opens the chosen photo', async () => {
  const photos = Array.from({ length: 60 }, (_, i) => ({ url: `https://m.atcdn.co.uk/a/media/w960/photo-${i}.jpg`, caption: `Photo ${i + 1}` }));
  render(<Gallery customerView images={[...photos, photos[1]]} heroImage={photos[0].url} />);
  expect(screen.getByText('View all 60 photos')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'All 60 photographs' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.querySelectorAll('img')).toHaveLength(1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'All photos' }));
  const overview = within(dialog).getByRole('region', { name: 'All 60 photographs' });
  expect(overview.querySelectorAll('img')).toHaveLength(60);
  for (const image of overview.querySelectorAll('img')) {
    expect(image).toHaveAttribute('loading', 'lazy');
    expect(image).toHaveAttribute('fetchpriority', 'low');
    expect(image).toHaveAttribute('sizes', '(min-width: 1100px) 230px, (min-width: 640px) 220px, 50vw');
  }
  fireEvent.click(within(overview).getByRole('button', { name: 'View photograph 48 of 60: Photo 48' }));
  expect(within(dialog).queryByRole('region')).not.toBeInTheDocument();
  expect(within(dialog).getByText('48 / 60')).toBeInTheDocument();
  expect(dialog.querySelector('.vehicle-lightbox-photo img')).toHaveAttribute('src', photos[47].url);
  fireEvent.keyDown(dialog, { key: 'ArrowRight' });
  expect(within(dialog).getByText('49 / 60')).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: 'Home' });
  expect(within(dialog).getByText('1 / 60')).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: 'End' });
  expect(within(dialog).getByText('60 / 60')).toBeInTheDocument();
});

it('lets the keyboard browse the overview without changing the photo until selected', async () => {
  render(<Gallery customerView images={labelledPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'All photos' }));
  const photos = within(dialog).getAllByRole('button', { name: /View photograph/ });
  await waitFor(() => expect(photos[0]).toHaveFocus());
  fireEvent.keyDown(photos[0], { key: 'End' });
  await waitFor(() => expect(photos[3]).toHaveFocus());
  expect(photos[0]).toHaveAttribute('aria-current', 'true');
  expect(photos[3]).toHaveAttribute('aria-current', 'false');
  fireEvent.keyDown(photos[3], { key: 'Home' });
  await waitFor(() => expect(photos[0]).toHaveFocus());
  fireEvent.keyDown(photos[0], { key: 'ArrowRight' });
  await waitFor(() => expect(photos[1]).toHaveFocus());
  fireEvent.click(photos[1]);
  expect(within(dialog).getByText('2 / 4')).toBeInTheDocument();
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'All photos' })).toHaveFocus());
});

it('removes failed overview photos once and keeps selection, counts and numbering intact', async () => {
  const photos = ['one', 'two', 'three', 'four'].map(name => `https://example.com/${name}.jpg`);
  render(<Gallery customerView images={[...photos, photos[1]]} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 4 of 4' }));
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'All photos' }));
  const failures = document.querySelectorAll(`img[src="${photos[1]}"]`);
  for (const image of failures) fireEvent.error(image);
  const overview = within(dialog).getByRole('region', { name: 'All 3 photographs' });
  expect(within(overview).getAllByRole('button')).toHaveLength(3);
  expect(within(overview).getByRole('button', { name: 'View photograph 3 of 3' })).toHaveAttribute('aria-current', 'true');
  expect(screen.getByText('View all 3 photos')).toBeInTheDocument();
  expect(screen.queryByText('Photograph unavailable')).not.toBeInTheDocument();
  expect(document.querySelector(`img[src="${photos[1]}"]`)).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Back to photo' }));
  expect(within(dialog).getByText('3 / 3')).toBeInTheDocument();
  expect(dialog.querySelector('.vehicle-lightbox-photo img')).toHaveAttribute('src', photos[3]);
});

it('opens a car-specific enquiry from fullscreen without scrolling to the page footer', async () => {
  const car = { id: 'gallery-car', title: 'Ford Fiesta' } as Car;
  window.history.replaceState({}, '', '/vehicle/gallery-car');
  render(<Gallery car={car} customerView images={labelledPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  const message = within(dialog).getByRole('link', { name: 'Message' });
  expect(message).toHaveAttribute('href', '/enquire?type=general&vehicleId=gallery-car');
  fireEvent.click(message);
  expect(window.location.pathname + window.location.search).toBe('/enquire?type=general&vehicleId=gallery-car');
});

const promptCar = { id: 'gallery-car', title: 'Ford Fiesta' } as Car;
const promptPhotos = Array.from({ length: 12 }, (_, i) => `https://example.com/gallery-prompt-${i + 1}.jpg`);
const promptActions = {
  bookingHref: '/enquire?type=viewing&vehicleId=gallery-car',
  enquiryHref: '/enquire?type=general&vehicleId=gallery-car',
  call: <a href="tel:07388831790">Call Us</a>,
};

it('offers vehicle-specific contact options on the tenth photo and lets customers keep browsing without another interruption', async () => {
  render(<Gallery car={promptCar} customerView customerActions={promptActions} images={promptPhotos} />);
  for (let photo = 2; photo <= 9; photo++) {
    fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));
    expect(screen.getByText(`${photo} / 12 photographs`)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
  }
  fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));
  expect(screen.getByRole('heading', { name: 'Like what you see?' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Book a Test Drive' })).toHaveAttribute('href', promptActions.bookingHref);
  expect(screen.getByRole('link', { name: 'Ask a question' })).toHaveAttribute('href', promptActions.enquiryHref);
  expect(screen.getByRole('link', { name: 'Call Us' })).toHaveAttribute('href', 'tel:07388831790');
  fireEvent.click(screen.getByRole('button', { name: 'Keep browsing' }));
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
  expect(screen.getByText('10 / 12 photographs')).toBeInTheDocument();
  await waitFor(() => expect(document.querySelector('.gallery-photo')).toHaveAttribute('src', promptPhotos[9]));
  fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));
  fireEvent.click(screen.getByRole('button', { name: 'Previous photograph' }));
  expect(screen.getByText('10 / 12 photographs')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('shows the prompt when a customer selects a later thumbnail directly', () => {
  render(<Gallery car={promptCar} customerView customerActions={{ enquiryHref: promptActions.enquiryHref }} images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
  expect(screen.getByRole('heading', { name: 'Like what you see?' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Ask a question' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Book a Test Drive' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Call Us' })).not.toBeInTheDocument();
});

it('shows one prompt in fullscreen and dismisses it before Escape closes the gallery', async () => {
  render(<Gallery car={promptCar} customerView customerActions={promptActions} images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  for (let i = 0; i < 9; i++) fireEvent.keyDown(dialog, { key: 'ArrowRight' });
  expect(screen.getAllByRole('heading', { name: 'Like what you see?' })).toHaveLength(1);
  expect(within(dialog).getByRole('heading', { name: 'Like what you see?' })).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(within(dialog).getByText('10 / 12')).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('triggers from a deliberate swipe rather than requiring thumbnail buttons', () => {
  const { container } = render(<Gallery car={promptCar} customerView customerActions={promptActions} images={promptPhotos} />);
  const frame = container.querySelector('.vehicle-gallery-frame .touch-pan-y')!;
  for (let swipe = 0; swipe < 9; swipe++) {
    fireEvent.touchStart(frame, { touches: [{ clientX: 270, clientY: 120 }], changedTouches: [{ clientX: 270, clientY: 120 }] });
    fireEvent.touchEnd(frame, { changedTouches: [{ clientX: 130, clientY: 123 }] });
  }
  expect(screen.getByRole('heading', { name: 'Like what you see?' })).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Keep browsing' }));
  fireEvent.touchStart(frame, { touches: [{ clientX: 270, clientY: 120 }], changedTouches: [{ clientX: 270, clientY: 120 }] });
  fireEvent.touchEnd(frame, { changedTouches: [{ clientX: 130, clientY: 123 }] });
  expect(screen.getByText('11 / 12 photographs')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('does not interrupt a staff gallery with a customer prompt', () => {
  render(<Gallery car={promptCar} customerActions={promptActions} images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('does not show a contact prompt without configured customer actions', () => {
  render(<Gallery car={promptCar} customerView images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('does not show a contact prompt for a gallery without a vehicle', () => {
  render(<Gallery customerView customerActions={promptActions} images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('keeps short galleries uninterrupted even after cycling through them', () => {
  render(<Gallery car={promptCar} customerView customerActions={promptActions} images={promptPhotos.slice(0, 9)} />);
  for (let next = 0; next < 18; next++) fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('does not open the prompt when contact actions load or a failed photo recovers to a later photograph', async () => {
  const { rerender } = render(<Gallery car={promptCar} customerView images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
  rerender(<Gallery car={promptCar} customerView customerActions={promptActions} images={promptPhotos} />);
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
  const failedPhoto = document.querySelector(`.vehicle-thumbnail-grid img[src="${promptPhotos[9]}"]`)!;
  fireEvent.error(failedPhoto);
  expect(screen.getByText('10 / 11 photographs')).toBeInTheDocument();
  await waitFor(() => expect(document.querySelector('.gallery-photo')).toHaveAttribute('src', promptPhotos[10]));
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry photos' }));
  expect(screen.getByText('1 / 12 photographs')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
  expect(screen.getByRole('heading', { name: 'Like what you see?' })).toBeInTheDocument();
});

it('lets customers change photo groups without opening or consuming the prompt', () => {
  const photos = [
    { url: 'https://example.com/front-group-photo.jpg', caption: 'Front view' },
    ...promptPhotos.map((url, i) => ({ url, caption: `Interior seats ${i + 1}` })),
  ];
  render(<Gallery car={promptCar} customerView customerActions={promptActions} images={photos} />);
  fireEvent.click(screen.getByRole('button', { name: 'Interior' }));
  expect(screen.getByText('1 / 12 photographs')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 9 of 12' }));
  fireEvent.click(screen.getByRole('button', { name: 'All photographs' }));
  expect(screen.getByText('1 / 13 photographs')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 13' }));
  expect(screen.getByRole('heading', { name: 'Like what you see?' })).toBeInTheDocument();
});

it('focuses one prompt when choosing the tenth photo from the fullscreen overview and does not repeat it', async () => {
  render(<Gallery car={promptCar} customerView customerActions={promptActions} images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'All photos' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'View photograph 10 of 12' }));
  expect(screen.getAllByRole('heading', { name: 'Like what you see?' })).toHaveLength(1);
  expect(within(dialog).queryByRole('region', { name: 'All 12 photographs' })).not.toBeInTheDocument();
  await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Like what you see?' })).toHaveFocus());
  expect(within(dialog).getByText('10 / 12')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Keep browsing' }));
  await waitFor(() => expect(dialog.querySelector('.vehicle-lightbox-photo')).toHaveFocus());
  fireEvent.click(within(dialog).getByRole('button', { name: 'All photos' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'View photograph 10 of 12' }));
  expect(within(dialog).getByText('10 / 12')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('closes fullscreen and opens the correct vehicle enquiry from the prompt', async () => {
  window.history.replaceState({}, '', '/vehicle/gallery-car');
  render(<Gallery car={promptCar} customerView customerActions={promptActions} images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  for (let i = 0; i < 9; i++) fireEvent.keyDown(dialog, { key: 'ArrowRight' });
  fireEvent.click(within(dialog).getByRole('link', { name: 'Ask a question' }));
  expect(window.location.pathname + window.location.search).toBe('/enquire?type=general&vehicleId=gallery-car');
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('lets Escape dismiss the inline prompt and restores focus without changing the photograph', async () => {
  const { container } = render(<Gallery car={promptCar} customerView customerActions={promptActions} images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
  const heading = screen.getByRole('heading', { name: 'Like what you see?' });
  await waitFor(() => expect(heading).toHaveFocus());
  fireEvent.keyDown(heading, { key: 'Escape' });
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
  expect(screen.getByText('10 / 12 photographs')).toBeInTheDocument();
  await waitFor(() => expect(container.querySelector('.vehicle-gallery-frame .touch-pan-y')).toHaveFocus());
  await waitFor(() => expect(container.querySelector('.gallery-photo')).toHaveAttribute('src', promptPhotos[9]));
  fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));
  expect(screen.getByText('11 / 12 photographs')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('keeps the prompt available when Escape closes its separate phone-options dialog', async () => {
  const call = <Dialog>
    <DialogTrigger asChild><button type="button">Open phone options</button></DialogTrigger>
    <DialogContent aria-describedby={undefined}><DialogTitle>Call the showroom</DialogTitle><p>07388831790</p></DialogContent>
  </Dialog>;
  render(<Gallery car={promptCar} customerView customerActions={{ ...promptActions, call }} images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
  fireEvent.click(screen.getByRole('button', { name: 'Open phone options' }));
  const phoneDialog = await screen.findByRole('dialog', { name: 'Call the showroom' });
  fireEvent.keyDown(phoneDialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Call the showroom' })).not.toBeInTheDocument());
  expect(screen.getByRole('heading', { name: 'Like what you see?' })).toBeInTheDocument();
  expect(screen.getByText('10 / 12 photographs')).toBeInTheDocument();
});


it('keeps next and previous available while the prompt is shown, without repeating it', () => {
  render(<Gallery car={promptCar} customerView customerActions={promptActions} images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
  expect(screen.getByRole('heading', { name: 'Like what you see?' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Next photograph' })).toBeEnabled();
  fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));
  expect(screen.getByText('11 / 12 photographs')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Previous photograph' }));
  expect(screen.getByText('10 / 12 photographs')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('lets a customer swipe straight past the prompt without choosing an action', () => {
  render(<Gallery car={promptCar} customerView customerActions={promptActions} images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
  const prompt = screen.getByRole('region', { name: 'Like what you see?' });
  fireEvent.touchStart(prompt, { touches: [{ clientX: 270, clientY: 120 }] });
  fireEvent.touchEnd(prompt, { changedTouches: [{ clientX: 130, clientY: 123 }] });
  expect(screen.getByText('11 / 12 photographs')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('lets fullscreen keyboard navigation continue straight past the prompt', async () => {
  render(<Gallery car={promptCar} customerView customerActions={promptActions} images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  for (let i = 0; i < 9; i++) fireEvent.keyDown(dialog, { key: 'ArrowRight' });
  expect(within(dialog).getByRole('heading', { name: 'Like what you see?' })).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Next photograph' })).toBeEnabled();
  fireEvent.keyDown(dialog, { key: 'ArrowRight' });
  expect(within(dialog).getByText('11 / 12')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('adds one extra fullscreen zoom level with keyboard panning and Escape to return', async () => {
  render(<Gallery customerView images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  const frame = dialog.querySelector('.vehicle-lightbox-photo') as HTMLElement;
  const zoom = within(dialog).getByRole('button', { name: 'Zoom in' });
  expect(zoom).toHaveAttribute('aria-pressed', 'false');
  fireEvent.click(zoom);
  expect(frame).toHaveClass('vehicle-photo-zoomed');
  expect(within(dialog).getByRole('button', { name: 'Zoom out' })).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(frame).toHaveFocus());
  fireEvent.keyDown(frame, { key: 'ArrowRight' });
  expect(frame.scrollLeft).toBe(80);
  fireEvent.keyDown(frame, { key: 'ArrowDown' });
  expect(frame.scrollTop).toBe(80);
  fireEvent.touchStart(frame, { touches: [{ clientX: 270, clientY: 120 }], changedTouches: [{ clientX: 270, clientY: 120 }] });
  fireEvent.touchEnd(frame, { changedTouches: [{ clientX: 130, clientY: 123 }] });
  expect(within(dialog).getByText('1 / 12')).toBeInTheDocument();
  fireEvent.keyDown(frame, { key: 'Escape' });
  expect(frame).not.toHaveClass('vehicle-photo-zoomed');
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
});

it('supports double-click zoom and resets zoom for another photo or an overview', async () => {
  render(<Gallery customerView images={promptPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  const frame = dialog.querySelector('.vehicle-lightbox-photo')!;
  fireEvent.doubleClick(frame);
  expect(frame).toHaveClass('vehicle-photo-zoomed');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Next photograph' }));
  expect(frame).not.toHaveClass('vehicle-photo-zoomed');
  expect(within(dialog).getByText('2 / 12')).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Zoom in' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'All photos' }));
  expect(dialog).not.toHaveClass('is-gallery-zoomed');
  expect(within(dialog).queryByRole('button', { name: 'Zoom out' })).not.toBeInTheDocument();
});
