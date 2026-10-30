import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { DealerServicePhoto } from './dealer-service-photo';
it('keeps Multi-Choice photography off other dealership websites', () => {
 const {rerender} = render(<DealerServicePhoto dealerName="Shore Drive Limited" service="part-exchange"/>);
 expect(screen.queryByRole('img')).not.toBeInTheDocument();
 rerender(<DealerServicePhoto dealerName="Multi-Choice Motors" service="part-exchange"/>);
 const image = screen.getByRole('img');
 expect(image).toHaveAttribute('loading', 'lazy');
 expect(image).toHaveAttribute('src', '/brand/multi-choice-motors/services/part-exchange-800.webp');
 expect(image.getAttribute('srcset')).toContain('480w');
 expect(image).toHaveAttribute('width', '1200');
 expect(image).toHaveAttribute('height', '800');
});
