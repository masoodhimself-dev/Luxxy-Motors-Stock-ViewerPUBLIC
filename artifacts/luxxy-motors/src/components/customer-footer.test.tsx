import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { dealerConfig } from '@/config/dealer';
import { CustomerFooter } from './customer-footer';

vi.mock('wouter', () => ({ Link: ({ children, href, ...props }: any) => <a href={href} {...props}>{children}</a> }));

describe('public footer settings', () => {
  it('keeps the configured booking wording and the current vehicle link together', () => {
    render(<CustomerFooter settings={{ ...dealerConfig, testDriveBooking: { enabled: true }, bookViewing: { ...dealerConfig.bookViewing, ctaLabel: 'Arrange a test drive' } }} testDriveHref="/enquire?type=viewing&vehicleId=example-car" />);
    expect(screen.getByRole('link', { name: 'Arrange a test drive' })).toHaveAttribute('href', '/enquire?type=viewing&vehicleId=example-car');
  });

  it('does not advertise disabled services or opening hours that have not been supplied', () => {
    render(<CustomerFooter settings={{ ...dealerConfig, hours: [], warranty: { ...dealerConfig.warranty!, enabled: false }, delivery: { ...dealerConfig.delivery!, enabled: false }, partExchange: { ...dealerConfig.partExchange!, enabled: false } }} testDriveHref="/enquire?type=viewing" />);
    for (const name of ['Part exchange', 'Warranty options', 'Delivery options', 'All hours & visiting details']) expect(screen.queryByRole('link', { name })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Opening hours' })).toBeNull();
  });

  it('uses the dealership contact, address, directions and legal information', () => {
    render(<CustomerFooter settings={{ ...dealerConfig, contact: { phone: '020 7946 0123', email: 'sales@example.test' }, address: { street: '10 High Street', city: 'London', postcode: 'SW1A 1AA', mapsUrl: 'https://maps.example.test/showroom' }, legal: { companyName: 'Example Motors Ltd', companyNumber: '12345678', privacyUrl: 'https://example.test/privacy' } }} testDriveHref="/enquire?type=viewing" />);
    expect(screen.getByRole('link', { name: 'sales@example.test' })).toHaveAttribute('href', 'mailto:sales@example.test');
    expect(screen.getByRole('link', { name: 'Get directions' })).toHaveAttribute('href', 'https://maps.example.test/showroom');
    expect(screen.getByRole('link', { name: 'Privacy policy' })).toHaveAttribute('href', 'https://example.test/privacy');
    expect(screen.getByText('10 High Street')).toBeInTheDocument();
    expect(screen.getByText('Company no. 12345678')).toBeInTheDocument();
    expect(screen.getByText(/Example Motors Ltd. All rights reserved/)).toBeInTheDocument();
  });
});

it('removes disabled enquiry and booking entry points while keeping direct contact', () => {
  render(<CustomerFooter settings={{ ...dealerConfig, testDriveBooking: { enabled: false } }} enquiriesEnabled={false} testDriveHref="/enquire?type=viewing" />);
  expect(screen.queryByRole('link', { name: /Book a Test Drive|Send an enquiry/i })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Contact & directions' })).toHaveAttribute('href', '/contact');
});

it('keeps delivery help reachable without linking to disabled website enquiries', () => {
  render(<CustomerFooter settings={{ ...dealerConfig, delivery: { ...dealerConfig.delivery!, enabled: true } }} enquiriesEnabled={false} testDriveHref="/enquire?type=viewing" />);
  expect(screen.getByRole('link', { name: 'Delivery options' })).toHaveAttribute('href', '/contact');
});
