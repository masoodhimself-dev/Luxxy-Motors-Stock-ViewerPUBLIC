import type { ComponentProps } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { expectRefinedGeometry, radiusClasses, shadowClasses } from '@/test/showroom-style';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Radix popper surfaces (popover, dropdown, select) need a few browser APIs jsdom
// does not implement before they will mount.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
Element.prototype.scrollIntoView ??= () => {};
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.setPointerCapture ??= () => {};
Element.prototype.releasePointerCapture ??= () => {};

type BadgeVariant = NonNullable<ComponentProps<typeof Badge>['variant']>;

// Written as a record so typecheck fails if a new variant is added to the shared
// badge without being covered by this guard.
const BADGE_VARIANT_COVERAGE: Record<BadgeVariant, true> = {
  default: true,
  secondary: true,
  destructive: true,
  outline: true,
  warning: true,
};

const BADGE_VARIANTS = Object.keys(BADGE_VARIANT_COVERAGE) as BadgeVariant[];

function expectSurface(element: Element, label: string) {
  expectRefinedGeometry(element.className, label);
}

describe('Card', () => {
  it('renders with restrained corners and flat surfaces', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Book a viewing</CardTitle>
        </CardHeader>
        <CardContent>Wednesday, 4pm</CardContent>
      </Card>,
    );

    expectSurface(screen.getByTestId('card'), 'Card');
  });
});

describe('Badge', () => {
  it.each(BADGE_VARIANTS)('renders the %s variant with restrained corners and flat surfaces', (variant) => {
    render(
      <Badge variant={variant} data-testid="badge">
        Reserved
      </Badge>,
    );

    expectSurface(screen.getByTestId('badge'), `Badge ${variant}`);
  });
});

describe('Dialog', () => {
  it('renders the panel and its close button with restrained corners and flat surfaces', () => {
    render(
      <Dialog open>
        <DialogContent>
          <DialogTitle>Confirm your viewing</DialogTitle>
          <DialogDescription>We will hold the car for 24 hours.</DialogDescription>
        </DialogContent>
      </Dialog>,
    );

    expectSurface(screen.getByRole('dialog'), 'DialogContent');
    expectSurface(screen.getByRole('button', { name: 'Close' }), 'DialogContent close');
  });
});

describe('Popover', () => {
  it('renders the panel with restrained corners and flat surfaces', () => {
    render(
      <Popover open>
        <PopoverTrigger>Opening hours</PopoverTrigger>
        <PopoverContent data-testid="popover-content">Mon–Sat, 9am–6pm</PopoverContent>
      </Popover>,
    );

    expectSurface(screen.getByTestId('popover-content'), 'PopoverContent');
  });
});

describe('DropdownMenu', () => {
  it('renders the panel and its items with restrained corners and flat surfaces', () => {
    render(
      <DropdownMenu open>
        <DropdownMenuTrigger>Sort</DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Price, low to high</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );

    expectSurface(screen.getByRole('menu'), 'DropdownMenuContent');
    expectSurface(screen.getByRole('menuitem'), 'DropdownMenuItem');
  });
});

describe('Select', () => {
  it('renders the trigger, panel and items with restrained corners and flat surfaces', () => {
    render(
      <Select open defaultValue="petrol">
        <SelectTrigger data-testid="select-trigger">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="petrol">Petrol</SelectItem>
        </SelectContent>
      </Select>,
    );

    // The open panel marks the rest of the tree `aria-hidden`, so the trigger is
    // reachable by test id rather than by role here.
    expectSurface(screen.getByTestId('select-trigger'), 'SelectTrigger');
    expectSurface(screen.getByRole('listbox'), 'SelectContent');
    expectSurface(screen.getByRole('option', { name: 'Petrol' }), 'SelectItem');
  });
});

describe('surface class helpers', () => {
  it('flags a reintroduced radius or drop shadow', () => {
    expect(radiusClasses('rounded-none sm:rounded-lg')).toContain('rounded-lg');
    expect(radiusClasses('rounded-full')).not.toEqual(['rounded-none']);
    expect(shadowClasses('shadow-md')).toEqual(['shadow-md']);
    expect(shadowClasses('shadow-none')).toEqual([]);
  });
});
