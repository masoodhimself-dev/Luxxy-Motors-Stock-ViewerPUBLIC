import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { VariantProps } from 'class-variance-authority';
import { Button, buttonVariants } from '@/components/ui/button';

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

/** Drops responsive/state prefixes and `!` markers so `md:!rounded-lg` reads as `rounded-lg`. */
function utilities(className: string) {
  return className
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.slice(token.lastIndexOf(':') + 1).replace(/^!/, ''));
}

function radiusClasses(className: string) {
  return utilities(className).filter((utility) => /^-?rounded(-|$)/.test(utility));
}

function shadowClasses(className: string) {
  return utilities(className).filter(
    (utility) => /^-?shadow(-|$)/.test(utility) && utility !== 'shadow-none',
  );
}

describe('Button', () => {
  it.each(SIZES)('renders the %s size squared and shadow-free', (size) => {
    render(<Button size={size}>Book a viewing</Button>);

    const { className } = screen.getByRole('button');

    // `rounded-none` is the only radius allowed: anything else means a soft edge
    // crept back into the base or a variant.
    expect(radiusClasses(className)).toEqual(['rounded-none']);
    expect(shadowClasses(className)).toEqual([]);
  });

  it('keeps every variant and size combination squared and shadow-free', () => {
    for (const variant of VARIANTS) {
      for (const size of SIZES) {
        const className = buttonVariants({ variant, size });

        expect(radiusClasses(className), `${variant}/${size} radius`).toEqual(['rounded-none']);
        expect(shadowClasses(className), `${variant}/${size} shadow`).toEqual([]);
      }
    }
  });

  it('flags a reintroduced radius or drop shadow', () => {
    expect(radiusClasses('rounded-none hover:rounded-md')).toContain('rounded-md');
    expect(radiusClasses('rounded-lg')).not.toEqual(['rounded-none']);
    expect(shadowClasses('shadow-sm')).toEqual(['shadow-sm']);
    expect(shadowClasses('shadow-none')).toEqual([]);
  });
});
