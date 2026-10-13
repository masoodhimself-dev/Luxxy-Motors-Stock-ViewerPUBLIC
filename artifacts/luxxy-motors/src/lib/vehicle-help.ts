import { isUKNumberPlate } from './utils';

/** Short definitions explain supplied facts; they never add facts to a listing. */
export function vehicleHelpText(label: string, value = ''): string | undefined {
  const term = label.toLowerCase().replace(/[–—_-]/g, ' ').trim();
  const detail = value.toLowerCase();
  if (/previous keeper|previous owner|^owners?$/.test(term)) return 'The number of previous registered keepers of this car. A registered keeper is the person responsible for the vehicle, and may not be its legal owner.';
  if (/service history/.test(term)) {
    if (/partial|some/.test(detail)) return 'Some servicing records are available, but the history may have gaps. Ask us which records you can see.';
    if (/full/.test(detail)) return 'This car has full service history. Ask us to show you the records and service intervals.';
    return 'Records of servicing and maintenance. Ask us what paperwork is available and when the next service is due.';
  }
  if (/tax/.test(term)) return 'Road tax per year for this car. Please confirm the current amount before buying, as tax rates can change.';
  if (/^registration$|number plate/.test(term) && isUKNumberPlate(value)) return 'This car’s registration number. You can quote it when you contact us.';
  if (/^year|registration year|^registration$/.test(term)) return 'The year the car was first registered. A label such as “65 reg” is a UK registration age identifier, not the car’s full number plate.';
  if (/mileage|miles/.test(term)) return /below average|lower mileage/.test(detail)
    ? 'How far this car has travelled. “Below average” means fewer miles than comparable vehicles.'
    : 'The total distance this car has travelled.';
  if (/gearbox|transmission/.test(term)) return /automatic|auto|s tronic|dsg/.test(detail)
    ? 'An automatic gearbox changes gears for you. Ask us about this car’s gearbox and driving modes.'
    : /manual/.test(detail)
      ? 'A manual gearbox lets the driver select gears using the gear lever and clutch pedal.'
      : 'The type of gearbox used to change gears, such as manual or automatic.';
  if (/^(?:engine(?: size| capacity| cc| displacement)?|cubic capacity)(?:\s*\(.*\))?$/.test(term)) return 'Engine size is usually shown in litres or cubic centimetres (cc). It describes engine capacity, rather than power.';
  if (/^fuel(?: type)?$/.test(term)) return 'The fuel or energy type used by this vehicle, such as petrol, diesel, hybrid or electric.';
  if (/insurance group/.test(term)) return 'A vehicle classification used by insurers when assessing premiums. Your actual quote also depends on you and the insurer.';
  if (/co₂|co2/.test(term)) return 'Carbon dioxide emissions, usually measured in grams per kilometre (g/km). A lower figure means less CO₂ in the stated test.';
  if (/emission/.test(term)) return 'This car’s emissions standard or figure. Check local driving-zone requirements separately before travelling.';
  if (/extra urban/.test(term)) return 'Fuel economy measured in an out-of-town test. MPG means miles per gallon; a higher figure means less fuel used in that test.';
  if (/^urban$/.test(term)) return 'Fuel economy measured in a town-driving test. MPG means miles per gallon; actual driving conditions affect fuel use.';
  if (/^average$|combined|fuel economy|mpg/.test(term)) return 'Fuel economy across the stated test cycle. MPG means miles per gallon; actual fuel use depends on how and where you drive.';
  if (/mot/.test(term)) return 'The expiry date of the vehicle’s MOT roadworthiness test. Ask us for the test record and any advisories.';
  if (/keys/.test(term)) return 'The number of keys included with this car. Ask us about the keys and any spare.';
  if (/^body(?: type| style)?$/.test(term)) return 'The vehicle’s shape or body style, such as hatchback, estate, saloon or SUV.';
  if (/drivetrain|wheel drive/.test(term)) return 'Which wheels receive power from the engine or motor: front wheels, rear wheels or all four wheels.';
  if (/doors/.test(term)) return 'The number of doors on this car. On a hatchback, the rear hatch is often counted as a door.';
  if (/seats/.test(term)) return 'The number of seats in this car.';
  if (/colour/.test(term)) return 'This car’s exterior colour. Photographs and lighting can affect how it looks on screen.';
  if (/warranty/.test(term)) return 'Cover for specified faults under a warranty policy. Ask us about eligibility, duration, exclusions and claim limits.';
  if (/insurance history/.test(term)) return 'This car’s recorded insurance history. Ask us for the available background and repair records.';
  if (/condition/.test(term)) return 'Notes about this car’s condition. Ask about wear, damage or anything you would like checked before visiting.';
  if (/included with/.test(term)) return 'Items or services included with this car. Please confirm the details with us before purchase.';
  if (/boot space/.test(term)) return 'The stated luggage capacity, usually measured in litres. “Seats up” means the rear seats are in their normal position.';
  if (/0\s*(?:to|–|-)\s*62|acceleration/.test(term)) return 'The stated time for the vehicle to accelerate from rest to the listed speed. A lower time indicates quicker acceleration.';
  if (/power|bhp|ps$/.test(term)) return 'The engine or motor’s stated power output. BHP, PS and kW are different units used to measure power.';
  if (/torque/.test(term)) return 'The engine or motor’s turning force. It influences how strongly the car pulls, particularly at lower speeds.';
  if (/top speed/.test(term)) return 'The vehicle’s stated maximum speed under test conditions.';
  return undefined;
}

export function vehicleFeatureHelp(feature: string): string | undefined {
  const text = feature.toLowerCase();
  if (/isofix/.test(text)) return 'Built-in mounting points for compatible child seats. Check the car and seat instructions for the supported positions.';
  if (/\babs\b|anti.lock brak/.test(text)) return 'Anti-lock braking helps prevent the wheels from locking during heavy braking.';
  if (/\b(?:esp|esc)\b|stability control/.test(text)) return 'Electronic stability control can help maintain grip by reducing power or braking individual wheels.';
  if (/adaptive cruise/.test(text)) return 'Cruise control that can adjust speed to maintain a set distance from the vehicle ahead. The driver remains responsible for driving.';
  if (/cruise control/.test(text)) return 'Maintains a selected speed without keeping your foot on the accelerator. It can be cancelled when you need to change speed.';
  if (/speed limiter/.test(text)) return 'Lets the driver set a maximum speed to help avoid going above it in normal driving.';
  if (/parking sensor/.test(text)) return 'Sensors warn when nearby objects are detected while parking. Ask us whether this car has front sensors, rear sensors or both.';
  if (/revers(?:ing|e) camera/.test(text)) return 'Shows a camera view behind the car to help with reversing. It does not replace checking your surroundings.';
  if (/bluetooth/.test(text)) return 'Wireless connection for a compatible phone, commonly used for calls or audio. Available functions depend on the car’s system.';
  if (/apple carplay|android auto/.test(text)) return 'Displays supported phone apps through the car’s screen. Check phone compatibility and whether a cable is required.';
  if (/\bdab\b/.test(text)) return 'Digital Audio Broadcasting: digital radio reception, subject to local signal coverage.';
  if (/climate control/.test(text)) return 'Automatically adjusts heating or cooling to maintain your chosen cabin temperature.';
  if (/air conditioning/.test(text)) return 'Cools and helps dehumidify the cabin air.';
  if (/heated seat/.test(text)) return 'Built-in heaters warm the seats. Ask us which seats are heated.';
  if (/sat(?:ellite)? nav|navigation/.test(text)) return 'Built-in route guidance. Ask us whether maps and any connected services are up to date.';
  if (/start.stop|stop.start/.test(text)) return 'Can switch the engine off when the car is stationary and restart it when you move off, subject to operating conditions.';
  if (/alloy wheel/.test(text)) return 'Wheels made from a metal alloy. A size such as 17 inches describes the wheel diameter.';
  return undefined;
}
