import { describe, expect, it } from 'vitest';
import { settingsChanges } from './settings-changes';
import { previewSettings } from '../../preview/settings';

describe('shared settings publication comparison', () => {
  it('does not report a newly copied unchanged draft or mutate either input', () => {
    const published=structuredClone(previewSettings), draft=structuredClone(published);
    expect(settingsChanges(published,draft)).toEqual([]);
    expect(published).toEqual(previewSettings);
    expect(draft).toEqual(published);
  });
  it('groups exact changed fields across all three editing areas', () => {
    const published=structuredClone(previewSettings), draft=structuredClone(published);
    draft.identity.name='Example Dealer'; draft.contact.phone='020 7946 0000'; draft.testDriveBooking!.confirmationMode='approval';
    const changes=settingsChanges(published,draft);
    expect(changes).toHaveLength(3);
    expect(changes).toContainEqual(expect.objectContaining({path:'contact.phone',group:'Dealership details',section:'contact',published:published.contact.phone,draft:'020 7946 0000'}));
    expect(changes).toContainEqual(expect.objectContaining({path:'identity.name',group:'Website',section:'identity',label:'Dealership name'}));
    expect(changes).toContainEqual(expect.objectContaining({path:'testDriveBooking.confirmationMode',group:'Bookings',published:'Confirm immediately',draft:'Require staff approval'}));
  });
  it('compares against the supplied latest publication, including an external change', () => {
    const original=structuredClone(previewSettings), draft=structuredClone(original), latest=structuredClone(original);
    draft.hero.copy='A draft headline'; latest.contact.phone='020 7946 1234';
    expect(settingsChanges(latest,draft)).toEqual(expect.arrayContaining([
      expect.objectContaining({path:'hero.copy',draft:'A draft headline'}),
      expect.objectContaining({path:'contact.phone',published:'020 7946 1234',draft:original.contact.phone}),
    ]));
  });
  it('reports featured reordering even when the set of vehicles has not changed', () => {
    const published=structuredClone(previewSettings), draft=structuredClone(published);
    published.featuredVehicleIds=['a','b']; draft.featuredVehicleIds=['b','a'];
    expect(settingsChanges(published,draft,{a:'Ford Focus',b:'Toyota Yaris'})).toEqual([
      expect.objectContaining({label:'Featured vehicles and order',section:'homepage',published:'Ford Focus\nToyota Yaris',draft:'Toyota Yaris\nFord Focus'}),
    ]);
  });
  it('keeps complete long wording and shows cleared and disabled values accurately', () => {
    const published=structuredClone(previewSettings), draft=structuredClone(published);
    published.presentation={...published.presentation,websiteCopy:{generalDescription:'An older introduction'},reviewsEnabled:true};
    const wording='Long approved dealership wording. '.repeat(20);
    draft.presentation={...published.presentation,websiteCopy:{generalDescription:wording},reviewsEnabled:false};
    draft.contact.email=''; published.contact.email='sales@example.test';
    expect(settingsChanges(published,draft)).toEqual(expect.arrayContaining([
      expect.objectContaining({path:'presentation.websiteCopy.generalDescription',section:'pages',label:'Page wording: General description',draft:wording}),
      expect.objectContaining({path:'presentation.reviewsEnabled',published:'On',draft:'Off'}),
      expect.objectContaining({path:'contact.email',published:'sales@example.test',draft:'Not set'}),
    ]));
  });
  it('shows changed review content even when the review count and author stay the same', () => {
    const published=structuredClone(previewSettings), draft=structuredClone(published);
    draft.presentation!.reviews![0].review='Revised exact review wording';
    const changed=settingsChanges(published,draft);
    expect(changed).toHaveLength(1);
    expect(changed[0].path).toBe('presentation.reviews');
    expect(changed[0].draft).toContain('Revised exact review wording');
    expect(changed[0].published).not.toContain('Revised exact review wording');
  });
  it('shows all appointment hours and routes settings to the matching editor', () => {
    const published=structuredClone(previewSettings), draft=structuredClone(published);
    draft.testDriveBooking!.weeklyHours[1]={day:1,enabled:true,open:'12:00',close:'17:00'};
    draft.brochure={...draft.brochure,footerNote:'Call before travelling.'};
    expect(settingsChanges(published,draft)).toEqual(expect.arrayContaining([
      expect.objectContaining({path:'testDriveBooking.weeklyHours',section:'bookings',draft:expect.stringContaining('Monday: 12:00–17:00')}),
      expect.objectContaining({path:'brochure.footerNote',section:'brochure',draft:'Call before travelling.'}),
    ]));
  });
});
