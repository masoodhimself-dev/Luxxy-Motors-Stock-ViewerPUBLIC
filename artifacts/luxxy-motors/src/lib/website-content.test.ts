import { describe, expect, it } from 'vitest';
import { customerDefaultCopy, websiteFields, websiteText } from './website-content';
describe('dealer page wording', () => {
  it('uses defaults for legacy settings and blank overrides', () => {
    expect(websiteText({}, 'stockTitle')).toBe('Browse Stock');
    expect(websiteText({}, 'featuredHeading')).toBe('Explore our cars');
    expect(websiteText({ presentation: { websiteCopy: { featuredHeading: 'Featured cars' } } }, 'featuredHeading')).toBe('Explore our cars');
    expect(websiteText({ presentation: { websiteCopy: { featuredHeading: 'Our favourites' } } }, 'featuredHeading')).toBe('Our favourites');
    expect(websiteText({ presentation: { websiteCopy: { stockTitle: '  ' } } }, 'stockTitle')).toBe('Browse Stock');
  });
  it('uses the dealership wording and keeps a unique content inventory', () => {
    expect(websiteText({ presentation: { websiteCopy: { stockTitle: ' Our cars ' } } }, 'stockTitle')).toBe('Our cars');
    expect(new Set(websiteFields.map(field => field.key)).size).toBe(websiteFields.length);
  });
  it('refreshes persisted unchanged template defaults without mutating the saved copy', () => {
    const websiteCopy = {
      contactTalkHeading: 'Talk to the showroom',
      generalDescription: 'A direct line to the team behind the showroom. We will come back to you with a useful answer.',
      teamHeading: 'Meet the team',
    };
    const original = structuredClone(websiteCopy);
    const settings = { presentation: { websiteCopy } };
    expect(websiteText(settings, 'contactTalkHeading')).toBe('Talk to us');
    expect(websiteText(settings, 'generalDescription')).toBe('Tell us what you’d like to know. We’ll get back to you.');
    expect(websiteText(settings, 'teamHeading')).toBe('Meet our team');
    expect(websiteCopy).toEqual(original);
  });
  it('preserves bespoke wording even when it contains third-person template phrases', () => {
    const copy = 'Speak to the team at our showroom. Ask for Mary when you arrive.';
    expect(websiteText({ presentation: { websiteCopy: { contactIntroduction: copy } } }, 'contactIntroduction')).toBe(copy);
    const extended = 'Talk to the showroom — ask for Mary';
    expect(websiteText({ presentation: { websiteCopy: { contactTalkHeading: extended } } }, 'contactTalkHeading')).toBe(extended);
  });
  it('keeps supplied sample facts and formatted visit instructions while replacing exact old defaults', () => {
    const supplied = '  Sample visiting information: call the showroom before travelling.\nAppointments only.  ';
    expect(customerDefaultCopy(supplied, 'Contact us for details.', ['Call the showroom.'])).toBe(supplied);
    expect(customerDefaultCopy('Call the showroom.', 'Contact us for details.', ['Call the showroom.'])).toBe('Contact us for details.');
    expect(customerDefaultCopy('  ', 'Contact us for details.')).toBe('Contact us for details.');
  });
});
