import { createRef } from 'react';
import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import manifest from '@/assets/dealership-icons/manifest.json';
import {
  Bell, CalendarDays, CarFront, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
  AutomaticTransmission, Circle, CustomerEnquiry, DealerSvgIcon, Heart, Invoice,
  LayoutDashboard, LoaderCircle, Mail, ManualTransmission, Phone, Shield,
  SiWhatsapp, Star, StockImport, iconNames,
} from './index';

type SuppliedIcon = typeof manifest.icons[number] & { solidPath?: string; compactPath?: string };

function sourceSvg(path: string): Element {
  const document = new DOMParser().parseFromString(readFileSync(`${process.cwd()}/src/assets/dealership-icons/${path}`, 'utf8'), 'image/svg+xml');
  expect(document.querySelector('parsererror'), path).toBeNull();
  return document.documentElement;
}

function expectInert(svg: Element, localMasks = false): void {
  expect(svg.querySelector('script, foreignObject, image, use, a, iframe, animate, set')).toBeNull();
  for (const element of [svg, ...svg.querySelectorAll('*')]) {
    expect(element.namespaceURI).toBe('http://www.w3.org/2000/svg');
    for (const attribute of element.attributes) {
      expect(attribute.name).not.toMatch(/^on|href$/i);
      expect(attribute.value).not.toMatch(/javascript:|data:/i);
      if (/url\(/i.test(attribute.value)) {
        expect(localMasks && attribute.name === 'mask', `${element.localName} ${attribute.name}`).toBe(true);
        const id = /^url\(#([^)]*)\)$/.exec(attribute.value)?.[1];
        expect(id).toBeTruthy();
        expect([...svg.querySelectorAll('mask')].find(mask => mask.id === id)).toBeDefined();
      }
    }
  }
}

function artwork(element: Element): unknown {
  return {
    tag: element.localName,
    attributes: [...element.attributes].map(attribute => [attribute.name, attribute.value]).sort(([a], [b]) => a.localeCompare(b)),
    children: [...element.children].map(artwork),
  };
}

describe('the supplied dealership icon family', () => {
  it('renders every supplied glyph as local, inert SVG artwork', () => {
    expect(manifest.icons).toHaveLength(100);
    expect(new Set(manifest.icons.map(icon => icon.name)).size).toBe(100);
    let retainedOutlineGlyphs = 0;
    for (const icon of manifest.icons as SuppliedIcon[]) {
      const { name, path, brand, solidPath } = icon;
      expect(iconNames).toContain(name);
      const { container, unmount } = render(<DealerSvgIcon name={name as typeof iconNames[number]} />);
      const svg = container.querySelector('svg')!;
      const original = sourceSvg(path);
      expectInert(original);
      expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
      expect(svg).toHaveAttribute('data-dealer-icon', name);
      if (solidPath) {
        expect(svg).toHaveAttribute('data-icon-variant', 'standard');
        expect(svg).toHaveAttribute('fill', 'currentColor');
        expect(svg).toHaveAttribute('stroke', 'none');
        expect(svg).not.toHaveAttribute('stroke-width');
      } else {
        retainedOutlineGlyphs += 1;
        expect([...svg.children].map(artwork), `${name} retains its supplied geometry`).toEqual([...original.children].map(artwork));
        expect(svg).toHaveAttribute('fill', original.getAttribute('fill'));
        expect(svg).toHaveAttribute('stroke', original.getAttribute('stroke') ?? 'none');
        if (!brand) expect(svg).toHaveAttribute('stroke-width', '1.85');
      }
      expect(svg.querySelector('path, circle, rect, line, polyline, polygon, ellipse')).not.toBeNull();
      expectInert(svg, Boolean(solidPath));
      unmount();
    }
    expect(retainedOutlineGlyphs).toBe(92);
  });

  it('preserves every supplied solid layer in both optical sizes without importing review colours', () => {
    const solidIcons = (manifest.icons as SuppliedIcon[]).filter(icon => icon.solidPath);
    expect(solidIcons).toHaveLength(8);
    for (const { name, solidPath, compactPath } of solidIcons) {
      expect(compactPath, name).toBeTruthy();
      for (const [variant, path, size] of [['standard', solidPath!, 24], ['compact', compactPath!, 16]] as const) {
        const original = sourceSvg(path);
        expectInert(original);
        const { container, unmount } = render(<DealerSvgIcon name={name as typeof iconNames[number]} size={size} style={{ color: '#735629' }} />);
        const svg = container.querySelector('svg')!;
        const primary = svg.querySelector('g[data-layer="primary"]')!;
        const accent = svg.querySelector('g[data-layer="accent"]')!;
        expect(svg).toHaveAttribute('data-icon-variant', variant);
        expect(svg).toHaveAttribute('fill', 'currentColor');
        expect(svg).toHaveAttribute('stroke', 'none');
        expect(svg).not.toHaveAttribute('stroke-width');
        expect(svg).toHaveStyle({ color: '#735629' });
        expect([...primary.children].map(artwork), `${name} ${variant} primary`).toEqual([...original.querySelector('g[data-layer="primary"]')!.children].map(artwork));
        expect([...accent.children].map(artwork), `${name} ${variant} accent`).toEqual([...original.querySelector('g[data-layer="accent"]')!.children].map(artwork));
        expect(accent).toHaveAttribute('fill', 'currentColor');
        expect(Number(accent.getAttribute('opacity'))).toBe(0.5);
        expect(svg.outerHTML).not.toMatch(/#172436|#3d63e8|--icon-ink|--icon-accent/i);
        expect(svg.querySelector('[stroke-width], [stroke]:not([stroke="none"])')).toBeNull();
        expectInert(svg, true);
        unmount();
      }
    }
  });

  it('gives every solid icon its own local cut-out mask, including repeated glyphs', () => {
    const { container } = render(<><CarFront /><CarFront /><CustomerEnquiry /><ManualTransmission /></>);
    const svgs = [...container.querySelectorAll('svg')];
    const ids = svgs.map(svg => svg.querySelector('mask')!.id);
    expect(new Set(ids).size).toBe(svgs.length);
    expect(ids.every(Boolean)).toBe(true);
    for (const svg of svgs) {
      const mask = svg.querySelector('mask')!;
      const primary = svg.querySelector('g[data-layer="primary"]')!;
      const accent = svg.querySelector('g[data-layer="accent"]')!;
      expect(primary).toHaveAttribute('mask', `url(#${mask.id})`);
      expect(mask).toHaveStyle({ maskType: 'luminance' });
      expect(mask.querySelector('rect[fill="white"]')).not.toBeNull();
      const cutout = mask.querySelector('g[fill="black"]')!;
      expect(cutout).not.toBeNull();
      expect([...cutout.children].map(artwork)).toEqual([...accent.children].map(artwork));
    }
  });

  it('chooses compact artwork for small controls and standard artwork for larger or responsive-only sizes', () => {
    const { container, rerender } = render(<CarFront />);
    const expectVariant = (variant: string) => expect(container.querySelector('svg')).toHaveAttribute('data-icon-variant', variant);
    expectVariant('standard');
    for (const size of [12, 14, 16]) {
      rerender(<CarFront size={size} />);
      expectVariant('compact');
    }
    for (const size of [20, 24, 32]) {
      rerender(<CarFront size={size} />);
      expectVariant('standard');
    }
    for (const className of ['h-3 w-3', 'size-3.5', 'h-4 w-4 shrink-0', 'w-4', 'h-3.5 md:h-5']) {
      rerender(<CarFront className={className} />);
      expectVariant('compact');
    }
    for (const className of ['h-5 w-5', 'h-6 w-6', 'md:h-4 md:w-4', 'sm:size-4', 'size-40']) {
      rerender(<CarFront className={className} />);
      expectVariant('standard');
    }
    rerender(<CarFront size={16} strokeWidth={4} absoluteStrokeWidth />);
    expectVariant('compact');
    expect(container.querySelector('svg')).not.toHaveAttribute('stroke-width');
    expect(container.querySelector('svg')).toHaveAttribute('stroke', 'none');
  });

  it('forwards refs, responsive sizing and caller presentation without changing the viewBox', () => {
    const ref = createRef<SVGSVGElement>();
    render(<CarFront ref={ref} size={20} className="h-4 w-4 shrink-0" style={{ color: '#173247' }} data-testid="car" />);
    expect(ref.current).toBe(screen.getByTestId('car'));
    expect(ref.current).toHaveAttribute('width', '20');
    expect(ref.current).toHaveAttribute('height', '20');
    expect(ref.current).toHaveAttribute('viewBox', '0 0 24 24');
    expect(ref.current).toHaveAttribute('stroke', 'none');
    expect(ref.current).not.toHaveAttribute('stroke-width');
    expect(ref.current).toHaveAttribute('data-icon-variant', 'compact');
    expect(ref.current).toHaveClass('h-4', 'w-4', 'shrink-0');
    expect(ref.current).toHaveStyle({ color: '#173247' });
  });

  it('accepts CSS sizing and an explicit constant stroke for existing control integrations', () => {
    const { container, rerender } = render(<Phone size="1em" />);
    expect(container.querySelector('svg')).toHaveAttribute('width', '1em');
    expect(container.querySelector('svg')).toHaveAttribute('height', '1em');
    rerender(<Phone size={16} strokeWidth={2} absoluteStrokeWidth />);
    expect(container.querySelector('svg')).toHaveAttribute('stroke-width', '3');
  });

  it('hides decorative artwork and allows a standalone icon to receive an accessible name', () => {
    const { container, rerender } = render(<Phone />);
    expect(container.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('svg')).toHaveAttribute('focusable', 'false');
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    rerender(<Phone role="img" aria-label="Telephone" aria-hidden={false} />);
    expect(screen.getByRole('img', { name: 'Telephone' })).toHaveAttribute('aria-hidden', 'false');
  });

  it('keeps saved hearts fillable and selection dots as geometric circles', () => {
    const { container } = render(<><Heart data-testid="saved" className="fill-current" fill="currentColor" /><Circle data-testid="selection" className="fill-current" /></>);
    expect(screen.getByTestId('saved')).toHaveAttribute('fill', 'currentColor');
    expect(screen.getByTestId('saved')).toHaveClass('fill-current');
    expect(screen.getByTestId('selection').querySelector('circle')).not.toBeNull();
    expect(container.querySelectorAll('svg')).toHaveLength(2);
  });

  it('keeps technical loading, rating and selection artwork at the family stroke weight', () => {
    const { container } = render(<><LoaderCircle /><Star /><Circle /></>);
    for (const svg of container.querySelectorAll('svg')) expect(svg).toHaveAttribute('stroke-width', '1.85');
  });

  it('rotates directional artwork inside the SVG without overriding caller animation transforms', () => {
    const { container } = render(<>
      <ChevronRight data-testid="right" />
      <ChevronDown data-testid="down" className="rotate-180" style={{ transform: 'scale(1.2)' }} />
      <ChevronLeft data-testid="left" />
      <ChevronUp data-testid="up" />
    </>);
    expect(screen.getByTestId('right').querySelector('g[transform]')).toBeNull();
    for (const [testId, degrees] of [['down', 90], ['left', 180], ['up', -90]] as const) {
      expect(screen.getByTestId(testId).querySelector('g')).toHaveAttribute('transform', `rotate(${degrees} 12 12)`);
      expect(screen.getByTestId(testId)).not.toHaveAttribute('transform');
    }
    expect(screen.getByTestId('down')).toHaveClass('rotate-180');
    expect(screen.getByTestId('down')).toHaveStyle({ transform: 'scale(1.2)' });
    expect(container.querySelectorAll('svg path')).toHaveLength(4);
  });

  it('uses the official filled WhatsApp artwork and preserves its optical transform', () => {
    const { container } = render(<SiWhatsapp size={20} />);
    const svg = container.querySelector('svg')!;
    expect(svg).toHaveAttribute('data-dealer-icon', 'whatsapp');
    expect(svg).toHaveAttribute('fill', 'currentColor');
    expect(svg).toHaveAttribute('stroke', 'none');
    expect(svg.querySelectorAll('path')).toHaveLength(2);
    expect(svg.querySelector('g')).toHaveAttribute('transform', 'translate(2 2) scale(.027777777778)');
    expect(svg.style.color).toContain('--dealer-whatsapp-icon');
  });

  it('uses the supplied semantic glyphs for customer, staff and platform controls', () => {
    const { container } = render(<>
      <CarFront /><CalendarDays /><Shield /><Phone /><Mail />
      <Bell /><Invoice /><LayoutDashboard /><StockImport /><CustomerEnquiry />
    </>);
    expect([...container.querySelectorAll('svg')].map(svg => svg.dataset.dealerIcon)).toEqual([
      'car', 'test-drive-booking', 'insurance', 'phone', 'email',
      'notifications', 'invoice', 'dashboard', 'stock-import', 'customer-enquiry',
    ]);
  });

  it('keeps manual and automatic gearbox artwork distinct', () => {
    const { container } = render(<><ManualTransmission /><AutomaticTransmission /></>);
    const [manual, automatic] = [...container.querySelectorAll('svg')];
    expect(manual).toHaveAttribute('data-dealer-icon', 'transmission-manual');
    expect(automatic).toHaveAttribute('data-dealer-icon', 'transmission-automatic');
    expect([...manual.children].map(artwork)).not.toEqual([...automatic.children].map(artwork));
    expect(automatic.querySelector('rect')).not.toBeNull();
  });
});
