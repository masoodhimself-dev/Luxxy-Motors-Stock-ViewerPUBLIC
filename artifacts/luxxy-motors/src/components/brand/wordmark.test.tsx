import { fireEvent,render,screen } from '@testing-library/react';
import { describe,it,expect } from 'vitest';
import { DealerWordmark } from './wordmark';
describe('dealer name fallback',()=>{
 it('shows the dealer name when an uploaded logo fails and retries a replacement',()=>{
  const {rerender}=render(<DealerWordmark name="Example Motors" logoAsset="/broken.png"/>);
  fireEvent.error(screen.getByRole('img',{name:'Example Motors'}));
  expect(screen.getByText('Example Motors')).toBeTruthy();
  rerender(<DealerWordmark name="Example Motors" logoAsset="/new.png"/>);
  expect(screen.getByRole('img',{name:'Example Motors'}).getAttribute('src')).toBe('/new.png');
 });
 it('uses the dealer name when logo text is whitespace',()=>{
  render(<DealerWordmark name="Another Dealer" logoText="   "/>);
  expect(screen.getByText('Another Dealer')).toBeTruthy();
 });
});
