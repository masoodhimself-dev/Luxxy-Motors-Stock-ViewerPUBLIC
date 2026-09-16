import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input } from '@/components/ui/input';
import { expectRefinedGeometry, radiusClasses, shadowClasses } from '@/test/showroom-style';

describe('Input', () => {
  it('ships the restrained, shadow-free showroom default', () => {
    render(<Input aria-label="Full name" />);

    expectRefinedGeometry(screen.getByRole('textbox').className, 'Input');
  });

  it('still lets a surface opt into a soft edge on purpose', () => {
    render(<Input aria-label="Full name" className="rounded-lg shadow-md" />);

    const { className } = screen.getByRole('textbox');

    expect(radiusClasses(className)).toContain('rounded-lg');
    expect(shadowClasses(className)).toContain('shadow-md');
  });
});
