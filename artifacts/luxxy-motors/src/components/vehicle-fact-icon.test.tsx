import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VehicleFactIcon } from './vehicle-fact-icon';

describe('recorded transmission icons', () => {
  it.each([
    'Manual', 'manual', '6-speed manual', 'Manual gearbox',
  ])('uses the manual icon for %s', value => {
    const { container } = render(<VehicleFactIcon label="Transmission" value={value} />);
    expect(container.querySelector('svg')).toHaveAttribute('data-dealer-icon', 'transmission-manual');
  });

  it.each([
    'Automatic', 'AUTO', 'Auto', '7-speed automatic', 'DSG', '7-Speed DSG',
    'DCT', '7G-DCT', 'CVT', 'e-CVT', 'eCVT', 'Semi-automatic',
    'S tronic', 'S-Tronic', 'Tiptronic', 'Steptronic', 'Multitronic', 'Powershift',
  ])('uses the automatic icon for %s', value => {
    const { container } = render(<VehicleFactIcon label="Gearbox" value={value} />);
    expect(container.querySelector('svg')).toHaveAttribute('data-dealer-icon', 'transmission-automatic');
  });

  it.each([
    undefined, null, '', ' ', '-', 'Not specified', 'Unknown', 'Other', '6-speed',
    'Manual or automatic', 'Manual / DSG', 'Automatic with manual mode',
    'Manual?', 'Not automatic', 'Automated manual', 'Clutchless manual',
  ])('omits the icon when the recorded value is missing or ambiguous: %s', value => {
    const { container } = render(<VehicleFactIcon label="Transmission" value={value} />);
    expect(container.querySelector('svg')).toBeNull();
  });

  it('omits a gearbox icon for a shared comparison heading with no single recorded value', () => {
    const { container } = render(<VehicleFactIcon label="Gearbox" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not use a transmission icon for engine or body specifications', () => {
    const { container } = render(<>
      <VehicleFactIcon label="Engine" value="1.6L" />
      <VehicleFactIcon label="Body type" value="Hatchback" />
    </>);
    expect([...container.querySelectorAll('svg')].map(icon => icon.getAttribute('data-dealer-icon'))).toEqual(['engine', 'body-type']);
  });
});
