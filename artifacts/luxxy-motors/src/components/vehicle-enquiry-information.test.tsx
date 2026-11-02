import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MotHistory } from '@workspace/vehicle-meta';
import type { DealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { VehicleEnquiryInformation } from './vehicle-enquiry-information';

const now = new Date('2026-11-02T12:00:00Z');
const car = (values: Partial<Car> = {}) => ({
  id: 'car-a', make: 'Ford', model: 'Focus', variant: '1.0 EcoBoost Titanium',
  plate: 'AB12CDE', year: 2016, mileage: 42000, transmission: 'Automatic', fuel: 'Petrol',
  engineCC: 999, bodyType: 'Hatchback', colour: 'Blue', doors: 5, seats: 5,
  price: 5490, currency: 'GBP', ...values,
}) as Car;
const history = (values: Partial<MotHistory> = {}): MotHistory => ({
  registration: 'AB12 CDE', make: 'FORD', model: 'FOCUS', checkedAt: now.toISOString(), recall: 'Unknown',
  tests: [{ completedDate: '2026-10-03T10:00:00Z', expiryDate: '2027-10-02', result: 'PASSED', mileage: '42000', mileageUnit: 'MI', defects: [] }],
  ...values,
});
const dealer = (values: Partial<DealerConfig> = {}) => ({
  identity: { name: 'Test Motors' }, contact: {}, legal: {}, social: {},
  hero: { copy: '', subcopy: '', primaryCta: '', secondaryCta: '' },
  bookViewing: { title: '', description: '', ctaLabel: '' }, trustItems: [], ...values,
}) as DealerConfig;

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); });
afterEach(() => { vi.useRealTimers(); });

describe('vehicle enquiry context', () => {
  it('shows the selected car, readable facts, current MOT and decorative icons', () => {
    const request = vi.fn();
    render(<VehicleEnquiryInformation car={car()} motHistory={history()} requestMotHistory={request} dealer={dealer()} includedItems={[]} />);
    const panel = screen.getByRole('complementary', { name: 'Vehicle information and buying benefits' });
    expect(within(panel).getByRole('heading', { name: 'Ford Focus' })).toBeVisible();
    expect(within(panel).getByText('1.0 EcoBoost Titanium')).toBeVisible();
    expect(within(panel).getByText('£5,490')).toBeVisible();
    expect(screen.getByTestId('enquiry-vehicle-registration')).toHaveTextContent('AB12 CDE');
    expect(within(panel).getByText('42,000 miles')).toBeVisible();
    expect(within(panel).getByText('Automatic')).toBeVisible();
    expect(within(panel).getByText('1.0L')).toBeVisible();
    expect(screen.getByTestId('enquiry-vehicle-mot')).toHaveTextContent('MOT expires2 October 2027');
    expect(panel.querySelector('dt svg')).toHaveAttribute('aria-hidden', 'true');
    expect(request).not.toHaveBeenCalled();
  });

  it('shows a neutral confirmation prompt when MOT is unavailable and reuses the page lookup', () => {
    const request = vi.fn();
    render(<VehicleEnquiryInformation car={car()} motHistory={null} requestMotHistory={request} dealer={dealer()} includedItems={[]} />);
    expect(screen.getByTestId('enquiry-vehicle-mot')).toHaveTextContent('Ask us to confirm the current MOT.');
    expect(request).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/failed|exempt|no advisories/i)).not.toBeInTheDocument();
  });

  it.each([
    { checkedAt: '2026-10-31T12:00:00Z' },
    { registration: 'XY19ZZZ' },
  ])('requests a usable record rather than displaying stale or other-car MOT data (%j)', values => {
    const request = vi.fn();
    render(<VehicleEnquiryInformation car={car()} motHistory={history(values)} requestMotHistory={request} dealer={dealer()} includedItems={[]} />);
    expect(screen.getByTestId('enquiry-vehicle-mot')).toHaveTextContent('Ask us to confirm the current MOT.');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not request an MOT without a registration and keeps missing vehicle values out', () => {
    const request = vi.fn();
    render(<VehicleEnquiryInformation car={car({ plate: null, year: null, mileage: null, transmission: null, fuel: null, engineCC: null, bodyType: null, colour: null, doors: null, seats: null, price: null })} motHistory={null} requestMotHistory={request} includedItems={[]} />);
    expect(request).not.toHaveBeenCalled();
    expect(screen.getByText('Price on application')).toBeVisible();
    expect(screen.queryByTestId('enquiry-vehicle-registration')).not.toBeInTheDocument();
    expect(screen.queryByText('Unknown')).not.toBeInTheDocument();
  });

  it('shows the official first MOT due date without declaring a general exemption', () => {
    const request = vi.fn();
    render(<VehicleEnquiryInformation car={car()} motHistory={history({ tests: [], firstMotDueDate: '2027-10-02' })} requestMotHistory={request} dealer={dealer()} includedItems={[]} />);
    expect(screen.getByTestId('enquiry-vehicle-mot')).toHaveTextContent('First MOT due2 October 2027');
    expect(screen.queryByText(/exempt/i)).not.toBeInTheDocument();
    expect(request).not.toHaveBeenCalled();
  });
});

describe('saved dealership benefits', () => {
  it('shows exactly the configured inclusions and their qualifications', () => {
    render(<VehicleEnquiryInformation car={car()} motHistory={history()} requestMotHistory={vi.fn()} dealer={dealer()} includedItems={['6 months warranty', 'Delivery available at additional cost']} />);
    const section = screen.getByRole('region', { name: 'What’s included' });
    expect(within(section).getAllByRole('listitem').map(item => item.textContent)).toEqual(['6 months warranty', 'Delivery available at additional cost']);
    expect(section.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
    expect(section).not.toHaveTextContent(/free|12 months/i);
  });

  it('hides all dealer benefits while dealer settings are unavailable even if inclusions were passed', () => {
    render(<VehicleEnquiryInformation car={car({ description: '3 months warranty included.' })} motHistory={history()} requestMotHistory={vi.fn()} includedItems={['6 months warranty', 'Free delivery']} />);
    expect(screen.queryByRole('region', { name: 'What’s included' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Why (?:choose|buy)/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Warranty details' })).not.toBeInTheDocument();
    expect(screen.queryByText(/months warranty|free delivery/i)).not.toBeInTheDocument();
  });

  it('respects an explicitly empty list and does not recover an older feed warranty', () => {
    render(<VehicleEnquiryInformation car={car({ description: '3 months warranty included.', includedItems: ['Feed-only handbook'] })} motHistory={history()} requestMotHistory={vi.fn()} dealer={dealer({ presentation: { includedItems: [] } })} includedItems={[]} />);
    expect(screen.queryByRole('region', { name: 'What’s included' })).not.toBeInTheDocument();
    expect(screen.queryByText(/3 months|handbook/i)).not.toBeInTheDocument();
  });

  it('treats warranty availability as an information link without promising included cover', () => {
    render(<VehicleEnquiryInformation car={car()} motHistory={history()} requestMotHistory={vi.fn()} dealer={dealer({ warranty: { enabled: true, title: 'Warranty options', description: 'Ask about available warranty cover.', ctaLabel: 'Read more' } })} includedItems={[]} />);
    expect(screen.getByRole('link', { name: 'Warranty details' })).toHaveAttribute('href', '/warranty');
    expect(screen.queryByRole('region', { name: 'What’s included' })).not.toBeInTheDocument();
    expect(screen.getByTestId('vehicle-enquiry-information')).not.toHaveTextContent(/warranty included|months warranty|free cover/i);
  });

  it('keeps extra saved reasons collapsed on demand and invents no generic sales claims', () => {
    const reasons = [
      { title: 'Friendly local team', description: 'Speak with our showroom team.' },
      { title: 'Clear paperwork', description: 'Ask us to explain the documents.' },
      { title: 'Your collection', description: 'Agree a collection time with us.' },
      { title: 'Flexible visits', description: 'Contact us to discuss a visit.' },
      { title: 'Trade-in advice', description: 'Discuss your current car.' },
    ];
    render(<VehicleEnquiryInformation car={car()} motHistory={history()} requestMotHistory={vi.fn()} dealer={dealer({ whyBuy: reasons, trustItems: ['This fallback must not appear'] })} includedItems={[]} />);
    const section = screen.getByRole('region', { name: 'Why choose Test Motors' });
    expect(within(section).getByText('Friendly local team')).toBeVisible();
    expect(within(section).getByText('Your collection')).toBeVisible();
    const summary = within(section).getByText('More about buying from us');
    const details = summary.closest('details')!;
    expect(details).not.toHaveAttribute('open');
    expect(within(details).getAllByRole('listitem', { hidden: true })).toHaveLength(2);
    expect(within(details).getByText('Flexible visits')).not.toBeVisible();
    fireEvent.click(summary);
    expect(details).toHaveAttribute('open');
    expect(within(details).getByText('Flexible visits')).toBeVisible();
    expect(section).not.toHaveTextContent(/fallback|price.checked|multipoint|hpi clear/i);
  });

  it('uses saved trust items as a fallback and removes duplicate reason titles', () => {
    render(<VehicleEnquiryInformation car={car()} motHistory={history()} requestMotHistory={vi.fn()} dealer={dealer({ trustItems: ['Local showroom', 'local showroom', 'Talk to our team'] })} includedItems={[]} />);
    const section = screen.getByRole('region', { name: 'Why choose Test Motors' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    expect(section).toHaveTextContent('Local showroom');
    expect(section).toHaveTextContent('Talk to our team');
  });

  it('uses only enabled described services as a qualified fallback and does not repeat included warranty', () => {
    const services = dealer({
      warranty: { enabled: true, title: 'Warranty', description: 'Warranty may be available at an additional cost.', ctaLabel: 'Read more' },
      delivery: { enabled: true, title: 'Delivery', description: 'Delivery depends on your postcode; ask us for a quote.', ctaLabel: 'Ask us' },
      partExchange: { enabled: true, title: 'Part exchange', description: 'We can discuss your car, subject to inspection.', ctaLabel: 'Get in touch' },
    });
    const props = { car: car(), motHistory: history(), requestMotHistory: vi.fn(), dealer: services, includedItems: [] };
    const { rerender } = render(<VehicleEnquiryInformation {...props} />);
    let section = screen.getByRole('region', { name: 'Why choose Test Motors' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(3);
    expect(section).toHaveTextContent('Warranty optionsWarranty may be available at an additional cost.');
    expect(section).toHaveTextContent('Delivery optionsDelivery depends on your postcode; ask us for a quote.');
    expect(section).toHaveTextContent('Part exchange welcomeWe can discuss your car, subject to inspection.');
    expect(section).not.toHaveTextContent(/free|guaranteed|always accepted/i);

    rerender(<VehicleEnquiryInformation {...props} includedItems={['6 months warranty']} />);
    section = screen.getByRole('region', { name: 'Why choose Test Motors' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(2);
    expect(within(section).queryByText('Warranty options')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'What’s included' })).toHaveTextContent('6 months warranty');

    rerender(<VehicleEnquiryInformation {...props} dealer={dealer({
      warranty: { ...services.warranty!, enabled: false },
      delivery: { ...services.delivery!, enabled: false },
      partExchange: { ...services.partExchange!, description: '  ' },
    })} />);
    expect(screen.queryByRole('region', { name: 'Why choose Test Motors' })).not.toBeInTheDocument();
  });

  it('prioritises saved buying reasons and trust items over service fallback content', () => {
    const services = dealer({
      whyBuy: [{ title: 'Meet the local team', description: 'Our saved reason for choosing this dealership.' }],
      trustItems: ['A saved trust statement'],
      warranty: { enabled: true, title: 'Warranty', description: 'Ask about warranty terms.', ctaLabel: 'Read more' },
      delivery: { enabled: true, title: 'Delivery', description: 'Ask about delivery costs.', ctaLabel: 'Ask us' },
    });
    const props = { car: car(), motHistory: history(), requestMotHistory: vi.fn(), includedItems: [] };
    const { rerender } = render(<VehicleEnquiryInformation {...props} dealer={services} />);
    let section = screen.getByRole('region', { name: 'Why choose Test Motors' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(1);
    expect(section).toHaveTextContent('Meet the local team');
    expect(section).not.toHaveTextContent(/saved trust statement|Warranty options|Delivery options/);

    rerender(<VehicleEnquiryInformation {...props} dealer={{ ...services, whyBuy: [] }} />);
    section = screen.getByRole('region', { name: 'Why choose Test Motors' });
    expect(within(section).getAllByRole('listitem')).toHaveLength(1);
    expect(section).toHaveTextContent('A saved trust statement');
    expect(section).not.toHaveTextContent(/Meet the local team|Warranty options|Delivery options/);
  });
});
