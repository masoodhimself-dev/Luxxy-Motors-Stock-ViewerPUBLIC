import { expect, it } from 'vitest';
import { vehicleSheetAccent, vehicleSheetUsesWebsiteColour } from './vehicle-sheet-branding';
import { hexColourContrast } from './brand-colour';
it('inherits website branding when the vehicle sheet has no print override', () => {
  expect(vehicleSheetAccent('120 100% 20%')).toBe('#006600');
  expect(hexColourContrast(vehicleSheetAccent('42 80% 80%'), '#ffffff')).toBeGreaterThanOrEqual(4.5);
});
it('preserves an existing print override and safely falls back for unavailable website colours', () => {
  expect(vehicleSheetAccent('120 100% 20%', '#835B33')).toBe('#835B33');
  expect(vehicleSheetAccent(undefined)).toBe('#263c46');
});

it('uses an explicit website mode without losing a retained print override', () => {
  expect(vehicleSheetUsesWebsiteColour({accentColour:'#835b33'})).toBe(false);
  expect(vehicleSheetUsesWebsiteColour({accentColour:'#835b33',useWebsiteColour:true})).toBe(true);
  expect(vehicleSheetAccent('120 100% 20%','#835b33',true)).toBe('#006600');
  expect(vehicleSheetAccent('120 100% 20%','#835b33',false)).toBe('#835b33');
});
