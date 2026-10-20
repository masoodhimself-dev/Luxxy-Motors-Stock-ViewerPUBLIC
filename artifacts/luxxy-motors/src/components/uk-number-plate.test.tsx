import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UKNumberPlate } from './uk-number-plate';
import { formatRegistrationPlate } from '@/lib/registration-display';

describe('registration plate foundations', () => {
  it.each([
    ['MM00MMM','MM00 MMM'], ['M222MMM','M222 MMM'], ['MMM3333','MMM 3333'],
    ['MMM222','MMM 222'], ['ABC123D','ABC 123D'], ['1234ABC','1234 ABC'],
    [' mm00 mmm ','MM00 MMM'], ['M2 MMM','M2 MMM'],
  ])('formats %s without losing characters', (value, expected) => {
    expect(formatRegistrationPlate(value)).toBe(expected);
    render(<UKNumberPlate value={value} />);
    expect(screen.getByLabelText(`Registration ${expected}`)).toHaveTextContent(expected);
    expect(expected.replaceAll(' ', '')).toBe(value.toUpperCase().replaceAll(' ', ''));
  });
  it.each(['', null, '2015 (15 reg)', 'Not supplied'])('never paints missing or age-only data as a plate: %s', value => {
    render(<UKNumberPlate value={value} />);
    expect(screen.getByText('Registration not added')).toBeInTheDocument();
    expect(document.querySelector('.ukrp-plate')).toBeNull();
  });
  it('leaves editable text unformatted and retains the existing input contract', () => {
    const change = vi.fn();
    render(<UKNumberPlate editable value="m222mmm" onChange={change} inputId="plate" helpId="help" testId="part-exchange" />);
    const input = screen.getByRole('textbox', {name:'Your car’s UK registration number'});
    expect(input).toHaveValue('m222mmm');
    expect(input).toHaveAttribute('aria-describedby','help');
    expect(input).toHaveAttribute('required');
    fireEvent.change(input,{target:{value:'ab12 cde!'}});
    expect(change).toHaveBeenCalledWith('AB12 CDE');
  });
  it('defaults to a flag-free face for display and editable plates', () => {
    const {rerender} = render(<UKNumberPlate value="MM00MMM" size="lg" variant="front" />);
    expect(screen.getByTestId('uk-number-plate')).toHaveAttribute('data-size','lg');
    expect(document.querySelector('.ukrp-country')).toBeNull();
    rerender(<UKNumberPlate editable value="MM00MMM" variant="rear" />);
    expect(screen.getByTestId('uk-number-plate')).toHaveAttribute('data-variant','rear');
    expect(document.querySelector('.ukrp-country')).toBeNull();
  });
});
