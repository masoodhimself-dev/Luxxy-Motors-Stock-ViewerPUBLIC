import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { VehicleSourceReportCar } from '@/lib/vehicle-source-report';
import { VehicleSourceReport } from './vehicle-source-report';

function car(): VehicleSourceReportCar {
  return { advertId: '80238245', advertUrl: 'https://www.cazoo.co.uk/cars-for-sale/80238245/', sourceExtras: {
    sourcePlatform: 'cazoo', sourceReport: {
      version: 1, platform: 'cazoo', sourceUrl: 'https://www.cazoo.co.uk/cars-for-sale/80238245/',
      capturedAt: '2026-10-24T20:01:35+01:00',
      ulez: { status: 'compliant', sourceText: 'Yes' },
      history: { caveat: 'Guidance only. Results supplied by CAP HPI.', checks: [
        { name: 'Not stolen', status: 'passed', sourceText: 'All passed' },
        { name: 'Mileage', status: 'advisory', sourceText: 'Check the readings' },
        { name: 'Outstanding finance', status: 'failed', sourceText: 'Failed' },
        { name: 'Imported', status: 'unknown', sourceText: 'Not available' },
      ] },
    },
  } };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-24T20:00:00Z')); });
afterEach(() => vi.useRealTimers());

it('shows vehicle information without marketplace labels or source bookkeeping', () => {
  render(<VehicleSourceReport car={car()} />);
  expect(screen.getByRole('region', { name: 'Vehicle checks' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'ULEZ compliant' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Check ULEZ status' })).toHaveAttribute('href', 'https://tfl.gov.uk/modes/driving/check-your-vehicle/');
  expect(screen.getByRole('link', { name: 'Check ULEZ status' })).toHaveAttribute('rel', 'noopener noreferrer');
  expect(screen.queryByText(/Cazoo|CAP HPI|Captured|Source wording|24 Oct 2026/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/TfL verified|HPI clear|roadworthy/i)).not.toBeInTheDocument();
});

it('keeps history compact and shows clear statuses and useful result details', () => {
  const { container } = render(<VehicleSourceReport car={car()} />);
  const details = container.querySelector('details')!;
  expect(details.open).toBe(false);
  fireEvent.click(screen.getByText('History checks'));
  expect(details.open).toBe(true);
  const rows = screen.getAllByRole('listitem');
  expect(rows).toHaveLength(4);
  expect(within(rows[0]).getByText('Not stolen')).toBeVisible();
  expect(screen.getByText('Check the readings')).toBeVisible();
  for (const label of ['Passed', 'Advisory', 'Issue found', 'Not confirmed']) expect(screen.getByText(label)).toBeVisible();
  expect(screen.queryByText(/All passed|source results|source-reported|CAP HPI/i)).not.toBeInTheDocument();
});

it('keeps a known Category S visible and gives it priority over a conflicting write-off pass', () => {
  const input = { ...car(), writeOffCategory: 'S' };
  (input.sourceExtras!.sourceReport as { history: { checks: unknown[] } }).history.checks.push({ name: 'Not written off', status: 'passed', sourceText: 'All passed' });
  const { container } = render(<VehicleSourceReport car={input} />);
  expect(within(container.querySelector('aside')!).getByText('Category S')).toBeVisible();
  fireEvent.click(screen.getByText('History checks'));
  const insuranceRow = screen.getByText('Insurance history').closest('li')!;
  expect(within(insuranceRow).getByText('Category S')).toBeVisible();
  expect(within(insuranceRow).getByText('See disclosure')).toBeVisible();
  expect(within(insuranceRow).queryByText('Passed')).not.toBeInTheDocument();
  expect(container.querySelector('summary')).toHaveTextContent('History checks');
  expect(container.querySelector('summary')).not.toHaveTextContent(/passed|clear|safe|verified/i);
});

it('renders useful result details as plain text, never executable HTML', () => {
  const input = car();
  const report = input.sourceExtras!.sourceReport as { history: { checks: unknown[] } };
  report.history.checks = [{ name: 'Mileage', status: 'unknown', sourceText: '<img src=x onerror=alert(1)> Check readings.' }];
  const { container } = render(<VehicleSourceReport car={input} />);
  fireEvent.click(screen.getByText('History checks'));
  expect(screen.getByText('<img src=x onerror=alert(1)> Check readings.')).toBeVisible();
  expect(container.querySelector('img')).toBeNull();
});

it('never labels an unknown or contradictory result as passed', () => {
  const input = car();
  const report = input.sourceExtras!.sourceReport as { history: { checks: unknown[] } };
  report.history.checks = [{ name: 'Not stolen', status: 'passed', sourceText: 'Unknown' }];
  render(<VehicleSourceReport car={input} />);
  fireEvent.click(screen.getByText('History checks'));
  expect(screen.queryByText('Passed')).not.toBeInTheDocument();
  expect(screen.getByText('Not confirmed')).toBeVisible();
});

it('leaves existing Auto Trader vehicles and invalid or missing reports unchanged', () => {
  const { container, rerender } = render(<VehicleSourceReport car={{ ...car(), sourceExtras: null }} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<VehicleSourceReport car={{ ...car(), sourceExtras: { sourcePlatform: 'autotrader', sourceReport: car().sourceExtras!.sourceReport } }} />);
  expect(container).toBeEmptyDOMElement();
  rerender(<VehicleSourceReport car={{ ...car(), advertId: 'another-car' }} />);
  expect(container).toBeEmptyDOMElement();
});
