import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { dealerConfig, type DealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import Warranty, {WarrantyContent} from './warranty';

const state = vi.hoisted(() => ({ settings: {} as DealerConfig, error: null as unknown, cars: [] as Car[], enquiriesEnabled: true }));
vi.mock('@/lib/dealer-settings-context', () => ({ useDealerSettings: () => ({ settings: state.settings, publicEnquiriesEnabled: state.enquiriesEnabled, isLoading: false, isError: false }) }));
vi.mock('@/lib/stock-context', () => ({ useStock: () => ({ stock: { cars: state.cars }, isLoading: false, error: state.error }) }));
vi.mock('@/hooks/use-page-meta', () => ({ usePageMeta: vi.fn() }));

beforeEach(() => {
  state.settings = structuredClone(dealerConfig);
  state.settings.identity.name = 'Fictional Motors';
  state.settings.warranty = { enabled: true, title: 'Our warranty options', description: 'Ask for the policy terms for this vehicle.', ctaLabel: 'Ask about warranty' };
  state.error = null;
  state.enquiriesEnabled = true;
  state.cars = [{ id: 'car-a', make: 'Ford', model: 'Fiesta', title: 'Ford Fiesta', year: 2020, price: 6500 } as Car];
  window.history.replaceState({}, '', '/warranty');
});

it('opens a warranty enquiry directly and retains the selected vehicle context', () => {
  render(<Warranty />);
  expect(screen.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', '/enquire?type=general');
  fireEvent.change(screen.getByLabelText(/Which car are you asking about/), { target: { value: 'car-a' } });
  expect(screen.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', '/enquire?type=general&vehicleId=car-a');
  expect(screen.getByTestId('warranty-whatsapp')).toHaveAttribute('href', expect.stringContaining('Ford%20Fiesta'));
  expect(document.querySelector('a[href="#warranty-enquiry"]')).toBeNull();
});

it('shows configured warranty copy without expanding a second generic FAQ', () => {
  render(<Warranty />);
  expect(screen.getByRole('heading', { name: 'Our warranty options' })).toBeInTheDocument();
  expect(screen.getByText('Ask for the policy terms for this vehicle.')).toBeInTheDocument();
  expect(screen.queryByText('Your warranty questions.')).not.toBeInTheDocument();
  expect(screen.getByText('The details worth checking.').closest('details')).not.toHaveAttribute('open');
});

it('uses the saved warranty action and policy wording while keeping the selected-car action contextual', () => {
  state.settings.presentation = { ...state.settings.presentation, websiteCopy: {
    warrantyDetailsHeading: 'Check your cover',
    warrantyDetailsIntroduction: 'Ask us to confirm the claim limit and servicing conditions.',
  } };
  render(<Warranty />);
  expect(screen.getByTestId('warranty-enquiry-link')).toHaveTextContent('Ask about warranty');
  const policy = screen.getByText('Check your cover').closest('details')!;
  fireEvent.click(screen.getByText('Check your cover'));
  expect(policy).toHaveTextContent('Ask us to confirm the claim limit and servicing conditions.');
  fireEvent.change(screen.getByLabelText(/Which car are you asking about/), { target: { value: 'car-a' } });
  expect(screen.getByTestId('warranty-enquiry-link')).toHaveTextContent('Enquire About This Car');
  expect(screen.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', '/enquire?type=general&vehicleId=car-a');
});

it.each(['Learn About Warranty', '  Learn About Warranty  ', ''])('keeps the enquiry action clear for an unchanged template CTA (%s)', ctaLabel => {
  state.settings.warranty!.ctaLabel = ctaLabel;
  render(<Warranty />);
  expect(screen.getByTestId('warranty-enquiry-link')).toHaveTextContent('Send a warranty enquiry');
  expect(screen.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', '/enquire?type=general');
});

it('keeps a general warranty enquiry available when the stock request fails', () => {
  state.error = new Error('Unavailable');
  state.cars = [];
  render(<Warranty />);
  expect(screen.getByLabelText(/Which car are you asking about/)).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load the vehicle list');
  expect(screen.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', '/enquire?type=general');
});

it('routes both warranty enquiry entrypoints to contact when website enquiries are off', () => {
  state.enquiriesEnabled = false;
  render(<Warranty />);
  expect(screen.getByTestId('warranty-enquiry-link')).toHaveAttribute('href', '/contact');
  expect(screen.getByRole('link', { name: 'Ask us for help' })).toHaveAttribute('href', '/contact');
});

it('keeps test warranty enquiries scoped to the chosen car and hides live contacts',()=>{
 const openGeneralEnquiry=vi.fn();document.documentElement.dataset.testModeSession='practice';
 try {
  render(<WarrantyContent testMode={{openGeneralEnquiry}}/>);
  expect(document.querySelector('a[href^=\"tel:\"]')).toBeNull();expect(document.querySelector('a[href*=\"wa.me\"]')).toBeNull();
  fireEvent.click(screen.getByTestId('warranty-enquiry-link'));expect(openGeneralEnquiry).toHaveBeenLastCalledWith(undefined);
  fireEvent.change(screen.getByLabelText(/Which car are you asking about/),{target:{value:'car-a'}});
  fireEvent.click(screen.getByTestId('warranty-enquiry-link'));expect(openGeneralEnquiry).toHaveBeenLastCalledWith(expect.objectContaining({id:'car-a'}));
  fireEvent.click(screen.getByRole('button',{name:'Ask us for help'}));expect(openGeneralEnquiry).toHaveBeenLastCalledWith();
 } finally {delete document.documentElement.dataset.testModeSession;}
});

it('fails closed if warranty is mounted in test mode without its adapter',()=>{
 document.documentElement.dataset.testModeSession='practice';
 try {render(<Warranty/>);expect(screen.getByRole('alert')).toHaveTextContent('unavailable in the test workspace');expect(document.querySelector('a[href^="tel:"]')).toBeNull();} finally {delete document.documentElement.dataset.testModeSession;}
});
