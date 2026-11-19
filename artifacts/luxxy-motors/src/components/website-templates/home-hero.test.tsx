import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { dealerConfig } from '@/config/dealer';
import type { Car } from '@/lib/stock-context';
import { CustomerTemplateHomeHero } from './home-hero';

const cars = [{ id: 'harbour-focus', make: 'Ford', model: 'Focus', title: 'Ford Focus', variant: '1.0 manual', currency: 'GBP', price: 9999, registration: 'AB16 CDE', images: ['https://images.example/harbour-focus.jpg'], heroImage: 'https://images.example/harbour-focus.jpg' }, { id: 'harbour-golf', make: 'Volkswagen', model: 'Golf', title: 'Volkswagen Golf', currency: 'GBP', price: 7999, registration: 'AB16 FGH', images: ['https://images.example/harbour-golf.jpg'], heroImage: 'https://images.example/harbour-golf.jpg' }] as Car[];
const settings = { ...dealerConfig, identity: { name: 'Harbour Cars', logoAsset: '/harbour-logo.svg' }, address: { city: 'Leeds', region: 'West Yorkshire' }, partExchange: { ...dealerConfig.partExchange!, enabled: false }, hero: { ...dealerConfig.hero, announcement: '', copy: 'Find a car at Harbour Cars', subcopy: '' } };

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
});
