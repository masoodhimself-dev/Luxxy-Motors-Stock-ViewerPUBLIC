import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { CustomerTemplateHomeHero } from './home-hero';

const cars = [{ id: 'harbour-focus', make: 'Ford', model: 'Focus', title: 'Ford Focus', variant: '1.0 manual', currency: 'GBP', price: 9999, registration: 'AB16 CDE', images: ['https://images.example/harbour-focus.jpg'], heroImage: 'https://images.example/harbour-focus.jpg' }, { id: 'harbour-golf', make: 'Volkswagen', model: 'Golf', title: 'Volkswagen Golf', currency: 'GBP', price: 7999, registration: 'AB16 FGH', images: ['https://images.example/harbour-golf.jpg'], heroImage: 'https://images.example/harbour-golf.jpg' }] as Car[];
const settings = { ...dealerConfig, identity: { name: 'Harbour Cars', logoAsset: '/harbour-logo.svg' }, address: { city: 'Leeds', region: 'West Yorkshire' }, partExchange: { ...dealerConfig.partExchange!, enabled: false }, hero: { ...dealerConfig.hero, announcement: '', copy: 'Find a car at Harbour Cars', subcopy: '' } };
const templates = ['showroom', 'grand-touring', 'forecourt', 'panorama'] as const;
const hero = (template: typeof templates[number], stock = cars, extra = {}) => <CustomerTemplateHomeHero template={template} settings={settings} cars={stock} headline={settings.hero.copy} search={<span>Dealer search</span>} loading={false} error={null} {...extra}/>;
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

describe('production template home presentations', () => {
  it.each(['showroom', 'grand-touring', 'forecourt', 'panorama'] as const)('uses the current dealership data and real search controls in %s', template => {
    const search = vi.fn(event => event.preventDefault());
    render(<CustomerTemplateHomeHero template={template} settings={settings} cars={cars} headline={settings.hero.copy} search={<form aria-label="Dealer stock search" onSubmit={search}><button type="submit">Search stock</button></form>} loading={false} error={null}/>);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Harbour Cars');
    expect(screen.getByRole('heading', { name: 'Ford Focus' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'View Ford Focus' })).toHaveAttribute('href', expect.stringContaining('/'));
    expect(screen.queryByText(/Multi Choice|Hayes|Luxxy/)).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Part exchange' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search stock' }));
    expect(search).toHaveBeenCalledOnce();
  });
  it('does not invent a featured vehicle when a dealer has no stock', () => {
    render(<CustomerTemplateHomeHero template="showroom" settings={settings} cars={[]} headline={settings.hero.copy} search={<span>Search</span>} loading={false} error={null}/>);
    expect(screen.getByRole('status')).toHaveTextContent('Ask us about the cars coming into stock.');
    expect(screen.queryByRole('heading', { name: 'Ford Focus' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /View .*car/ })).not.toBeInTheDocument();
  });
  it.each(templates)('keeps real cars usable without photographs in %s', template => {
    render(hero(template, [{ ...cars[0], heroImage: null, images: [], imageCount: 48 }]));
    expect(screen.getByRole('heading', { name: 'Ford Focus' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Photographs coming soon for Ford Focus' })).toBeInTheDocument();
    expect(screen.queryByText(/48 photos|1 photo/)).not.toBeInTheDocument();
    expect(screen.queryByText(/cars coming into stock/)).not.toBeInTheDocument();
  });
  it.each(templates)('counts the actual unique gallery photographs instead of an old feed count in %s', template => {
    render(hero(template, [{ ...cars[0], imageCount: 99, images: [cars[0].heroImage!, cars[0].heroImage!, 'https://images.example/second.jpg'] }]));
    expect(screen.getByText('2 photos')).toBeInTheDocument();
    expect(screen.queryByText('99 photos')).not.toBeInTheDocument();
  });
  it.each(templates.flatMap(template => [null, -10, Infinity].map(price => ({ template, price }))))('uses an enquiry price for $price in $template', ({ template, price }) => {
    render(hero(template, [{ ...cars[0], price }]));
    expect(screen.getByRole('link', { name: 'Ask for price' })).toBeInTheDocument();
    expect(screen.queryByText(/£-|∞/)).not.toBeInTheDocument();
  });
  it.each(templates)('keeps VAT qualifications alongside advertised prices in %s', template => {
    render(hero(template, [{ ...cars[0], priceType: '+ VAT' }]));
    expect(screen.getByText('Excludes VAT')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '£9,999' })).toBeInTheDocument();
    expect(screen.queryByText('£11,999')).not.toBeInTheDocument();
  });
  it.each(templates)('omits unavailable stock while clearly marking a reserved car in %s', template => {
    render(hero(template, [{ ...cars[1], inventoryStatus: 'sold' }, { ...cars[0], inventoryStatus: 'reserved' }, { ...cars[1], id: 'withdrawn', inventoryStatus: 'withdrawn' }]));
    expect(screen.queryByRole('heading', { name: 'Volkswagen Golf' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ford Focus' })).toBeInTheDocument();
    expect(screen.getByText(/Reserved/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reserve/ })).not.toBeInTheDocument();
  });
  it.each(templates)('uses a truthful error state instead of advertising stale hero stock in %s', template => {
    render(hero(template, cars, { error: 'Could not refresh stock' }));
    expect(screen.getByRole('status')).toHaveTextContent('Stock is temporarily unavailable');
    expect(screen.queryByRole('heading', { name: 'Ford Focus' })).not.toBeInTheDocument();
    expect(screen.queryByText(/See all.*cars/)).not.toBeInTheDocument();
  });
  it('sends the Forecourt PX shortcut to contact when public enquiries are disabled', () => {
    render(hero('forecourt', cars, { publicEnquiriesEnabled: false, settings: { ...settings, partExchange: { ...settings.partExchange, enabled: true } } }));
    expect(screen.getByRole('link', { name: 'Part exchange' })).toHaveAttribute('href', '/contact');
  });
});

describe('Panorama browsing interactions', () => {
  const third = { ...cars[1], id: 'harbour-polo', model: 'Polo', title: 'Volkswagen Polo' };
  const stock = [...cars, third];
  const geometry = (rail: HTMLElement) => {
    let stride = 360;
    [...rail.children].forEach((child, index) => Object.defineProperty(child, 'offsetLeft', { configurable: true, get: () => 40 + index * stride }));
    const scroll = vi.fn(({ left }: { left: number }) => { rail.scrollLeft = left; });
    Object.defineProperty(rail, 'scrollTo', { configurable: true, value: scroll });
    return { scroll, resize: (width: number) => { stride = width; } };
  };
  it('handles rail keys, preserves its gutter and honours reduced motion without capturing link keys', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true })));
    render(hero('panorama', stock));
    const rail = screen.getByRole('region', { name: 'Featured cars' });
    const { scroll } = geometry(rail);
    fireEvent.keyDown(rail, { key: 'End' });
    expect(screen.getByRole('heading', { name: 'Volkswagen Polo' })).toBeInTheDocument();
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    expect(scroll).toHaveBeenLastCalledWith({ left: 720, behavior: 'auto' });
    scroll.mockClear();
    fireEvent.keyDown(within(rail).getByRole('link', { name: 'View Ford Focus' }), { key: 'Home' });
    expect(scroll).not.toHaveBeenCalled();
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    fireEvent.keyDown(rail, { key: 'Home' });
    expect(scroll).toHaveBeenLastCalledWith({ left: 0, behavior: 'auto' });
  });
  it('keeps the selected car aligned after resizing and stock reordering, and recovers when that car disappears', async () => {
    const view = render(hero('panorama', stock));
    const rail = screen.getByRole('region', { name: 'Featured cars' }), { scroll, resize } = geometry(rail);
    rail.scrollLeft = 360; fireEvent.scroll(rail);
    expect(screen.getByRole('heading', { name: 'Volkswagen Golf' })).toBeInTheDocument();
    resize(500); fireEvent(window, new Event('resize'));
    expect(scroll).toHaveBeenLastCalledWith({ left: 500, behavior: 'auto' });
    view.rerender(hero('panorama', [third, cars[0], cars[1]]));
    expect(screen.getByRole('heading', { name: 'Volkswagen Golf' })).toBeInTheDocument();
    expect(screen.getByText('3 / 3')).toBeInTheDocument();
    view.rerender(hero('panorama', [third, cars[0]]));
    await waitFor(() => expect(screen.getByText('1 / 2')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Next featured car' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Next featured car' }));
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Ford Focus' })).toBeInTheDocument();
  });
  it('suppresses the click after a swipe while retaining keyboard activation and a fresh tap', () => {
    render(hero('panorama', stock));
    const rail = screen.getByRole('region', { name: 'Featured cars' }), link = within(rail).getByRole('link', { name: 'View Ford Focus' });
    const activate = vi.fn((event: Event) => event.preventDefault()); link.addEventListener('click', activate);
    expect(fireEvent.dragStart(within(link).getByRole('img'), { cancelable: true })).toBe(false);
    fireEvent.touchStart(link, { touches: [{ clientX: 250, clientY: 80 }] });
    fireEvent.touchMove(link, { touches: [{ clientX: 90, clientY: 80 }] });
    fireEvent.touchEnd(link, { touches: [] });
    fireEvent.click(link, { detail: 1 }); expect(activate).not.toHaveBeenCalled();
    fireEvent.click(link, { detail: 0 }); expect(activate).toHaveBeenCalledOnce();
    fireEvent.touchStart(link, { touches: [{ clientX: 100, clientY: 80 }] });
    fireEvent.touchEnd(link, { touches: [] });
    fireEvent.click(link, { detail: 1 }); expect(activate).toHaveBeenCalledTimes(2);
  });
});
