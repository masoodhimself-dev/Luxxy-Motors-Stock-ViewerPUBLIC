import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import Contact, {ContactContent} from './contact';
const state = vi.hoisted(() => ({ sample: false, loading: false, error: false }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ publicEnquiriesEnabled:true, settings: { ...dealerConfig, testDriveBooking:{enabled:true}, address: { street: state.sample ? '12 Example Road' : 'Rear of 176 Rayners Lane', city: 'London', postcode: 'HA2 8LY' } }, isLoading: state.loading, isError: state.error }) }));
vi.mock('@/hooks/use-page-meta', () => ({ usePageMeta: vi.fn() }));
beforeEach(() => { state.sample = false; state.loading = false; state.error = false; });
it('offers directions and copy address from the saved real address even with no map link', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  render(<Contact />);
  expect(screen.getByRole('link', { name: 'Get directions' })).toHaveAttribute('href', 'https://www.google.com/maps/search/?api=1&query=Rear%20of%20176%20Rayners%20Lane%2C%20London%2C%20HA2%208LY');
  fireEvent.click(screen.getByRole('button', { name: 'Copy address' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Address copied');
  expect(writeText).toHaveBeenCalledWith('Rear of 176 Rayners Lane, London, HA2 8LY');
});
it.each(['sample', 'loading', 'error'] as const)('does not offer navigation to unconfirmed address (%s)', key => {
  state[key] = true;
  render(<Contact />);
  expect(screen.queryByRole('link', { name: 'Get directions' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Copy address' })).not.toBeInTheDocument();
});

it('keeps test contact actions inside the preview and suppresses live contact links',()=>{
 const openGeneralEnquiry=vi.fn(),openBooking=vi.fn();
 document.documentElement.dataset.testModeSession='practice';
 try {
  render(<ContactContent testMode={{openGeneralEnquiry,openBooking}}/>);
  expect(document.querySelector('a[href^=\"tel:\"]')).toBeNull();expect(document.querySelector('a[href^=\"mailto:\"]')).toBeNull();expect(document.querySelector('a[href*=\"wa.me\"]')).toBeNull();
  expect(screen.queryByRole('link',{name:'Get directions'})).not.toBeInTheDocument();expect(screen.queryByRole('button',{name:'Copy address'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Send an enquiry'}));fireEvent.click(screen.getByRole('button',{name:'Book a Test Drive'}));
  expect(openGeneralEnquiry).toHaveBeenCalledOnce();expect(openBooking).toHaveBeenCalledOnce();
 } finally {delete document.documentElement.dataset.testModeSession;}
});

it('fails closed if the contact page is mounted in test mode without its adapter',()=>{
 document.documentElement.dataset.testModeSession='practice';
 try {render(<Contact/>);expect(screen.getByRole('alert')).toHaveTextContent('unavailable in the test workspace');expect(document.querySelector('a[href^="tel:"]')).toBeNull();} finally {delete document.documentElement.dataset.testModeSession;}
});
