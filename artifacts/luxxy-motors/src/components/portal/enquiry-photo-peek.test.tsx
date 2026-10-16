import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { EnquiryPhotoPeek } from './enquiry-photo-peek';

const car = {
  id: 'stock-car', title: 'Ford Fiesta', year: 2019,
  heroImage: 'https://example.test/car.jpg', colour: 'Blue',
  plate: null, vrm: null, registration: '2019 (19 reg)', registrationBand: '19 reg',
} as Car;

function showPreview(vehicle: Car) {
  render(<EnquiryPhotoPeek car={vehicle} className="photo" />);
  fireEvent.mouseEnter(screen.getByRole('img', { name: 'Preview Ford Fiesta' }).parentElement!);
  return screen.getByRole('status', { name: 'Enlarged photo of Ford Fiesta' });
}

it.each([
  [{ plate: ' ab19 xyz ' }, 'AB19 XYZ'],
  [{ plate: '   ', vrm: ' xy19 abc ' }, 'XY19 ABC'],
  [{ registration: ' a123 bcd ' }, 'A123 BCD'],
])('shows the supplied number plate in the staff photo preview', (fields, expected) => {
  const preview = showPreview({ ...car, ...fields });
  expect(within(preview).getByText(expected)).toHaveClass('bg-yellow-300');
  expect(preview).not.toHaveTextContent('2019 (19 reg)');
  expect(preview).not.toHaveTextContent('Number plate not supplied');
});

it('keeps an age registration label as text when no number plate was supplied', () => {
  const preview = showPreview(car);
  expect(preview).toHaveTextContent('2019 (19 reg) · Number plate not supplied');
  expect(preview.querySelector('.bg-yellow-300')).toBeNull();
});


it('uses stock images when an imported car has no separate hero image', () => {
  showPreview({ ...car, heroImage: null, images: [{ url: 'https://example.test/front.jpg', caption: 'Front left' }] } as Car);
  expect(screen.getByRole('img', { name: 'Preview Ford Fiesta' })).toHaveAttribute('src', 'https://example.test/front.jpg');
});

it('does not keep a different car hidden after an earlier image failed', () => {
  const view = render(<EnquiryPhotoPeek car={car} className="photo" />);
  fireEvent.error(screen.getByRole('img', { name: 'Preview Ford Fiesta' }));
  expect(screen.queryByRole('img')).not.toBeInTheDocument();
  view.rerender(<EnquiryPhotoPeek car={{ ...car, heroImage: 'https://example.test/replacement.jpg' }} className="photo" />);
  expect(screen.getByRole('img', { name: 'Preview Ford Fiesta' })).toHaveAttribute('src', 'https://example.test/replacement.jpg');
});
