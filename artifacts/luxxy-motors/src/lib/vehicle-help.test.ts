import { describe, expect, it } from 'vitest';
import { vehicleFeatureDetails, vehicleFeatureHelp, vehicleFeatureLabel, vehicleHelpText } from './vehicle-help';

describe('vehicle equipment explanations', () => {
  it.each([
    ['Parking Sensor - Front', 'Front parking sensors'],
    ['Parking Sensor - Rear', 'Rear parking sensors'],
    ['Cruise Control with SPEEDTRONIC Variable Speed Limiter', 'Cruise control and speed limiter'],
    ['Automatic Climate Control with Digital Display', 'Automatic climate control'],
    ['Bluetooth Interface for Hands-Free Telephone', 'Bluetooth hands-free calls'],
    ['Hard Disk Drive HDD Map Navigation System with TMC Traffic Message Channel', 'Built-in navigation'],
    ['ISOFIX Child Seat Fixing Points in Rear - Two Outer Seats', 'ISOFIX child-seat mounting points'],
  ])('uses a concise customer label for “%s”', (feature, label) => {
    expect(vehicleFeatureLabel(feature)).toBe(label);
  });

  it.each([
    '17in Alloy Wheels - 5 Twin-Spoke Design',
    '7in Colour Display',
    'Chrome Trim Window Highlights',
    'Apple CarPlay',
    'Android Auto',
    'Telephone Keypad',
    'Optional parking sensors',
    'Front or rear parking sensors',
    'Special factory specification ABC-123',
  ])('retains the supplied wording for detailed, branded or unconfirmed equipment: %s', feature => {
    expect(vehicleFeatureLabel(feature)).toBe(feature);
  });

  it('distinguishes front, rear and unspecified parking sensors', () => {
    expect(vehicleFeatureDetails('Parking Sensor - Front')).toMatchObject({ icon: 'parking-front', title: 'Front parking sensors' });
    expect(vehicleFeatureHelp('Parking Sensor - Front')).toContain('at the front');
    expect(vehicleFeatureHelp('Parking Sensor - Front')).not.toContain('at the rear');
    expect(vehicleFeatureDetails('Parking Sensor - Rear')).toMatchObject({ icon: 'parking-rear', title: 'Rear parking sensors' });
    expect(vehicleFeatureHelp('Parking Sensor - Rear')).toContain('at the rear');
    expect(vehicleFeatureDetails('Front and rear parking sensors')).toMatchObject({ icon: 'parking' });
    expect(vehicleFeatureHelp('Parking sensors')).not.toMatch(/front|rear/);
    expect(vehicleFeatureDetails('Active Park Assist with Parktronic')?.icon).toBe('parking-assist');
  });

  it('matches heated front seats even with a position between heated and seats', () => {
    expect(vehicleFeatureDetails('Heated Front Seats')).toEqual({
      title: 'Heated front seats', icon: 'heated-seats', description: 'Built-in heaters warm the front seats.',
    });
    expect(vehicleFeatureHelp('Heated Rear Seats')).toBe('Built-in heaters warm the rear seats.');
    expect(vehicleFeatureHelp('Heated seats')).not.toMatch(/front|rear/);
    expect(vehicleFeatureDetails('Heated Windscreen Washer System')?.icon).toBe('heated-washers');
    expect(vehicleFeatureHelp('Heated Windscreen Washer System')).not.toMatch(/heats the windscreen|heated windscreen[.]/);
  });

  it('explains cruise control and SPEEDTRONIC without upgrading it to adaptive cruise', () => {
    const details = vehicleFeatureDetails('Cruise Control with SPEEDTRONIC Variable Speed Limiter');
    expect(details).toMatchObject({ title: 'Cruise control and speed limiter', icon: 'cruise-control' });
    expect(details?.description).toContain('separate limiter mode');
    expect(details?.description).not.toMatch(/vehicle ahead|automatically brakes|braking/);
    expect(vehicleFeatureDetails('Adaptive cruise control')?.icon).toBe('adaptive-cruise-control');
    expect(vehicleFeatureDetails('Non-adaptive cruise control')?.icon).toBe('cruise-control');
    expect(vehicleFeatureHelp('Speed limiter')).not.toMatch(/maintains? your|distance|vehicle ahead/);
  });

  it('keeps hands-free calls, audio streaming and phone integration distinct', () => {
    const calls = vehicleFeatureDetails('Bluetooth Interface for Hands-Free Telephone');
    expect(calls?.icon).toBe('bluetooth-calls');
    expect(calls?.description).not.toMatch(/music|streaming|audio/);
    expect(vehicleFeatureDetails('Bluetooth music streaming')?.icon).toBe('bluetooth-audio');
    expect(vehicleFeatureDetails('Bluetooth hands-free calls and audio streaming')?.description).toContain('calls and supported audio');
    expect(vehicleFeatureDetails('Bluetooth')?.description).not.toMatch(/calls and|music streaming/);
    expect(vehicleFeatureDetails('Apple CarPlay')?.icon).toBe('phone-integration');
  });

  it('explains the digital climate display and conditional TMC traffic availability', () => {
    expect(vehicleFeatureHelp('Automatic Climate Control with Digital Display')).toContain('settings shown on a digital display');
    const navigation = vehicleFeatureDetails('Hard Disk Drive HDD Map Navigation System with TMC Traffic Message Channel');
    expect(navigation?.icon).toBe('navigation');
    expect(navigation?.description).toContain('where a compatible broadcast is available');
    expect(navigation?.description).not.toMatch(/live traffic|latest maps|up.to.date maps/);
    expect(vehicleFeatureHelp('Satellite navigation')).toContain('Map age');
    expect(vehicleFeatureHelp('Manual climate control')).not.toMatch(/automatically|maintain/);
    expect(vehicleFeatureHelp('Windscreen wipers')).not.toMatch(/rain is detected|automatically|sensor/);
    expect(vehicleFeatureHelp('Electric windows')).not.toMatch(/one.touch|obstruction/);
  });

  it('preserves confirmed ISOFIX positions without adding unsupported positions', () => {
    const details = vehicleFeatureDetails('ISOFIX Child Seat Fixing Points in Rear - Two Outer Seats');
    expect(details).toMatchObject({ title: 'ISOFIX child-seat mounting points', icon: 'isofix' });
    expect(details?.description).toContain('two outer rear seats');
    expect(vehicleFeatureHelp('ISOFIX')).not.toContain('two outer');
    expect(vehicleFeatureDetails('Automatic Child Seat Recognition Sensor')?.icon).toBe('child-seat-sensor');
  });

  it('does not add equipment or capabilities from loosely related terms', () => {
    expect(vehicleFeatureHelp('Tyre Pressure Loss Warning System')).not.toMatch(/live pressure|reading for each/);
    expect(vehicleFeatureHelp('Boot Release Interior Switch in Drivers Door')).not.toMatch(/powered tailgate|automatically opens/);
    expect(vehicleFeatureHelp('Collision Prevention Assist')).not.toMatch(/automatic.*brak|brakes for/);
    expect(vehicleFeatureHelp('Door Mirrors - Electrically Adjustable-Folding-Heated')).not.toMatch(/powered folding|electrically fold/);
    expect(vehicleFeatureHelp('Seats - Front Electrical Height Adjustment')).toBe('Lets you adjust the height of the front seats electrically.');
    expect(vehicleFeatureHelp('Comfort Suspension')).not.toMatch(/adjustable|air suspension/);
  });

  it('does not infer voltage, outside temperature, colour or automation from generic labels', () => {
    const socket = vehicleFeatureDetails('230V power socket');
    expect(socket?.title).toBe('Accessory power socket');
    expect(socket?.description).not.toContain('12V');
    expect(vehicleFeatureDetails('12V Socket in Front Storage Compartment')?.title).toBe('12V power socket');
    expect(vehicleFeatureHelp('Engine temperature gauge')).not.toMatch(/outside|road surfaces/);
    expect(vehicleFeatureHelp('Outside Air Temperature Gauge')).toContain('outside-air temperature');
    expect(vehicleFeatureDetails('Instrument cluster')?.title).toBe('Instrument cluster');
    expect(vehicleFeatureHelp('Instrument cluster')).not.toMatch(/colour|screen/);
    expect(vehicleFeatureDetails('Colour Instrument Cluster')?.title).toBe('Colour instrument cluster');
    expect(vehicleFeatureDetails('Climate control')?.title).toBe('Climate control');
    expect(vehicleFeatureHelp('Climate control')).not.toMatch(/automatically|maintain/);
    expect(vehicleFeatureHelp('Automatic Climate Control')).toContain('Automatically');
    expect(vehicleFeatureHelp('Sports braking system')).not.toMatch(/perforated|holes/);
    expect(vehicleFeatureHelp('Braking System with Perforated Brake Discs')).toContain('holes');
  });

  it.each([
    '', 'Mystery equipment package', 'No heated seats', 'Without parking sensors',
    'Cruise control not fitted', 'Bluetooth unavailable', 'Optional navigation',
    'Rear camera if fitted', 'Front or rear parking sensors', 'Heated seats not confirmed',
  ])('does not explain absent, ambiguous or unknown equipment as fitted: %s', (feature) => {
    expect(vehicleFeatureDetails(feature)).toBeUndefined();
    expect(vehicleFeatureHelp(feature)).toBeUndefined();
  });

  it('keeps existing compact helpers and normal vehicle facts compatible', () => {
    expect(vehicleFeatureHelp('DAB Digital Radio Tuner')).toBe(vehicleFeatureDetails('DAB Digital Radio Tuner')?.description);
    expect(vehicleHelpText('Mileage', '22,000 miles')).toContain('total distance');
    expect(vehicleHelpText('Transmission', 'Manual')).toContain('clutch pedal');
  });

  const listedEquipment = [
    '10GB Music Register and MP3 Compatibility',
    '12V Socket in Front Storage Compartment',
    '7in Colour Display',
    'CD-Radio',
    'COMAND Online System with Media Interface',
    'DAB Digital Radio Tuner',
    'In-Car Internet Access Requires Internet Enabled Mobile Phone',
    'Media Interface - Cables Included for AUX-In-USB or iPod Connectivity',
    'SD Card Slot',
    'Telephone Keypad',
    'USB and AUX-in Ports in Centre Console',
    'ATTENTION Assist',
    'Active Park Assist with Parktronic',
    'Central Controller Dial to Operate Audio and Telephone Functions',
    'Fuel Computer',
    'Linguatronic Voice Control',
    'Outside Air Temperature Gauge',
    'Service Indicator ASSYST PLUS',
    'Tyre Pressure Loss Warning System',
    '17in Alloy Wheels - 5 Twin-Spoke Design',
    'Chrome Trim Window Highlights',
    'Chrome Trim on Side and Rear Bumper',
    'Door Handles - Body Coloured',
    'Door Mirrors - Electrically Adjustable-Folding-Heated',
    'Electric Windows - 4 - With One-Touch Opening and Closing - including Obstruction Sensors',
    'Exhaust - Twin Square',
    'Heated Windscreen Washer System',
    'LED Indicators Integrated in Exterior Mirrors',
    'Locking Wheel Bolts',
    'Mirror Package',
    'Partial LED Headlights - Side Lights and Dippped Beam',
    'Radiator Grille - 3 Louvres/Painted Grey/Bonnet-Mounted Star',
    'Silver exterior colour',
    'Spare Wheel - Space-Saver - Steel with Wheel Bolts',
    'Unique Rear Apron Body-coloured with Visible Twin Exhaust Pipes',
    'Daytime Running Lights - LED',
    'LED Tail Lights',
    'Rear Tail Lights-Indicators and Third Brake Light - LED',
    'Air-Conditioned and Lockable Glove Compartment',
    'Ambient Lighting - Dashboard and Door Panels with Dimmer Function',
    'Automatically Dimming Rear View Mirror and Drivers Door Mirror',
    'Bag Hooks in Boot',
    'Boot Release Interior Switch in Drivers Door',
    'Bottle Holder in Front Passenger Footwell',
    'Centre Armrest - Front with Storage',
    'Colour Instrument Cluster',
    'Cup Holder - Front',
    'Cup Holder - Twin Rear',
    'Door Pockets Front and Rear-Map Pockets on Rear of Front Seat Backrests',
    'Door Sill Panels - Stainless Steel Inlays with Mercedes-Benz Lettering',
    'Head Restraints - Front Seats - Neck-Pro Active',
    'Head Restraints - Rear - Manually Adjustable for Height',
    'Interior Lighting in Rear with Integrated Reading Lights',
    'Lumbar Support',
    'Pollen Filter',
    'Rain-Sensing Wipers',
    'Rear Armrest with Compartment',
    'Seats - Front Electrical Height Adjustment',
    'Steering Column - Manually Adjustable for Height and Reach',
    'Steering Wheel - 3-Spoke-Multi-Function-Nappa Leather',
    'Steering Wheel - Gear Shift Paddles',
    'Steering Wheel - Multi-Function',
    'Sun Visors with Illuminated Vanity Mirrors',
    'Trim - Dark Aluminium',
    'Comfort Suspension',
    'DIRECT CONTROL - Comfort Suspension',
    'Power Steering - Speed Sensitive',
    'ABS - Anti-Lock Braking System',
    'ASR - Acceleration Skid Control',
    'Active Bonnet - Pedestrian Safety which Detects an Impact and Raises Bonnet',
    'Adaptive Brake System with Full Hold Function',
    'Airbags - Drivers Kneebag',
    'Airbags - Front Sidebags',
    'Airbags - Multi Stage for Driver',
    'Airbags - Multi Stage for Front Passenger',
    'Airbags - Pelvisbag',
    'Alarm System with Immobiliser and Interior Protection',
    'Automatic Child Seat Recognition Sensor',
    'BAS - Brake Assist',
    'Collision Prevention Assist',
    'ESP - Electronic Stability Programme',
    'First Aid Kit',
    'Immobiliser',
    'Integrated Side Impact Protection',
    'Pre-Safe Anticipatory Safety System',
    'Rear Seat Belts Status Indicator',
    'Remote Central Locking with Acoustic Closing Settings',
    'Sports Braking System - Front with Perforated Brake Discs and Calipers with Mercedes-Benz Lettering',
    'Warning Triangle',
    'Windowbags for Driver-Front Passenger and Rear Passengers',
  ];

  it.each(listedEquipment)('provides useful help for supplied equipment: %s', (feature) => {
    const details = vehicleFeatureDetails(feature);
    expect(details?.title).toBeTruthy();
    expect(details?.description.length).toBeGreaterThan(20);
    expect(details?.icon).toBeTruthy();
  });
});
