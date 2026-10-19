import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VehicleEquipmentList } from './vehicle-equipment-list';

describe('vehicle equipment grouped by available compact icons', () => {
  it('puts icon-equipped features first and all remaining text together below them', () => {
    const features = ['Chrome Trim Window Highlights', 'Parking Sensor - Front', 'Factory specification ABC', 'Heated Front Seats', '17in Alloy Wheels'];
    const { container } = render(<VehicleEquipmentList features={features} />);
    const highlights = screen.getByRole('list', { name: 'Feature highlights' });
    expect(within(highlights).getAllByRole('button').map(button => button.textContent)).toEqual(['Front parking sensors', 'Heated front seats']);
    expect(highlights.querySelectorAll('svg')).toHaveLength(2);
    for (const svg of highlights.querySelectorAll('svg')) {
      expect(svg).toHaveAttribute('width', '24');
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    }
    const more = container.querySelector('details')!;
    expect(highlights.nextElementSibling).toBe(more);
    expect(more).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('More equipment'));
    expect(more).toHaveAttribute('open');
    const text = screen.getByRole('list', { name: 'More equipment' });
    expect([...text.children].map(item => item.textContent)).toEqual(['Chrome Trim Window Highlights', 'Factory specification ABC', '17in Alloy Wheels']);
    expect(text.querySelector('svg')).toBeNull();
    expect(container.querySelectorAll('li')).toHaveLength(features.length);
    expect(features[0]).toBe('Chrome Trim Window Highlights');
  });

  it('retains every icon-equipped feature rather than cutting off after eight', () => {
    const features = ['Parking Sensor - Front', 'Parking Sensor - Rear', 'Cruise Control', 'Automatic Climate Control', 'Heated Front Seats', 'Heated Rear Seats', 'Bluetooth Telephone', 'Bluetooth Audio', 'Satellite Navigation', 'ISOFIX Mounts', 'Reversing Camera', 'Apple CarPlay'];
    render(<VehicleEquipmentList features={features} />);
    const highlights = screen.getByRole('list', { name: 'Feature highlights' });
    expect(within(highlights).getAllByRole('button').map(button => button.textContent)).toEqual([
      'Front parking sensors', 'Rear parking sensors', 'Cruise control', 'Automatic climate control',
      'Heated front seats', 'Heated rear seats', 'Bluetooth hands-free calls', 'Bluetooth audio',
      'Built-in navigation', 'ISOFIX child-seat mounting points', 'Reversing camera', 'Apple CarPlay',
    ]);
    expect(screen.queryByText('More equipment')).not.toBeInTheDocument();
  });

  it('opens the same explanation when the icon itself is clicked', async () => {
    render(<VehicleEquipmentList features={['Parking Sensor - Front']} />);
    const trigger = screen.getByRole('button', { name: 'Front parking sensors' });
    fireEvent.click(trigger.querySelector('svg')!);
    expect(screen.getByRole('dialog', { name: 'Front parking sensors' })).toHaveAccessibleDescription(/at the front/);
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('keeps text-only explanations working without adding icons or checkmarks', async () => {
    render(<VehicleEquipmentList features={['Cruise Control', '17in Alloy Wheels']} />);
    fireEvent.click(screen.getByText('More equipment'));
    const list = screen.getByRole('list', { name: 'More equipment' });
    const trigger = within(list).getByRole('button', { name: '17in Alloy Wheels' });
    expect(list.querySelector('svg')).toBeNull();
    fireEvent.click(trigger);
    const dialog = screen.getByRole('dialog', { name: 'Alloy wheels' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(list.closest('details')).toHaveAttribute('open');
  });

  it('keeps absent, optional and minor equipment out of the illustrated highlights', () => {
    const features = ['No heated seats', 'Optional parking sensors', 'Telephone Keypad', 'Chrome Trim'];
    const { container } = render(<VehicleEquipmentList features={features} />);
    expect(screen.queryByRole('list', { name: 'Feature highlights' })).not.toBeInTheDocument();
    expect(container.querySelector('details')).toHaveAttribute('open');
    const list = screen.getByRole('list', { name: 'More equipment' });
    expect([...list.children].map(item => item.textContent)).toEqual(features);
    expect(list.querySelector('svg')).toBeNull();
    expect(screen.queryByRole('button', { name: 'No heated seats' })).not.toBeInTheDocument();
  });

  it('leaves an all-text specification visible without requiring an extra tap', () => {
    render(<VehicleEquipmentList features={['Special factory finish']} />);
    expect(screen.getByRole('list', { name: 'More equipment' })).toBeVisible();
    expect(screen.getByText('1 feature')).toBeVisible();
  });

  it('does not render empty groups for an empty specification', () => {
    const { container } = render(<VehicleEquipmentList features={[]} />);
    expect(container.querySelector('ul, details, svg')).toBeNull();
  });
});
