import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Textarea } from '@/components/ui/textarea';
import { expectRefinedGeometry, radiusClasses, shadowClasses } from '@/test/showroom-style';

describe('Textarea', () => {
  it('ships the restrained, shadow-free showroom default', () => {
    render(<Textarea aria-label="Message" />);

    expectRefinedGeometry(screen.getByRole('textbox').className, 'Textarea');
  });

  it('still lets a surface opt into a soft edge on purpose', () => {
    render(<Textarea aria-label="Message" className="rounded-lg shadow-md" />);

    const { className } = screen.getByRole('textbox');

    expect(radiusClasses(className)).toContain('rounded-lg');
    expect(shadowClasses(className)).toContain('shadow-md');
  });
});
