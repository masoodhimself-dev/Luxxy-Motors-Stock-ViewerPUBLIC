import { customerFeaturePolicy } from '@workspace/vehicle-meta';
import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { previewSettings } from '../../preview/settings';
import { launchChecks, SettingsPreview } from './settings-preview';
import { customerThemeVariables } from '@/lib/customer-theme';
import { readableAccentForHsl } from '@/lib/brand-colour';
it('flags sample deployment content and unverified payment readiness', () => {
  const checks = launchChecks(previewSettings);
  expect(checks.find(check => check.label === 'Showroom address')?.issue).toContain('sample');
  if (customerFeaturePolicy.onlineCardReservations) expect(checks.find(check => check.label === 'Online payments')?.issue).toContain('does not verify');
  else expect(checks.find(check => check.label === 'Online payments')).toBeUndefined();
});

it('previews the actual public introduction toggle, supplied photo description and custom review heading', () => {
  const settings = structuredClone(previewSettings);
  settings.presentation = {...settings.presentation, showHeroDescription:false, heroImageUrl:'https://example.test/showroom.jpg',heroImageAlt:'The forecourt beside the showroom',reviewsEnabled:true,websiteCopy:{reviewsHeading:'Owners’ experiences'}};
  const {rerender} = render(<SettingsPreview settings={settings} />);
  expect(screen.queryByTestId('settings-hero-introduction-preview')).not.toBeInTheDocument();
  expect(screen.getByText('The homepage introduction is turned off.')).toBeInTheDocument();
  expect(screen.getByAltText('The forecourt beside the showroom')).toBeInTheDocument();
  expect(screen.getByRole('heading',{name:'Owners’ experiences'})).toBeInTheDocument();
  settings.presentation.showHeroDescription = true;
  rerender(<SettingsPreview settings={settings} />);
  expect(screen.getByTestId('settings-hero-introduction-preview')).toHaveTextContent(settings.hero.subcopy);
});

it('uses the customer theme’s readable surfaces instead of fixed white preview panels', () => {
  const settings = structuredClone(previewSettings);
  settings.presentation = {...settings.presentation,pageColour:'#121212',panelColour:'#202020',headingColour:'#f0f0f0',linkColour:'#eeeeee'};
  settings.identity.brandColors.primaryHsl = '55 90% 80%';
  const theme=customerThemeVariables({...settings.presentation,...settings.identity.brandColors,accentHsl:readableAccentForHsl(settings.identity.brandColors.accentHsl)});
  const {container} = render(<SettingsPreview settings={settings} />);
  expect(screen.getByTestId('settings-theme-preview')).toHaveStyle({background:theme['--dealer-page']});
  expect(container.querySelector('.settings-preview-card-body')?.parentElement).toHaveStyle({background:theme['--dealer-panel'],color:theme['--dealer-panel-ink']});
  expect(container.querySelector('.settings-preview-card-header')).toHaveStyle({color:theme['--customer-footer-foreground']});
});
it('does not flag disabled reservations or a genuine supplied address', () => {
  const settings = structuredClone(previewSettings);
  settings.address = { ...settings.address, street: '42 High Street', postcode: 'HA1 1AA' };
  settings.onlineReservation = { ...settings.onlineReservation!, enabled: false };
  const checks = launchChecks(settings);
  expect(checks.find(check => check.label === 'Showroom address')?.issue).toBeNull();
  expect(checks.find(check => check.label === 'Online payments')?.issue ?? null).toBeNull();
});

it('does not ask for unused showroom photography and distinguishes unknown hours', () => {
  const settings = structuredClone(previewSettings);
  settings.hours = [{days:'Monday – Saturday',times:'08:00 – 18:00'}];
  settings.presentation = {...settings.presentation,showroomImageUrl:''};
  const checks = launchChecks(settings);
  expect(checks.some(check => check.label === 'Dealership photography')).toBe(false);
  expect(checks.find(check => check.label === 'Opening hours')?.issue).toContain('unknown');
});
