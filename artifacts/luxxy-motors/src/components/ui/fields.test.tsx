import type { ReactElement } from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Input, inputClass } from '@/components/ui/input';
import { NativeSelect, nativeSelectClass } from '@/components/ui/native-select';
import { Textarea, textareaClass } from '@/components/ui/textarea';
import {
  expectRefinedGeometry,
  radiusClasses,
  shadowClasses,
  utilities,
} from '@/test/showroom-style';

// Shared field appearance and call-site overrides stay aligned.

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
    taller: 'h-14',
    onInk:
      'border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/45 focus-visible:outline-primary-foreground',
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
      'border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/45 focus-visible:outline-primary-foreground',
    hasPlaceholder: true,
    render: (className) => (
      <Textarea aria-label="Field" placeholder="Anything else we should know?" className={className} />
    ),
  },
  {
    label: 'NativeSelect',
    role: 'combobox',
    base: nativeSelectClass,
    taller: 'h-14',
    onInk:
      'border-primary-foreground/20 bg-primary-foreground/10 text-primary-foreground focus-visible:outline-primary-foreground',
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

/** Every height utility, so a call site's taller control can be shown to win. */
function heightClasses(className: string) {
  return utilities(className).filter((utility) => /^(min-|max-)?h-/.test(utility));
}

function expectAccessibleFocus(className: string, label: string) {
  const focus = focusUtilities(className);
  expect(focus, `${label} visible outline`).toContain('outline-2');
  expect(focus, `${label} outline offset`).toContain('outline-offset-2');
  expect(utilities(className), `${label} native outline`).not.toContain('outline-none');
}

describe('shared form fields', () => {
  it.each(FIELDS)('$label ships the restrained, shadow-free showroom default', (field) => {
    expectRefinedGeometry(fieldClass(field), field.label);
  });

  it.each(FIELDS)('$label keeps a visible, offset focus outline', (field) => {
    const className = fieldClass(field);

    expectAccessibleFocus(className, field.label);
    expect(focusUtilities(className), `${field.label} focus colour`).toContain('outline-ring');
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
    for (const surrendered of ['border-input', 'bg-card', 'text-foreground']) {
      expect(tokens(field.base), `${field.label} default palette`).toContain(surrendered);
      expect(merged, `${field.label} default palette`).not.toContain(surrendered);
    }
    // The contrasting focus outline remains visible on a dark surface.
    const focus = focusUtilities(className);
    expect(focus, `${field.label} on-ink outline`).toContain('outline-2');
    expect(focus, `${field.label} on-ink colour`).toContain('outline-primary-foreground');
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

    expect(radiusClasses(className), `${field.label} radius`).toContain('rounded-lg');
    expect(shadowClasses(className), `${field.label} shadow`).toContain('shadow-md');
  });
});

describe('field focus-edge helper', () => {
  it('reads the focus state whichever prefix a control uses', () => {
    expect(focusUtilities('border-border focus:border-accent focus-visible:ring-2')).toEqual([
      'border-accent',
      'ring-2',
    ]);
  });

  it('rejects a field without a visible, offset keyboard focus indicator', () => {
    expect(() => expectAccessibleFocus('focus-visible:outline-2 focus-visible:outline-offset-2', 'field')).not.toThrow();
    expect(() => expectAccessibleFocus('outline-none', 'field')).toThrow();
    expect(() => expectAccessibleFocus('focus-visible:outline-2', 'field')).toThrow();
    expect(() => expectAccessibleFocus('outline-2 outline-offset-2', 'field')).toThrow();
  });
});
