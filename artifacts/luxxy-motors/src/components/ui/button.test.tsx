import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { VariantProps } from 'class-variance-authority';
import { Button, buttonVariants } from '@/components/ui/button';
import { expectBrutalistGeometry, radiusClasses, shadowClasses } from '@/test/showroom-style';

type ButtonVariant = NonNullable<VariantProps<typeof buttonVariants>['variant']>;
type ButtonSize = NonNullable<VariantProps<typeof buttonVariants>['size']>;

// Written as records so typecheck fails if a new variant or size is added to the
// shared component without being covered by this guard.
const VARIANT_COVERAGE: Record<ButtonVariant, true> = {
  default: true,
  destructive: true,
  outline: true,
  secondary: true,
  ghost: true,
  link: true,
  accent: true,
};

const SIZE_COVERAGE: Record<ButtonSize, true> = {
  default: true,
  sm: true,
  lg: true,
  icon: true,
};

const VARIANTS = Object.keys(VARIANT_COVERAGE) as ButtonVariant[];
const SIZES = Object.keys(SIZE_COVERAGE) as ButtonSize[];

describe('Button', () => {
  it.each(SIZES)('renders the %s size brutalist square and hard-offset shadow', (size) => {
    render(<Button size={size}>Book a viewing</Button>);

    // `rounded-none` is the only radius allowed: anything else means a soft edge
    // crept back into the base or a variant.
    expectBrutalistGeometry(screen.getByRole('button').className, `Button ${size}`);
  });

  it('keeps every variant and size combination brutalist square and hard-offset shadow', () => {
    for (const variant of VARIANTS) {
      for (const size of SIZES) {
        expectBrutalistGeometry(buttonVariants({ variant, size }), `Button ${variant}/${size}`);
      }
    }
  });

  it('still lets a surface opt into a soft edge on purpose', () => {
    render(<Button className="rounded-lg shadow-md">Book a viewing</Button>);

    const { className } = screen.getByRole('button');

    expect(radiusClasses(className)).toContain('rounded-lg');
    expect(shadowClasses(className)).toContain('shadow-md');
  });
});
