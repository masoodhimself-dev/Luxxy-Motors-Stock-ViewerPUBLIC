import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input, inputClass } from '@/components/ui/input';
import { NativeSelect, nativeSelectClass } from '@/components/ui/native-select';
import { Textarea, textareaClass } from '@/components/ui/textarea';
import {
  expectSquaredAndFlat,
  radiusClasses,
  shadowClasses,
  utilities,
} from '@/test/showroom-style';

/**
 * The showroom field language is shared by the three primitives buyers type into:
 * squared and shadow-free, with the browser's own focus outline replaced by a brass
 * border and halo. They are guarded together because they have to stay in step — a
 * field that quietly regained a rounded edge, a drop shadow or a default focus ring
 * would change every buyer-facing form at once.
 */

type Field = {
  label: string;
  /** How the mounted control is found. A native `select` is a combobox. */
  role: 'textbox' | 'combobox';
  /** The primitive's own base class list, so a test can name the default a call site replaces. */
  base: string;
  /** A realistic per-screen size tweak, as used on the hero and the enquiry form. */
  taller: string;
  /** The hero's translucent-on-ink palette for this control. */
  onInk: string;
  /** Text fields render a placeholder; a native select does not. */
  hasPlaceholder: boolean;
  render: (className?: string) => ReactElement;
};

const FIELDS: Field[] = [
  {
    label: 'Input',
    role: 'textbox',
    base: inputClass,
    taller: 'h-12',
    onInk:
      'border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/45 focus-visible:ring-accent/30',
    hasPlaceholder: true,
    render: (className) => (
      <Input aria-label="Field" placeholder="Make, model or registration" className={className} />
    ),
  },
  {
    label: 'Textarea',
    role: 'textbox',
    base: textareaClass,
    taller: 'min-h-[160px]',
    onInk:
      'border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/45 focus-visible:ring-accent/30',
    hasPlaceholder: true,
    render: (className) => (
      <Textarea aria-label="Field" placeholder="Anything else we should know?" className={className} />
    ),
  },
  {
    label: 'NativeSelect',
    role: 'combobox',
    base: nativeSelectClass,
    taller: 'h-12',
    onInk:
      'border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground focus:ring-accent/30',
    hasPlaceholder: false,
    render: (className) => (
      <NativeSelect aria-label="Field" defaultValue="" className={className}>
        <option value="">Any make</option>
      </NativeSelect>
    ),
  },
];

const TEXT_FIELDS = FIELDS.filter((field) => field.hasPlaceholder);

/** Renders a field, optionally with a call-site tweak, and returns its merged class list. */
function fieldClass(field: Field, tweak?: string) {
  render(field.render(tweak));

  return screen.getByRole(field.role).className;
}

/**
 * The class list as written, prefixes intact — `utilities()` deliberately drops them,
 * which is the wrong reading for a tweak that only applies in one state.
 */
function tokens(className: string) {
  return className.split(/\s+/).filter(Boolean);
}

/**
 * Focus-state utilities with their prefix dropped. The three fields deliberately
 * disagree on the prefix — a native select keeps the brass edge on plain `focus:`
 * so it also shows when the control is opened by mouse — so the guard reads the
 * state rather than the exact prefix.
 */
function focusUtilities(className: string) {
  const focusTokens = className
    .split(/\s+/)
    .filter((token) => /(^|:)focus(-visible)?:/.test(token));

  return utilities(focusTokens.join(' '));
}

/** The brass halo, at whatever opacity the screen asked for. */
function haloClasses(focusUtils: string[]) {
  return focusUtils.filter((utility) => /^ring-accent\/\d+$/.test(utility));
}

/** Every height utility, so a call site's taller control can be shown to win. */
function heightClasses(className: string) {
  return utilities(className).filter((utility) => /^(min-|max-)?h-/.test(utility));
}

/**
 * Fails when a field stops replacing the browser's default focus ring with the
 * showroom's brass edge: an accent border, a two-pixel ring and a soft brass halo,
 * with the native outline suppressed so it cannot draw over them.
 */
function expectBrassFocusEdge(className: string, label: string) {
  const focus = focusUtilities(className);

  expect(focus, `${label} focus border`).toContain('border-accent');
  expect(focus, `${label} focus ring`).toContain('ring-2');
  expect(haloClasses(focus), `${label} focus halo`).toHaveLength(1);
  expect(utilities(className), `${label} native outline`).toContain('outline-none');
}

describe('shared form fields', () => {
  it.each(FIELDS)('$label ships the squared, shadow-free showroom default', (field) => {
    expectSquaredAndFlat(fieldClass(field), field.label);
  });

  it.each(FIELDS)('$label keeps the brass focus edge', (field) => {
    const className = fieldClass(field);

    expectBrassFocusEdge(className, field.label);
    // All three share one halo opacity; a screen may raise it, but the default is shared.
    expect(focusUtilities(className), `${field.label} default halo`).toContain('ring-accent/25');
  });
});

describe('shared form field call-site tweaks', () => {
  it.each(FIELDS)('$label lets a screen use a taller control', (field) => {
    const merged = heightClasses(fieldClass(field, field.taller));

    expect(merged, `${field.label} taller control`).toContain(field.taller);
    // The default height has to give way, or the call site is silently ignored.
    for (const height of heightClasses(field.base)) {
      expect(merged, `${field.label} default height`).not.toContain(height);
    }
  });

  it.each(FIELDS)('$label takes the hero translucent-on-ink palette', (field) => {
    const className = fieldClass(field, field.onInk);
    const merged = tokens(className);

    for (const tweak of tokens(field.onInk)) {
      expect(merged, `${field.label} on-ink tweak`).toContain(tweak);
    }
    // The resting palette is replaced rather than layered under the default.
    for (const surrendered of ['border-border', 'bg-background', 'text-foreground']) {
      expect(tokens(field.base), `${field.label} default palette`).toContain(surrendered);
      expect(merged, `${field.label} default palette`).not.toContain(surrendered);
    }
    // Only the halo opacity moves: the brass focus edge itself survives on ink.
    const focus = focusUtilities(className);
    expect(focus, `${field.label} on-ink focus border`).toContain('border-accent');
    expect(haloClasses(focus), `${field.label} on-ink halo`).toEqual(['ring-accent/30']);
  });

  it.each(TEXT_FIELDS)('$label lets a screen restyle the placeholder on ink', (field) => {
    const merged = tokens(fieldClass(field, field.onInk));

    // A base `placeholder:*` is not in the same merge group as an element-level
    // colour, so an ink screen has to be able to replace it outright.
    expect(merged, `${field.label} placeholder`).toContain('placeholder:text-primary-foreground/45');
    expect(merged, `${field.label} default placeholder`).not.toContain(
      'placeholder:text-muted-foreground',
    );
  });

  it.each(FIELDS)('$label still lets a surface opt into a soft edge on purpose', (field) => {
    const className = fieldClass(field, 'rounded-lg shadow-md');

    expect(radiusClasses(className), `${field.label} radius`).toEqual(['rounded-lg']);
    expect(shadowClasses(className), `${field.label} shadow`).toEqual(['shadow-md']);
  });
});

describe('field focus-edge helper', () => {
  it('reads the focus state whichever prefix a control uses', () => {
    expect(focusUtilities('border-border focus:border-accent focus-visible:ring-2')).toEqual([
      'border-accent',
      'ring-2',
    ]);
  });

  it('fails a field that lost the brass edge or kept the browser outline', () => {
    const brass = 'outline-none focus:border-accent focus:ring-2 focus:ring-accent/25';

    expect(() => expectBrassFocusEdge(brass, 'field')).not.toThrow();
    // No accent border on focus.
    expect(() =>
      expectBrassFocusEdge('outline-none focus:ring-2 focus:ring-accent/25', 'field'),
    ).toThrow();
    // No brass halo behind the border.
    expect(() => expectBrassFocusEdge('outline-none focus:border-accent focus:ring-2', 'field')).toThrow();
    // The native outline would draw over the brass edge.
    expect(() =>
      expectBrassFocusEdge('focus:border-accent focus:ring-2 focus:ring-accent/25', 'field'),
    ).toThrow();
    // A resting accent border is not a focus edge.
    expect(() =>
      expectBrassFocusEdge('outline-none border-accent ring-2 ring-accent/25', 'field'),
    ).toThrow();
  });
});
