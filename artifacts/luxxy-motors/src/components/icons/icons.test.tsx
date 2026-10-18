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
    for (const { name, path, brand } of manifest.icons) {
      expect(iconNames).toContain(name);
      const { container, unmount } = render(<DealerSvgIcon name={name as typeof iconNames[number]} />);
      const svg = container.querySelector('svg')!;
      const original = new DOMParser().parseFromString(readFileSync(`${process.cwd()}/src/assets/dealership-icons/${path}`, 'utf8'), 'image/svg+xml');
      expect(original.querySelector('parsererror'), name).toBeNull();
      expect(svg).toHaveAttribute('viewBox', '0 0 24 24');
      expect(svg).toHaveAttribute('data-dealer-icon', name);
      expect([...svg.children].map(artwork), `${name} retains its supplied geometry`).toEqual([...original.documentElement.children].map(artwork));
      expect(svg).toHaveAttribute('fill', original.documentElement.getAttribute('fill'));
      expect(svg).toHaveAttribute('stroke', original.documentElement.getAttribute('stroke') ?? 'none');
      if (!brand) expect(svg).toHaveAttribute('stroke-width', '1.85');
      expect(svg.querySelector('path, circle, rect, line, polyline, polygon, ellipse')).not.toBeNull();
      expect(svg.querySelector('script, foreignObject, image, use, a, iframe, animate, set')).toBeNull();
      for (const element of [svg, ...svg.querySelectorAll('*')]) {
        expect(element.namespaceURI).toBe('http://www.w3.org/2000/svg');
        for (const attribute of element.attributes) {
          expect(attribute.name).not.toMatch(/^on|href$/i);
          expect(attribute.value).not.toMatch(/javascript:|data:|url\(/i);
        }
      }
      unmount();
    }
  });

  it('forwards refs, responsive sizing and caller presentation without changing the viewBox', () => {
    const ref = createRef<SVGSVGElement>();
    render(<CarFront ref={ref} size={20} className="h-4 w-4 shrink-0" style={{ color: '#173247' }} data-testid="car" />);
    expect(ref.current).toBe(screen.getByTestId('car'));
    expect(ref.current).toHaveAttribute('width', '20');
    expect(ref.current).toHaveAttribute('height', '20');
    expect(ref.current).toHaveAttribute('viewBox', '0 0 24 24');
    expect(ref.current).toHaveAttribute('stroke-width', '1.85');
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
