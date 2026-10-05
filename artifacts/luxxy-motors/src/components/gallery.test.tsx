import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { beforeAll, expect, it, vi } from 'vitest';
import { Gallery } from './gallery';

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
  expect(screen.getByText('Photographs to follow')).toBeInTheDocument();
});

const labelledPhotos = [
  { url: 'https://example.com/front.jpg', caption: 'Front right' },
  { url: 'https://example.com/seats.jpg', caption: 'Interior seats' },
  { url: 'https://example.com/wheel.jpg', caption: 'Alloy wheel' },
  { url: 'https://example.com/other.jpg', caption: 'Another photograph' },
];

it('keeps every customer photograph reachable without category tabs', async () => {
  render(<Gallery customerView images={labelledPhotos} />);
  expect(screen.queryByLabelText('Photograph sections')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /Show photograph/ })).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Show photograph 2 of 4' }));
  expect(screen.getByText('2 / 4 photographs')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'View gallery fullscreen' }));
  expect(await screen.findByRole('dialog')).toBeInTheDocument();
  expect(screen.queryByLabelText('Photograph sections')).not.toBeInTheDocument();
  fireEvent.keyDown(screen.getByRole('dialog'), { key: 'ArrowRight' });
  expect(screen.getByText('3 / 4')).toBeInTheDocument();
});

it('retains photograph sections for the staff gallery', () => {
  render(<Gallery images={labelledPhotos} />);
  expect(screen.getByLabelText('Photograph sections')).toBeInTheDocument();
  screen.getByRole('button', { name: 'Show photograph 2 of 4' }).scrollIntoView = vi.fn();
  fireEvent.click(screen.getByRole('button', { name: 'Interior' }));
  expect(screen.getByText('2 / 4 photographs')).toBeInTheDocument();
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
