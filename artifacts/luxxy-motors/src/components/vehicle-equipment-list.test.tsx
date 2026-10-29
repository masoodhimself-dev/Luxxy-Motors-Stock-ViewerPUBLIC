import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { VehicleEquipmentList } from './vehicle-equipment-list';

it('leads with useful supplied equipment, then groups the rest without dropping entries', () => {
  const features = ['Chrome Trim', 'Parking Sensor - Front', 'Factory specification ABC', 'Heated Front Seats', '17in Alloy Wheels', 'Alarm'];
  const original = [...features];
  const { container } = render(<VehicleEquipmentList features={features} />);
  const highlights = screen.getByRole('list', { name: 'Feature highlights' });
  expect(within(highlights).getAllByRole('button').map(button => button.textContent)).toEqual(['Front parking sensors', 'Heated front seats']);
  const more = container.querySelector('details')!;
  expect(more).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('View all equipment'));
  expect(more).toHaveAttribute('open');
  expect(screen.getByRole('list', { name: 'Exterior & styling' })).toHaveTextContent('Chrome Trim');
  expect(screen.getByRole('list', { name: 'Safety & driver assistance' })).toHaveTextContent('Alarm');
  expect(screen.getByRole('list', { name: 'Other equipment' })).toHaveTextContent('Factory specification ABC');
  expect(container.querySelectorAll('li')).toHaveLength(features.length);
  expect(features).toEqual(original);
});
it('keeps the highlight section concise and retains the rest in the full equipment list', () => {
  const features = ['Parking Sensor - Front', 'Parking Sensor - Rear', 'Cruise Control', 'Automatic Climate Control', 'Heated Front Seats', 'Heated Rear Seats', 'Bluetooth Telephone', 'Bluetooth Audio', 'Satellite Navigation', 'ISOFIX Mounts', 'Reversing Camera', 'Apple CarPlay'];
  const { container } = render(<VehicleEquipmentList features={features} />);
  expect(within(screen.getByRole('list', { name: 'Feature highlights' })).getAllByRole('listitem')).toHaveLength(6);
  fireEvent.click(screen.getByText('View all equipment'));
  expect(container.querySelectorAll('li')).toHaveLength(features.length);
});
it('preserves equipment explanation dialogs and returns focus', async () => {
  render(<VehicleEquipmentList features={['Parking Sensor - Front']} />);
  const trigger = screen.getByRole('button', { name: 'Front parking sensors' });
  fireEvent.click(trigger.querySelector('svg')!);
  expect(screen.getByRole('dialog', { name: 'Front parking sensors' })).toHaveAccessibleDescription(/at the front/);
  fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
  await waitFor(() => expect(trigger).toHaveFocus());
});
it('keeps absent and optional equipment out of highlights while preserving the exact supplied wording', () => {
  const features = ['No heated seats', 'Optional parking sensors', 'Telephone Keypad', 'Chrome Trim'];
  const { container } = render(<VehicleEquipmentList features={features} />);
  expect(screen.queryByRole('list', { name: 'Feature highlights' })).toBeNull();
  fireEvent.click(screen.getByText('View all equipment'));
  for (const text of features) expect(screen.getByText(text)).toBeInTheDocument();
  expect(container.querySelectorAll('li')).toHaveLength(features.length);
});
it('retains unknown equipment in its own group and omits empty specifications', () => {
  const view = render(<VehicleEquipmentList features={['Special factory finish']} />);
  fireEvent.click(screen.getByText('View all equipment'));
  expect(screen.getByRole('list', { name: 'Other equipment' })).toHaveTextContent('Special factory finish');
  view.unmount();
  const { container } = render(<VehicleEquipmentList features={[]} />);
  expect(container.querySelector('ul, details, svg')).toBeNull();
});
