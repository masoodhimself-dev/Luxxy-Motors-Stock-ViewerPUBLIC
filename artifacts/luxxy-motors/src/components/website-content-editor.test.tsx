import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { customerFeaturePolicy } from '@workspace/vehicle-meta';
import { WebsiteContentEditor } from './website-content-editor';
it('keeps standard navigation out of routine edits and hides release-disabled comparison wording', () => {
  const change = vi.fn();
  render(<WebsiteContentEditor value={{websiteCopy:{navigationStock:'Existing custom label',generalDescription:'Dealer-written introduction'}}} onChange={change} />);
  expect(screen.queryByText('Navigation stock')).not.toBeInTheDocument();
  if (!customerFeaturePolicy.vehicleComparison) expect(screen.queryByText('Comparison')).not.toBeInTheDocument();
  fireEvent.change(screen.getByPlaceholderText('For example: contact, stock, reviews'),{target:{value:'General description'}});
  const description = screen.getByTestId('input-copy-generalDescription');
  expect(description).toHaveValue('Dealer-written introduction');
  fireEvent.change(description,{target:{value:'Updated introduction'}});
  expect(change).toHaveBeenCalledWith({websiteCopy:{navigationStock:'Existing custom label',generalDescription:'Updated introduction'}});
});

it('retires controls for removed sections while preserving saved copy in the draft', () => {
  const change = vi.fn();
  const websiteCopy = { contactVisitHeading:'An old visit heading', contactMessageDescription:'Original old form copy', warrantySupportingCopy:'Original support text', generalTitle:'Ask us' };
  render(<WebsiteContentEditor value={{websiteCopy}} onChange={change} />);
  for (const key of ['servicesEyebrow', 'contactVisitHeading', 'contactVisitDescription', 'contactMessageHeading', 'contactMessageDescription', 'warrantySupportingCopy']) {
    expect(screen.queryByTestId(`input-copy-${key}`)).not.toBeInTheDocument();
  }
  expect(screen.getByTestId('input-copy-warrantyDetailsHeading')).toBeInTheDocument();
  expect(screen.getByTestId('input-copy-viewingDescription')).toBeInTheDocument();
  fireEvent.change(screen.getByTestId('input-copy-generalTitle'), {target:{value:'Ask about our cars'}});
  expect(change).toHaveBeenCalledWith({websiteCopy:{...websiteCopy, generalTitle:'Ask about our cars'}});
});

it('finds the dealership’s saved phrase as well as the standard field labels', () => {
  const change = vi.fn();
  render(<WebsiteContentEditor value={{websiteCopy:{generalDescription:'Ask about overnight collection.'}}} onChange={change} />);
  fireEvent.change(screen.getByPlaceholderText('For example: contact, stock, reviews'),{target:{value:'  OVERNIGHT collection  '}});
  expect(screen.getByTestId('input-copy-generalDescription')).toHaveValue('Ask about overnight collection.');
  expect(screen.queryByTestId('input-copy-stockTitle')).not.toBeInTheDocument();
  expect(screen.queryByText('No matching content fields. Try another phrase.')).not.toBeInTheDocument();
  expect(change).not.toHaveBeenCalled();
});
