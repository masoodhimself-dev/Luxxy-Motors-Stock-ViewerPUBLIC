import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { beforeAll, expect, it, vi } from 'vitest';
import { Gallery } from './gallery';
import type { Car } from '@/lib/stock-context';

vi.mock('@/components/vehicle-call', () => ({ VehicleCall: () => <button type="button">Call us</button> }));

beforeAll(() => { HTMLElement.prototype.scrollIntoView = vi.fn(); });
it('keeps inline photographs in sync after browsing the enlarged gallery and closing it', async () => {
  const images = ['one', 'two', 'three'].map(name => `https://example.com/${name}.jpg`);
  render(<Gallery images={images} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.keyDown(dialog, { key: 'ArrowRight' });
  expect(within(dialog).getByText('2 / 3')).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(document.querySelector('.gallery-photo')).toHaveAttribute('src', images[1]));
  expect(screen.getByText('2 / 3')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Next photograph' }));
  await waitFor(() => expect(document.querySelector('.gallery-photo')).toHaveAttribute('src', images[2]));
  expect(screen.getByText('3 / 3')).toBeInTheDocument();
});

it('removes failed images from thumbnails and counts, and handles all failing', () => {
  render(<Gallery images={['https://example.com/one.jpg', 'https://example.com/two.jpg']} />);
  const fail = (src: string) => {
    const img = document.querySelector(`img[src="${src}"]`) as HTMLImageElement;
    fireEvent.error(img);
    if (img.isConnected) fireEvent.error(img);
  };
  fail('https://example.com/two.jpg');
  expect(screen.getByText('1 / 1')).toBeInTheDocument();
  expect(screen.queryByText('Photograph unavailable')).not.toBeInTheDocument();
  fail('https://example.com/one.jpg');
  expect(screen.getByText('Photos couldn’t be loaded')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Try photos again' }));
  expect(screen.getByText('1 / 2')).toBeInTheDocument();
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
  fireEvent.click(screen.getByRole('button', { name: 'Inside' }));
  expect(screen.getByRole('button', { name: 'Inside' })).toHaveAttribute('aria-pressed', 'true');
  await waitFor(() => expect(document.querySelector(`.gallery-photo[src="${labelledPhotos[1].url}"]`)).not.toBeNull());
  expect(screen.getByText('1 / 1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All photographs' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 2 of 4' }));
  expect(screen.getByText('2 / 4')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(within(screen.getByRole('dialog')).getByLabelText('Photograph sections')).toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
  expect(within(screen.getByRole('dialog')).getByText('3 / 4')).toBeInTheDocument();
});

it('retains photograph sections for the staff gallery', () => {
  render(<Gallery images={labelledPhotos} />);
  expect(screen.getByLabelText('Photograph sections')).toBeInTheDocument();
  screen.getByRole('button', { name: 'Show photograph 2 of 4' }).scrollIntoView = vi.fn();
  fireEvent.click(screen.getByRole('button', { name: 'Inside' }));
  expect(screen.getByText('1 / 1')).toBeInTheDocument();
});

it('does not invent photograph groups for uncaptioned photos', () => {
  render(<Gallery customerView images={['https://example.com/one.jpg', 'https://example.com/two.jpg']} />);
  expect(screen.queryByLabelText('Photograph sections')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Boot space|Rear seats|Parking camera/ })).not.toBeInTheDocument();
});

it('opens the complete overview directly from the visible view-all button', async () => {
  render(<Gallery customerView images={labelledPhotos} />);
  const viewAll = screen.getByRole('button', { name: 'View all 4 photos' });
  expect(viewAll).toBeVisible();
  viewAll.focus();
  fireEvent.click(viewAll);
  const dialog = await screen.findByRole('dialog');
  const overview = within(dialog).getByRole('region', { name: 'All 4 photographs' });
  expect(within(overview).getAllByRole('button', { name: /View photograph/ })).toHaveLength(4);
  expect(dialog.querySelector('.vehicle-lightbox-photo')).not.toBeInTheDocument();
  fireEvent.click(within(overview).getByRole('button', { name: 'View photograph 2 of 4: Interior seats' }));
  expect(dialog.querySelector('.vehicle-lightbox-photo img')).toHaveAttribute('src', labelledPhotos[1].url);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(viewAll).toHaveFocus());
});

it('offers only supplied photo shortcuts and opens the matching photo across a selected category', async () => {
  const photos = [
    { url: 'https://example.com/shortcut-front.jpg', caption: 'Front three-quarter view' },
    { url: 'https://example.com/shortcut-rear-seats.jpg', caption: 'Rear seats' },
    { url: 'https://example.com/shortcut-boot.jpg', caption: 'Boot space' },
    { url: 'https://example.com/shortcut-camera.jpg', caption: 'Reversing camera display' },
  ];
  render(<Gallery customerView images={photos} heroImage={photos[0].url} />);
  expect(screen.getByRole('button', { name: 'Rear seats' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Boot space' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Parking camera' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Service history' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Outside' }));
  fireEvent.click(screen.getByRole('button', { name: 'Rear seats' }));
  const dialog = await screen.findByRole('dialog');
  expect(dialog.querySelector('.vehicle-lightbox-photo img')).toHaveAttribute('src', photos[1].url);
  expect(within(dialog).getByRole('button', { name: 'All photographs' })).toHaveAttribute('aria-pressed', 'true');
});

it('keeps condition photos available in their own category without inventing missing sections', async () => {
  const photos = [
    { url: 'https://example.com/condition-front.jpg', caption: 'Front view' },
    { url: 'https://example.com/condition-scratch.jpg', caption: 'Scratch on rear bumper' },
  ];
  render(<Gallery customerView images={photos} heroImage={photos[0].url} />);
  expect(screen.getByRole('button', { name: 'Outside' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Condition' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Inside' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Features' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Condition' }));
  await waitFor(() => expect(document.querySelector('.gallery-photo')).toHaveAttribute('src', photos[1].url));
  expect(screen.getByText('1 / 1')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'All photographs' }));
  expect(screen.getAllByRole('button', { name: /Show photograph/ })).toHaveLength(2);
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
  expect(screen.queryByText('Photograph unavailable')).not.toBeInTheDocument();
  expect(document.querySelector(`img[src="${photos[1]}"]`)).toBeNull();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Back to photo' }));
  expect(within(dialog).getByText('3 / 3')).toBeInTheDocument();
  expect(dialog.querySelector('.vehicle-lightbox-photo img')).toHaveAttribute('src', photos[3]);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('View all 3 photos')).toBeInTheDocument();
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

it('closes fullscreen and requests the shared enquiry with zero arguments despite the animation-frame timestamp', async () => {
  const car = { id: 'gallery-car', title: 'Ford Fiesta' } as Car;
  const onEnquiry = vi.fn();
  const originalFrame = globalThis.requestAnimationFrame.bind(globalThis);
  const frame = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(callback => originalFrame(() => callback(123456.75)));
  try {
    window.history.replaceState({}, '', '/vehicle/gallery-car');
    render(<Gallery car={car} customerView customerActions={{ enquiryHref: '#vehicle-enquiry', onEnquiry }} images={labelledPhotos} />);
    fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
    const dialog = await screen.findByRole('dialog');
    const message = within(dialog).getByRole('link', { name: 'Message' });
    expect(message).toHaveAttribute('href', '#vehicle-enquiry');
    fireEvent.click(message);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(onEnquiry).toHaveBeenCalledTimes(1));
    expect(frame).toHaveBeenCalled();
    expect(onEnquiry.mock.calls).toEqual([[]]);
    expect(window.location.pathname + window.location.search).toBe('/vehicle/gallery-car');
  } finally { frame.mockRestore(); }
});

const browsingCar = { id: 'gallery-car', title: 'Ford Fiesta' } as Car;
const browsingPhotos = Array.from({ length: 12 }, (_, i) => `https://example.com/gallery-photo-${i + 1}.jpg`);
const browsingActions = {
  enquiryHref: '/enquire?type=general&vehicleId=gallery-car',
};

it('keeps all photos uninterrupted, including the tenth photo and repeated browsing', async () => {
  const onEnquiry = vi.fn();
  render(<Gallery car={browsingCar} customerView customerActions={{ ...browsingActions, onEnquiry }} images={browsingPhotos} />);
  const next = screen.getByRole('button', { name: 'Next photograph' });
  next.focus();
  for (let photo = 2; photo <= 12; photo++) {
    fireEvent.click(next);
    expect(screen.getByText(`${photo} / 12`)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Keep browsing' })).not.toBeInTheDocument();
    expect(next).toHaveFocus();
  }
  fireEvent.click(next);
  expect(screen.getByText('1 / 12')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Previous photograph' }));
  expect(screen.getByText('12 / 12')).toBeInTheDocument();
  expect(onEnquiry).not.toHaveBeenCalled();
  await waitFor(() => expect(document.querySelector('.gallery-photo')).toHaveAttribute('src', browsingPhotos[11]));
});

it('keeps one accessible customer counter below the photo with a visible view-all action', () => {
  const { container } = render(<Gallery customerView images={labelledPhotos} />);
  expect(container.querySelector('.gallery-photo-counter')).not.toBeInTheDocument();
  const position = container.querySelector('.vehicle-gallery-position');
  expect(position).toHaveTextContent('1 / 4');
  expect(position?.closest('.vehicle-gallery-frame')).toBeNull();
  expect(screen.getAllByText('1 / 4')).toHaveLength(1);
  expect(screen.queryByText('1 / 4 photographs')).not.toBeInTheDocument();
  expect(screen.getByText('Front right')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'View all 4 photos' })).toBeVisible();
  const trigger = screen.getByRole('button', { name: 'View gallery fullscreen' });
  expect(document.getElementById(trigger.getAttribute('aria-describedby')!)).toHaveTextContent('1 / 4');
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 2 of 4' }));
  expect(screen.getAllByText('2 / 4')).toHaveLength(1);
  expect(screen.getByText('Interior seats')).toBeInTheDocument();
});

it('keeps thumbnail keyboard focus while moving through photo ten', async () => {
  render(<Gallery car={browsingCar} customerView customerActions={browsingActions} images={browsingPhotos} />);
  const ninth = screen.getByRole('button', { name: 'Show photograph 9 of 12' });
  fireEvent.click(ninth); ninth.focus();
  fireEvent.keyDown(ninth, { key: 'ArrowRight' });
  const tenth = screen.getByRole('button', { name: 'Show photograph 10 of 12' });
  await waitFor(() => expect(tenth).toHaveFocus());
  expect(tenth).toHaveAttribute('aria-current', 'true');
  fireEvent.keyDown(tenth, { key: 'ArrowRight' });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Show photograph 11 of 12' })).toHaveFocus());
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('lets deliberate swipes pass photo ten without an extra action', () => {
  const { container } = render(<Gallery car={browsingCar} customerView customerActions={browsingActions} images={browsingPhotos} />);
  const frame = container.querySelector('.vehicle-gallery-frame .touch-pan-y')!;
  for (let swipe = 0; swipe < 10; swipe++) {
    fireEvent.touchStart(frame, { touches: [{ clientX: 270, clientY: 120 }] });
    fireEvent.touchEnd(frame, { changedTouches: [{ clientX: 130, clientY: 123 }] });
  }
  expect(screen.getByText('11 / 12')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

it('keeps fullscreen keyboard browsing uninterrupted with one counter and closes on Escape', async () => {
  render(<Gallery car={browsingCar} customerView customerActions={browsingActions} images={browsingPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  for (let photo = 2; photo <= 11; photo++) {
    fireEvent.keyDown(dialog, { key: 'ArrowRight' });
    expect(within(dialog).getByText(`${photo} / 12`)).toBeInTheDocument();
    expect(within(dialog).getByRole('link', { name: 'Message' })).toHaveAttribute('href', browsingActions.enquiryHref);
    expect(within(dialog).getByRole('button', { name: 'Call us' })).toBeInTheDocument();
  }
  expect(screen.getAllByText('11 / 12')).toHaveLength(1);
  expect(dialog.querySelector('.vehicle-gallery-toolbar-count')).toHaveTextContent('11 / 12');
  expect(dialog.querySelector('.vehicle-lightbox-photo')).not.toHaveTextContent('11 / 12');
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getAllByText('11 / 12')).toHaveLength(1);
});

it('selects photo ten from the overview and returns focus to the photo controls', async () => {
  render(<Gallery car={browsingCar} customerView customerActions={browsingActions} images={browsingPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'All photos' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'View photograph 10 of 12' }));
  expect(within(dialog).queryByRole('region', { name: 'All 12 photographs' })).not.toBeInTheDocument();
  expect(within(dialog).getByText('10 / 12')).toBeInTheDocument();
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'All photos' })).toHaveFocus());
  fireEvent.keyDown(dialog, { key: 'ArrowRight' });
  expect(within(dialog).getByText('11 / 12')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('recovers failed photos and changes groups without interrupting customer browsing', async () => {
  const photos = [{ url: 'https://example.com/front-group-photo.jpg', caption: 'Front view' }, ...browsingPhotos.map((url, i) => ({ url, caption: `Interior seats ${i + 1}` }))];
  render(<Gallery car={browsingCar} customerView customerActions={browsingActions} images={photos} />);
  fireEvent.click(screen.getByRole('button', { name: 'Inside' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
  fireEvent.error(document.querySelector(`.vehicle-thumbnail-grid img[src="${browsingPhotos[9]}"]`)!);
  expect(screen.getByText('10 / 11')).toBeInTheDocument();
  await waitFor(() => expect(document.querySelector('.gallery-photo')).toHaveAttribute('src', browsingPhotos[10]));
  fireEvent.click(screen.getByRole('button', { name: 'Retry photos' }));
  expect(screen.getByText('1 / 13')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 13' }));
  expect(screen.getByText('10 / 13')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Like what you see?' })).not.toBeInTheDocument();
});

it('opens the explicit fullscreen enquiry after photo ten only when chosen', async () => {
  const onEnquiry = vi.fn();
  window.history.replaceState({}, '', '/vehicle/gallery-car');
  render(<Gallery car={browsingCar} customerView customerActions={{ enquiryHref: '#vehicle-enquiry', onEnquiry }} images={browsingPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  expect(onEnquiry).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole('link', { name: 'Message' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(onEnquiry).toHaveBeenCalledTimes(1));
  expect(window.location.pathname + window.location.search).toBe('/vehicle/gallery-car');
});

it('does not intercept a modified click on the explicit fullscreen enquiry', async () => {
  const onEnquiry = vi.fn();
  render(<Gallery car={browsingCar} customerView customerActions={{ enquiryHref: '#vehicle-enquiry', onEnquiry }} images={browsingPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('link', { name: 'Message' }), { ctrlKey: true });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(onEnquiry).not.toHaveBeenCalled();
});

it('does not offer a fallback message route when customer enquiries are explicitly disabled', async () => {
  render(<Gallery car={browsingCar} customerView customerActions={{}} images={browsingPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 10 of 12' }));
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  expect(within(dialog).queryByRole('link', { name: 'Message' })).not.toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: 'Call us' })).toBeInTheDocument();
  fireEvent.keyDown(dialog, { key: 'ArrowRight' });
  expect(within(dialog).getByText('11 / 12')).toBeInTheDocument();
});

it('adds one extra fullscreen zoom level with keyboard panning and Escape to return', async () => {
  render(<Gallery customerView images={browsingPhotos} />);
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
  render(<Gallery customerView images={browsingPhotos} />);
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

it('pinches the photo within bounded zoom without switching photographs and pinches back to fit', async () => {
  render(<Gallery customerView images={browsingPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  const frame = dialog.querySelector('.vehicle-lightbox-photo') as HTMLElement;
  const stage = frame.querySelector('.vehicle-photo-zoom-stage') as HTMLElement;
  const points = (distance: number) => [
    { identifier: 0, clientX: 200 - distance / 2, clientY: 150 },
    { identifier: 1, clientX: 200 + distance / 2, clientY: 150 },
  ];
  fireEvent.touchStart(frame, { touches: points(100), changedTouches: points(100) });
  fireEvent.touchMove(frame, { touches: points(200), changedTouches: points(200) });
  expect(frame).toHaveClass('vehicle-photo-zoomed');
  expect(parseFloat(stage.style.width)).toBeGreaterThan(100);
  expect(parseFloat(stage.style.width)).toBeLessThanOrEqual(300);
  expect(frame.querySelector('img')).toHaveAttribute('src', browsingPhotos[0]);
  expect(within(dialog).getByText('1 / 12')).toBeInTheDocument();
  fireEvent.touchMove(frame, { touches: points(900), changedTouches: points(900) });
  expect(parseFloat(stage.style.width)).toBeLessThanOrEqual(300);
  fireEvent.touchMove(frame, { touches: points(70), changedTouches: points(70) });
  expect(frame).not.toHaveClass('vehicle-photo-zoomed');
  expect(parseFloat(stage.style.width)).toBe(100);
  fireEvent.touchEnd(frame, { touches: [], changedTouches: points(70) });
  expect(within(dialog).getByText('1 / 12')).toBeInTheDocument();
  expect(frame.querySelector('img')).toHaveAttribute('src', browsingPhotos[0]);
});

it('does not turn a pinch-ending finger movement into a photo swipe', async () => {
  render(<Gallery customerView images={browsingPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  const dialog = await screen.findByRole('dialog');
  const frame = dialog.querySelector('.vehicle-lightbox-photo')!;
  const first = { identifier: 0, clientX: 140, clientY: 150 };
  const second = { identifier: 1, clientX: 240, clientY: 150 };
  fireEvent.touchStart(frame, { touches: [first], changedTouches: [first] });
  fireEvent.touchStart(frame, { touches: [first, second], changedTouches: [second] });
  const moved = [{ ...first, clientX: 90 }, { ...second, clientX: 290 }];
  fireEvent.touchMove(frame, { touches: moved, changedTouches: moved });
  fireEvent.touchEnd(frame, { touches: [{ ...first, clientX: 90 }], changedTouches: [{ ...second, clientX: 290 }] });
  fireEvent.touchEnd(frame, { touches: [], changedTouches: [{ ...first, clientX: 20 }] });
  expect(within(dialog).getByText('1 / 12')).toBeInTheDocument();
  expect(frame.querySelector('img')).toHaveAttribute('src', browsingPhotos[0]);
});

it('resets zoom when changing a category or closing and reopening the gallery', async () => {
  render(<Gallery customerView images={labelledPhotos} />);
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  let dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Zoom in' }));
  expect(dialog.querySelector('.vehicle-lightbox-photo')).toHaveClass('vehicle-photo-zoomed');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Inside' }));
  expect(dialog.querySelector('.vehicle-lightbox-photo')).not.toHaveClass('vehicle-photo-zoomed');
  await waitFor(() => expect(dialog.querySelector('.vehicle-lightbox-photo img')).toHaveAttribute('src', labelledPhotos[1].url));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Zoom in' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  dialog = await screen.findByRole('dialog');
  expect(dialog.querySelector('.vehicle-lightbox-photo')).not.toHaveClass('vehicle-photo-zoomed');
  expect(within(dialog).getByRole('button', { name: 'Zoom in' })).toHaveAttribute('aria-pressed', 'false');
  expect(dialog.querySelector('.vehicle-lightbox-photo img')).toHaveAttribute('src', labelledPhotos[1].url);
});
