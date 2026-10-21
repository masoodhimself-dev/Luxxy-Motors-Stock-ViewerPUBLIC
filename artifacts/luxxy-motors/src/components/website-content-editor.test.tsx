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
