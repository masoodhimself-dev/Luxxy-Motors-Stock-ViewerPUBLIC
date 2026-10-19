import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VehicleFeature } from './customer-help';
import { VehicleFeaturePanel } from './vehicle-feature-panel';

const frontSensors = 'Parking Sensor - Front';
const rearSensors = 'Parking Sensor - Rear';
const cruise = 'Cruise Control with SPEEDTRONIC Variable Speed Limiter';
const labels: Record<string, string> = {
  [frontSensors]: 'Front parking sensors',
  [rearSensors]: 'Rear parking sensors',
  [cruise]: 'Cruise control and speed limiter',
  'Automatic Climate Control with Digital Display': 'Automatic climate control',
  'Heated Front Seats': 'Heated front seats',
  'Bluetooth Interface for Hands-Free Telephone': 'Bluetooth hands-free calls',
  'Hard Disk Drive HDD Map Navigation System with TMC Traffic Message Channel': 'Built-in navigation',
  'ISOFIX Child Seat Fixing Points in Rear - Two Outer Seats': 'ISOFIX child-seat mounting points',
};

function openFeature(feature: string) {
  const trigger = screen.getByRole('button', { name: labels[feature] || feature });
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole('dialog') };
}

describe('vehicle equipment explanation panels', () => {
  it.each([
    frontSensors,
    rearSensors,
    cruise,
    'Automatic Climate Control with Digital Display',
    'Heated Front Seats',
    'Bluetooth Interface for Hands-Free Telephone',
    'Hard Disk Drive HDD Map Navigation System with TMC Traffic Message Channel',
    'ISOFIX Child Seat Fixing Points in Rear - Two Outer Seats',
  ])('opens an accessible explanation for the supplied feature “%s”', feature => {
    render(<VehicleFeaturePanel feature={feature} />);
    const { trigger, dialog } = openFeature(feature);
    expect(trigger).toHaveAttribute('type', 'button');
    expect(dialog).toHaveAccessibleName();
    expect(dialog).toHaveAccessibleDescription();
    expect(dialog.textContent?.toLowerCase()).toContain(feature.toLowerCase());
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeVisible();
  });

  it('shows the short label in the list and preserves the full manufacturer wording in its panel', () => {
    render(<VehicleFeaturePanel feature={cruise} />);
    const { trigger, dialog } = openFeature(cruise);
    expect(trigger).toHaveTextContent('Cruise control and speed limiter');
    expect(trigger).not.toHaveTextContent('SPEEDTRONIC');
    expect(trigger).toHaveAttribute('title', cruise);
    expect(within(dialog).getByText(cruise)).toBeVisible();
  });

  it('makes the previously unrecognised heated-front-seat feature explainable through the shared feature component', () => {
    render(<VehicleFeature feature="Heated Front Seats" />);
    const { dialog } = openFeature('Heated Front Seats');
    expect(dialog).toHaveTextContent(/front seats/i);
    expect(dialog).not.toHaveTextContent(/ask us which seats/i);
    expect(dialog).not.toHaveTextContent(/rear seats/i);
  });

  it('uses the climate artwork for air conditioning instead of an unrelated information symbol', () => {
    render(<VehicleFeaturePanel feature="Air Conditioning" />);
    const { dialog } = openFeature('Air Conditioning');
    const artwork = dialog.querySelector('[data-feature-icon="air-conditioning"]');
    expect(artwork?.querySelector('svg')).toHaveAttribute('data-dealer-icon', 'settings');
    expect(dialog).toHaveAccessibleDescription(/cools and helps dehumidify/i);
  });

  it('explains the specified sensor position rather than asking the customer to identify it', () => {
    render(<VehicleFeaturePanel feature={frontSensors} />);
    const { dialog } = openFeature(frontSensors);
    expect(dialog).toHaveAccessibleDescription(/front/i);
    expect(dialog).not.toHaveTextContent(/ask us whether/i);
    expect(dialog).not.toHaveTextContent(/rear sensors/i);
  });

  it('explains cruise control and the limiter together without advertising adaptive cruise control', () => {
    render(<VehicleFeaturePanel feature={cruise} />);
    const { dialog } = openFeature(cruise);
    expect(dialog).toHaveAccessibleDescription(/cruise/i);
    expect(dialog).toHaveAccessibleDescription(/limit/i);
    expect(dialog).toHaveAccessibleDescription(/selected speed|set speed|chosen speed/i);
    expect(dialog).toHaveAccessibleDescription(/maximum speed|upper speed|speed cap/i);
    expect(dialog).not.toHaveTextContent(/maintains? (?:a |the |your )?(?:selected |set |safe )?(?:following )?distance/i);
    expect(dialog).not.toHaveTextContent(/automatically brak|automatic braking/i);
  });

  it('leaves unsupported equipment as readable plain text instead of a dead or misleading control', () => {
    const feature = 'Special factory specification ABC-123';
    render(<VehicleFeaturePanel feature={feature} />);
    expect(screen.getByText(feature)).toBeVisible();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each([
    [frontSensors, 'parking-front'],
    [rearSensors, 'parking-rear'],
    [cruise, 'cruise-control'],
    ['Automatic Climate Control with Digital Display', 'climate'],
    ['Heated Front Seats', 'heated-seats'],
    ['Bluetooth Interface for Hands-Free Telephone', 'bluetooth-calls'],
    ['Hard Disk Drive HDD Map Navigation System with TMC Traffic Message Channel', 'navigation'],
    ['ISOFIX Child Seat Fixing Points in Rear - Two Outer Seats', 'isofix'],
  ])('keeps the large artwork decorative and gives “%s” its own equipment identity', (feature, icon) => {
    render(<VehicleFeaturePanel feature={feature} />);
    const { dialog } = openFeature(feature);
    const artwork = dialog.querySelector(`[data-feature-icon="${icon}"]`);
    expect(artwork).toHaveAttribute('aria-hidden', 'true');
    expect(artwork?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(within(dialog).queryByRole('img')).not.toBeInTheDocument();
  });

  it('opens on activation rather than hover or focus alone', () => {
    render(<VehicleFeaturePanel feature={frontSensors} />);
    const trigger = screen.getByRole('button', { name: 'Front parking sensors' });
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    fireEvent.focus(trigger);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger.tabIndex).toBe(0);
    // Native buttons dispatch a click with detail 0 for keyboard activation.
    fireEvent.click(trigger, { detail: 0 });
    expect(screen.getByRole('dialog')).toBeVisible();
  });

  it('closes through the visible close action and returns focus to the selected feature', async () => {
    render(<VehicleFeaturePanel feature={frontSensors} />);
    const { trigger, dialog } = openFeature(frontSensors);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('closes on Escape and returns focus without navigating away from the vehicle', async () => {
    render(<VehicleFeaturePanel feature={frontSensors} />);
    const { trigger } = openFeature(frontSensors);
    fireEvent.keyDown(document, { key: 'Escape', code: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('also offers an obvious acknowledgement action for touch users', async () => {
    render(<VehicleFeaturePanel feature="Heated Front Seats" />);
    const { dialog } = openFeature('Heated Front Seats');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Got it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps explanations independent when a customer opens different equipment items', async () => {
    render(<><VehicleFeaturePanel feature={frontSensors} /><VehicleFeaturePanel feature={rearSensors} /></>);
    const { dialog: frontDialog } = openFeature(frontSensors);
    expect(frontDialog).toHaveAccessibleDescription(/front/i);
    fireEvent.click(within(frontDialog).getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const { dialog: rearDialog } = openFeature(rearSensors);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(rearDialog).toHaveAccessibleDescription(/rear/i);
    expect(rearDialog).not.toHaveTextContent(frontSensors);
  });
});
