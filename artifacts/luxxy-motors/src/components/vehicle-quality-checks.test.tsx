import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { Car } from '@/lib/stock-context';
import { VehicleQualityChecks } from './vehicle-quality-checks';

const car = { id: 'car-a', advertId: 'car-a', sourceExtras: null, specifications: null } as Car;

it('offers all ten checks without inventing passed results and prefills a question for the current car', () => {
  const ask = vi.fn();
  render(<VehicleQualityChecks car={car} onAskTeam={ask} />);
  const section = screen.getByRole('region', { name: 'Quality is assured' });
  expect(within(section).getAllByRole('listitem')).toHaveLength(10);
  expect(within(section).queryByText('Passed')).not.toBeInTheDocument();
  fireEvent.click(within(section).getByRole('button', { name: 'Ask about these checks' }));
  expect(ask).toHaveBeenCalledWith('Could you confirm the vehicle checks and preparation completed on this car?');
});

it('keeps a working contact fallback when website enquiries are disabled', () => {
  render(<VehicleQualityChecks car={car} />);
  expect(screen.getByRole('link', { name: 'Contact the showroom' })).toHaveAttribute('href', '/contact');
  expect(screen.queryByRole('button', { name: 'Ask about these checks' })).not.toBeInTheDocument();
});

it('shows the dealership-confirmed completed checklist without an unnecessary enquiry prompt', () => {
  render(<VehicleQualityChecks car={car} dealerConfirmed />);
  expect(screen.getAllByText('Passed')).toHaveLength(10);
  expect(screen.queryByText('Ask us')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Contact the showroom' })).not.toBeInTheDocument();
});

it('takes customers to the existing insurance history instead of claiming a category car passed HPI', () => {
  render(<VehicleQualityChecks car={{ ...car, writeOffCategory: 'S' }} dealerConfirmed />);
  const row = screen.getByText('HPI Check').closest('li')!;
  expect(within(row).queryByText('Passed')).not.toBeInTheDocument();
  expect(within(row).getByText('Category S recorded. Please read the insurance history.')).toBeVisible();
  expect(screen.getAllByText('Passed')).toHaveLength(9);
  expect(within(row).getByRole('link', { name: 'See history' })).toHaveAttribute('href', '#vehicle-history-section');
});
