import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VehiclePhotoRequest } from './vehicle-photo-request';

const openRequest = () => fireEvent.click(screen.getByText('Request a photo'));
it('keeps the request quiet and requires a selected photo before preparing anything', () => {
  const onRequest = vi.fn();
  const { container } = render(<VehiclePhotoRequest onRequest={onRequest} />);
  expect(container.querySelector('details')).not.toHaveAttribute('open');
  openRequest();
  expect(screen.getByRole('button', { name: 'Add to my enquiry' })).toBeDisabled();
  expect(onRequest).not.toHaveBeenCalled();
});
it('prepares only the chosen items and optional note after an explicit click, without a form submission', () => {
  const onRequest = vi.fn(), submit = vi.fn(event => event.preventDefault());
  render(<form onSubmit={submit}><VehiclePhotoRequest onRequest={onRequest} /></form>);
  openRequest();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Service records' }));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Boot' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Anything specific? (optional)' }), { target: { value: '  With the seats folded, please.  ' } });
  expect(onRequest).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Add to my enquiry' }));
  expect(onRequest).toHaveBeenCalledOnce();
  expect(onRequest).toHaveBeenCalledWith('Could you please send photos of:\n• The boot\n• Any available service-book photos or service records\n\nAdditional detail: With the seats folded, please.');
  expect(submit).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('Nothing has been sent');
});
it('asks which other photograph is needed and does not create an empty request', () => {
  const onRequest = vi.fn();
  render(<VehiclePhotoRequest onRequest={onRequest} />);
  openRequest();
  fireEvent.click(screen.getByRole('checkbox', { name: 'Other' }));
  const add = screen.getByRole('button', { name: 'Add to my enquiry' });
  expect(add).toBeDisabled();
  fireEvent.change(screen.getByRole('textbox', { name: 'Which other photo would you like?' }), { target: { value: 'The charging cable.' } });
  fireEvent.click(add);
  expect(onRequest).toHaveBeenCalledWith(expect.stringContaining('Additional detail: The charging cable.'));
  fireEvent.click(screen.getByRole('checkbox', { name: 'Other' }));
  expect(add).toBeDisabled();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
});
it('does not carry a previous vehicle’s chosen photos across a keyed remount', () => {
  const onRequest = vi.fn();
  const { rerender } = render(<VehiclePhotoRequest key="first" onRequest={onRequest} />);
  openRequest(); fireEvent.click(screen.getByRole('checkbox', { name: 'Rear seats' }));
  rerender(<VehiclePhotoRequest key="second" onRequest={onRequest} />);
  openRequest();
  expect(screen.getByRole('checkbox', { name: 'Rear seats' })).not.toBeChecked();
  expect(screen.getByRole('button', { name: 'Add to my enquiry' })).toBeDisabled();
  expect(onRequest).not.toHaveBeenCalled();
});
