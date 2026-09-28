import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it } from 'vitest';
import { Gallery } from './gallery';
it('removes failed images from thumbnails and counts, and handles all failing', () => {
  render(<Gallery images={['https://example.com/one.jpg', 'https://example.com/two.jpg']} />);
  const fail = (src: string) => {
    const img = document.querySelector(`img[src="${src}"]`) as HTMLImageElement;
    fireEvent.error(img);
    if (img.isConnected) fireEvent.error(img);
  };
  fail('https://example.com/two.jpg');
  expect(screen.getByText('1 / 1 photographs')).toBeInTheDocument();
  expect(screen.queryByText('Photograph unavailable')).not.toBeInTheDocument();
  fail('https://example.com/one.jpg');
  expect(screen.getByText('Photographs to follow')).toBeInTheDocument();
});
