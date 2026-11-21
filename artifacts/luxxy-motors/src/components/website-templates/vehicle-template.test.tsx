import { render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { Gallery } from '@/components/gallery';
import { CustomerTemplateVehicle } from './vehicle-template';

vi.mock('@/components/vehicle-call', () => ({ VehicleCall: () => <button type="button">Call us</button> }));
const show = (car: Car) => render(<CustomerTemplateVehicle template="panorama" car={car} identity={<h1>Test vehicle</h1>} gallery={<Gallery customerView hideInlineThumbnails images={car.images} heroImage={car.heroImage}/>} price={<p>Ask for price</p>} registration={null} facts={null} mot={null} actions={null} highlights={null} reservation={null} photoRequest={null}/>);

it('reads the Showroom gallery, price and reply action before the specifications', () => {
  render(<CustomerTemplateVehicle template="showroom" car={{ id: 'showroom-order' } as Car} identity={<h1>Test vehicle</h1>} gallery={<div role="region" aria-label="Car photographs"/>} price={<p>£10,000</p>} actions={<button>Ask about this car</button>} facts={<dl><dt>Mileage</dt><dd>50,000 miles</dd></dl>} registration={null} mot={null} highlights={null} reservation={null} photoRequest={null}/>);
  const gallery = screen.getByRole('region', { name: 'Car photographs' }), price = screen.getByText('£10,000'), action = screen.getByRole('button', { name: 'Ask about this car' }), mileage = screen.getByText('50,000 miles');
  expect(gallery.compareDocumentPosition(price) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(price.compareDocumentPosition(action) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(action.compareDocumentPosition(mileage) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.getAllByText('£10,000')).toHaveLength(1);
  expect(screen.getAllByText('50,000 miles')).toHaveLength(1);
});

it('puts Regent Lane buying controls beside one gallery and keeps the supplied facts and contact flow', () => {
  const { container } = render(<CustomerTemplateVehicle template="regent-lane" car={{ id: 'regent-car' } as Car}
    identity={<h1>Volvo V90</h1>} gallery={<div role="region" aria-label="Car photographs" />}
    price={<p>£15,500</p>} registration={<p>SF21 JXG</p>} facts={<dl><dt>Mileage</dt><dd>92,000 miles</dd></dl>}
    mot={<button>MOT history</button>} actions={<><a href="#vehicle-enquiry">Message</a><a href="/enquire?type=viewing">Book a test drive</a></>}
    highlights={<p>Full service history</p>} reservation={<button>Reserve for £99</button>}
    photoRequest={<a href="#vehicle-enquiry">Ask for more photos</a>}/>);
  const purchase = within(screen.getByRole('complementary', { name: 'Buying this car' }));
  expect(container.querySelector('[data-template-composition="regent-lane"]')).not.toBeNull();
  expect(screen.getAllByRole('region', { name: 'Car photographs' })).toHaveLength(1);
  expect(purchase.getByText('£15,500')).toBeInTheDocument();
  expect(purchase.getByText('SF21 JXG')).toBeInTheDocument();
  expect(purchase.getByRole('button', { name: 'MOT history' })).toBeInTheDocument();
  expect(purchase.getByRole('button', { name: 'Reserve for £99' })).toBeInTheDocument();
  expect(purchase.getByRole('link', { name: 'Message' })).toHaveAttribute('href', '#vehicle-enquiry');
  expect(screen.getByRole('heading', { name: 'At a glance' })).toBeVisible();
  expect(screen.getByText('92,000 miles')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Ask for more photos' })).toBeInTheDocument();
});

it('shows photograph two in the companion without dropping an external hero or changing the main gallery count', () => {
  const hero = 'https://example.com/hero.jpg', dash = 'https://example.com/dash.jpg', wheel = 'https://example.com/wheel.jpg';
  const { container } = show({ id: 'companion-test', images: [{ url: wheel, caption: 'Alloy wheel' }, { url: dash, caption: 'Dashboard' }], heroImage: hero } as Car);
  expect(screen.getByText('1 / 3')).toBeInTheDocument();
  const companion = container.querySelector('.ct-vehicle-companion')!;
  expect(within(companion as HTMLElement).getByText('2 / 3')).toBeInTheDocument();
  expect(companion.querySelector('.gallery-photo')).toHaveAttribute('src', dash);
  expect(screen.getAllByRole('button', { name: 'View all 3 photos' })).toHaveLength(2);
});

it('does not create a second gallery from a duplicate of the only photograph', () => {
  const hero = 'https://example.com/only.jpg';
  const { container } = show({ id: 'single-test', images: [hero, hero], heroImage: hero } as Car);
  expect(container.querySelector('.ct-vehicle-companion')).toBeNull();
  expect(screen.getByText('1 / 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'View photo' })).toBeInTheDocument();
});
