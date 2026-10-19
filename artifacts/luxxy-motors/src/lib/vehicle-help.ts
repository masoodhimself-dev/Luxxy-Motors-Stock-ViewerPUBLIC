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

/** Semantic equipment keys are independent of the small interface icon family. */
export type VehicleFeatureIconKey =
  | 'parking-front' | 'parking-rear' | 'parking' | 'parking-assist'
  | 'cruise-control' | 'adaptive-cruise-control' | 'speed-limiter'
  | 'climate' | 'heated-seats' | 'bluetooth-calls' | 'bluetooth-audio'
  | 'phone-integration' | 'navigation' | 'isofix' | 'brakes' | 'stability'
  | 'traction' | 'camera' | 'radio' | 'air-conditioning' | 'stop-start'
  | 'wheels' | 'audio' | 'power-socket' | 'display' | 'connectivity'
  | 'voice' | 'driver-attention' | 'trip-computer' | 'temperature'
  | 'service' | 'tyre-pressure' | 'exterior' | 'mirrors' | 'windows'
  | 'exhaust' | 'heated-washers' | 'lights' | 'security' | 'spare-wheel'
  | 'storage' | 'armrest' | 'cup-holder' | 'head-restraint' | 'seat-adjustment'
  | 'filter' | 'wipers' | 'steering' | 'suspension' | 'airbag'
  | 'child-seat-sensor' | 'collision-warning' | 'first-aid' | 'seat-belts'
  | 'warning-triangle';

export interface VehicleFeatureDetails {
  title: string;
  description: string;
  icon: VehicleFeatureIconKey;
}

const featureDetails = (icon: VehicleFeatureIconKey, title: string, description: string): VehicleFeatureDetails => ({ icon, title, description });

/** Explain only the named equipment; a description is not a fitment check. */
export function vehicleFeatureDetails(feature: string): VehicleFeatureDetails | undefined {
  const text = feature.toLowerCase().replace(/[–—_-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || /\b(?:no|without)\s|\bnot\s+(?:fitted|included|available|equipped|present|confirmed|specified)|\b(?:unavailable|absent|deleted|removed|optional|unknown)\b|\bif fitted\b|\bfront or rear\b/.test(text)) return undefined;
  const hasFront = /\bfront\b/.test(text);
  const hasRear = /\brear\b/.test(text);

  if (/isofix/.test(text)) return featureDetails('isofix', 'ISOFIX child-seat mounting points',
    hasRear && /\b(?:two|2)\b.*\bouter\b|\bouter\b.*\b(?:two|2)\b/.test(text)
      ? 'Mounting points for compatible child seats on the two outer rear seats. Check the car and child-seat instructions before fitting.'
      : hasRear
        ? 'Mounting points for compatible child seats in the rear. Check the car and child-seat instructions for the supported positions.'
        : 'Mounting points for compatible child seats. Check the car and child-seat instructions for the supported positions.');
  if (/active park assist|parking assist|park assist/.test(text)) return featureDetails('parking-assist', 'Parking assistance', 'Helps with parking manoeuvres. The level of assistance depends on the system; the driver must check the surroundings and follow the car’s instructions.');
  if (/parking sensors?|parktronic/.test(text)) {
    if (hasFront && hasRear) return featureDetails('parking', 'Front and rear parking sensors', 'Sensors at the front and rear warn when nearby objects are detected while parking.');
    if (hasFront) return featureDetails('parking-front', 'Front parking sensors', 'Sensors at the front warn when nearby objects are detected while parking.');
    if (hasRear) return featureDetails('parking-rear', 'Rear parking sensors', 'Sensors at the rear warn when nearby objects are detected while parking.');
    return featureDetails('parking', 'Parking sensors', 'Warns when nearby objects are detected while parking.');
  }
  if (/\badaptive cruise/.test(text) && !/\b(?:non|not) adaptive\b/.test(text)) return featureDetails('adaptive-cruise-control', 'Adaptive cruise control', 'Can adjust speed to help maintain a selected distance from the vehicle ahead. The driver remains responsible for driving.');
  if (/cruise control/.test(text) && /speed limiter|speedtronic/.test(text)) return featureDetails('cruise-control', 'Cruise control and speed limiter', 'Cruise control maintains your chosen speed. Switch to the separate limiter mode to set a maximum speed instead.');
  if (/cruise control/.test(text)) return featureDetails('cruise-control', 'Cruise control', 'Maintains a selected speed without keeping your foot on the accelerator. It can be cancelled when you need to change speed.');
  if (/speed limiter|speedtronic/.test(text)) return featureDetails('speed-limiter', 'Speed limiter', 'Lets you set a maximum speed to help avoid exceeding it in normal driving.');
  if (/revers(?:ing|e) camera/.test(text)) return featureDetails('camera', 'Reversing camera', 'Shows a camera view behind the car to help with reversing. It does not replace checking your surroundings.');
  if (/heated.*\bseats?\b|\bseats?.*heated/.test(text)) return featureDetails('heated-seats', hasFront && hasRear ? 'Heated front and rear seats' : hasFront ? 'Heated front seats' : hasRear ? 'Heated rear seats' : 'Heated seats',
    hasFront && hasRear ? 'Built-in heaters warm the front and rear seats.' : hasFront ? 'Built-in heaters warm the front seats.' : hasRear ? 'Built-in heaters warm the rear seats.' : 'Built-in heaters warm the seats.');
  if (/climate control/.test(text) && /\bmanual\b/.test(text)) return featureDetails('climate', 'Manual climate control', 'Lets you adjust cabin heating, cooling and airflow using the controls.');
  if (/climate control/.test(text) && !/\b(?:automatic|auto)\b/.test(text)) return featureDetails('climate', 'Climate control', 'Controls for cabin heating, cooling and airflow.');
  if (/climate control/.test(text)) return featureDetails('climate', 'Automatic climate control', /digital display/.test(text)
    ? 'Automatically adjusts heating or cooling to maintain your chosen cabin temperature, with settings shown on a digital display.'
    : 'Automatically adjusts heating or cooling to maintain your chosen cabin temperature.');
  if (/bluetooth/.test(text)) {
    const calls = /hands free|telephone|phone calls|\bcalls?\b/.test(text);
    const audio = /streaming|audio|music/.test(text);
    if (calls && audio) return featureDetails('bluetooth-calls', 'Bluetooth calls and audio', 'Connects a compatible phone wirelessly for hands-free calls and supported audio playback.');
    if (calls) return featureDetails('bluetooth-calls', 'Bluetooth hands-free calls', 'Connects a compatible phone wirelessly so you can make and receive hands-free calls.');
    if (audio) return featureDetails('bluetooth-audio', 'Bluetooth audio', 'Plays supported audio wirelessly from a compatible device.');
    return featureDetails('connectivity', 'Bluetooth connection', 'A wireless connection for compatible devices. Available functions depend on the car’s system.');
  }
  if (/apple carplay|android auto/.test(text)) return featureDetails('phone-integration', 'Phone integration', 'Displays supported phone apps through the car’s screen. Check phone compatibility and whether a cable is required.');
  if (/sat(?:ellite)? nav|navigation/.test(text)) return featureDetails('navigation', 'Built-in navigation', /\btmc\b|traffic message channel/.test(text)
    ? 'Built-in route guidance with Traffic Message Channel information where a compatible broadcast is available. Map age and traffic coverage depend on the system.'
    : 'Built-in route guidance. Map age and any connected services depend on the system.');
  if (/automatic child seat recognition/.test(text)) return featureDetails('child-seat-sensor', 'Child-seat recognition', 'A recognition system for compatible child seats. Compatibility and operation depend on the seat and the car; follow both instruction manuals.');
  if (/\babs\b|anti lock brak/.test(text)) return featureDetails('brakes', 'Anti-lock braking', 'Helps prevent the wheels from locking during heavy braking.');
  if (/\basr\b|acceleration skid|traction control/.test(text)) return featureDetails('traction', 'Traction control', 'Helps reduce driven-wheel spin when accelerating by adjusting engine power or braking.');
  if (/\b(?:esp|esc)\b|stability control|stability programme/.test(text)) return featureDetails('stability', 'Electronic stability control', 'Can help keep the car on its intended course by reducing power or braking individual wheels.');
  if (/collision prevention|collision warning/.test(text)) return featureDetails('collision-warning', 'Collision warning assistance', 'Helps alert the driver to a potential collision risk so you can react.');
  if (/pre safe/.test(text)) return featureDetails('collision-warning', 'Anticipatory safety system', 'Can prepare supported occupant-protection systems when a critical driving situation is detected. The functions fitted depend on the car.');
  if (/active bonnet/.test(text)) return featureDetails('collision-warning', 'Pedestrian-protection bonnet', 'Designed to raise the bonnet when a qualifying impact is detected, creating space beneath it to help reduce injury.');
  if (/airbags?|windowbags?/.test(text)) {
    const title = /windowbag|curtain/.test(text) ? 'Curtain airbags' : /knee/.test(text) ? 'Knee airbag' : /pelvis/.test(text) ? 'Pelvis airbag' : /sidebag|side airbag/.test(text) ? 'Side airbags' : /passenger/.test(text) ? 'Front passenger airbag' : /driver/.test(text) ? 'Driver airbag' : 'Airbags';
    return featureDetails('airbag', title, 'An additional restraint designed to deploy in certain collisions. Airbags work with seat belts to help protect occupants.');
  }
  if (/side impact protection/.test(text)) return featureDetails('collision-warning', 'Side-impact protection', 'Vehicle structures and protection measures intended to help protect occupants in a side impact.');
  if (/seat belts?|seatbelts?/.test(text)) return featureDetails('seat-belts', /status|indicator/.test(text) ? 'Seat-belt status' : 'Seat belts', /status|indicator/.test(text) ? hasRear ? 'Shows whether the rear seat belts are fastened.' : 'Shows whether the monitored seat belts are fastened.' : 'Seat restraints designed to help hold occupants in place. Follow the car’s instructions for correct use.');
  if (/first aid/.test(text)) return featureDetails('first-aid', 'First-aid kit', 'A kit of basic first-aid supplies. Check its contents and expiry dates.');
  if (/warning triangle/.test(text)) return featureDetails('warning-triangle', 'Warning triangle', 'A portable warning marker for use where it is safe and appropriate. Follow local road rules.');
  if (/\bbas\b|brake assist/.test(text)) return featureDetails('brakes', 'Brake assistance', 'Helps increase braking support when the system detects an emergency braking input.');
  if (/adaptive brake|full hold/.test(text)) return featureDetails('brakes', /full hold/.test(text) ? 'Brake hold assistance' : 'Braking assistance', /full hold/.test(text) ? 'A hold function helps keep the car stationary when activated. Follow the car’s instructions for operation.' : 'Braking assistance designed to support the driver. Available functions depend on the system fitted.');
  if (/sports brak|brake disc|calipers/.test(text)) return featureDetails('brakes', 'Braking system', /perforated/.test(text) ? 'A perforated brake disc has holes in its surface. The calipers hold the brake pads against the disc to slow the car.' : 'The brake discs and calipers work together to slow the car when you press the brake pedal.');
  if (/attention assist|driver attention/.test(text)) return featureDetails('driver-attention', 'Driver-attention warning', 'Can warn of signs of reduced driver attention. It cannot determine whether you are fit to drive.');
  if (/tyre pressure|tire pressure/.test(text)) return featureDetails('tyre-pressure', 'Tyre-pressure warning', 'Warns when a loss of tyre pressure is detected.');
  if (/assyst|service indicator/.test(text)) return featureDetails('service', 'Service reminder', 'Reminds you when servicing is due, based on the car’s service-monitoring system.');
  if (/fuel computer|trip computer/.test(text)) return featureDetails('trip-computer', 'Trip and fuel computer', 'Displays information such as journey distance or fuel use. Readings depend on the car’s system.');
  if (/outside.*temperature/.test(text)) return featureDetails('temperature', 'Outside temperature display', 'Shows the measured outside-air temperature. Road surfaces may be colder than the displayed reading.');
  if (/temperature gauge/.test(text)) return featureDetails('temperature', 'Temperature gauge', 'Shows the temperature monitored by the car’s system.');
  if (/linguatronic|voice control/.test(text)) return featureDetails('voice', 'Voice control', 'Lets you operate supported car functions using spoken commands. Available commands depend on the system.');
  if (/central controller dial/.test(text)) return featureDetails('audio', 'Media controller', 'A physical dial for operating supported audio and telephone functions.');
  if (/\bdab\b/.test(text)) return featureDetails('radio', 'DAB digital radio', 'Digital Audio Broadcasting provides digital radio reception, subject to local signal coverage.');
  if (/in car internet|internet access/.test(text)) return featureDetails('connectivity', 'In-car internet access', /requires.*(?:mobile phone|phone)/.test(text) ? 'Uses a compatible internet-enabled mobile phone for the stated internet function. Phone settings, data charges and service availability apply.' : 'The listed internet function depends on compatible equipment, a data connection and service availability.');
  if (/comand/.test(text)) return featureDetails('display', 'COMAND media system', 'An in-car control and media system. Available functions and connected services depend on the equipment fitted and service availability.');
  if (/music register|mp3|cd radio|cd player/.test(text)) return featureDetails('audio', 'Music playback', /music register/.test(text) ? 'Stores supported music files in the car for playback, including compatible MP3 files.' : 'Lets you listen to radio or compatible music recordings through the car’s audio system.');
  if (/\b12v\b|power socket/.test(text)) return featureDetails('power-socket', /\b12v\b/.test(text) ? '12V power socket' : 'Accessory power socket', /\b12v\b/.test(text) ? 'A power outlet for compatible 12V accessories. Check the car’s rated power limit before use.' : 'A power outlet for compatible accessories. Check the voltage and rated power limit before use.');
  if (/sd card|usb|aux|media interface/.test(text)) return featureDetails('connectivity', 'Media connections', 'Connections for the listed compatible devices or media. Charging, playback and cable compatibility depend on the port and system.');
  if (/telephone keypad/.test(text)) return featureDetails('bluetooth-calls', 'Telephone keypad', 'Physical keys for supported telephone functions. Phone connection and compatibility depend on the system.');
  if (/instrument cluster/.test(text)) return featureDetails('display', /colour/.test(text) ? 'Colour instrument cluster' : 'Instrument cluster', 'Shows key driving information in front of the driver.');
  if (/colour display/.test(text)) return featureDetails('display', 'Colour display', 'A colour screen for supported information or media functions. Screen size and available functions depend on the equipment fitted.');
  if (/start stop|stop start/.test(text)) return featureDetails('stop-start', 'Stop-start system', 'Can switch the engine off when stationary and restart it when you move off, subject to operating conditions.');
  if (/spare wheel|space saver/.test(text)) return featureDetails('spare-wheel', 'Spare wheel', /space saver/.test(text) ? 'A temporary spare wheel for limited use. Follow the speed, distance and fitment restrictions in the car’s instructions.' : 'A replacement wheel for use following a puncture. Check the car’s instructions before fitting.');
  if (/locking wheel bolts?/.test(text)) return featureDetails('security', 'Locking wheel bolts', 'Wheel bolts with a matching key intended to deter wheel theft. Check that the key is supplied.');
  if (/alloy wheels?/.test(text)) return featureDetails('wheels', 'Alloy wheels', 'Wheels made from a metal alloy. A size such as 17 inches describes the wheel diameter.');
  if (/heated.*(?:washer|windscreen washer)/.test(text)) return featureDetails('heated-washers', 'Heated washer system', 'Heating helps reduce freezing in the windscreen-washer components.');
  if (/rain sensing|wipers?/.test(text)) return featureDetails('wipers', /rain sensing/.test(text) ? 'Rain-sensing wipers' : 'Windscreen wipers', /rain sensing/.test(text) ? 'Can activate or adjust windscreen wiping when rain is detected. Keep the sensor area clear.' : 'Clear rain and moisture from the windscreen to help you see.');
  if (/pollen filter/.test(text)) return featureDetails('filter', 'Cabin pollen filter', 'Helps filter pollen and other particles from air entering the cabin. Regular replacement helps maintain performance.');
  if (/vanity mirror/.test(text)) return featureDetails('lights', /illuminated/.test(text) ? 'Illuminated vanity mirrors' : 'Vanity mirrors', /illuminated/.test(text) ? 'Mirrors in the sun visors with built-in lighting.' : 'Small mirrors in the sun visors.');
  if (/mirror/.test(text) && /indicators?|led indicators?/.test(text)) return featureDetails('lights', 'Mirror indicators', 'Direction indicators integrated into the exterior mirrors, using the lighting type listed.');
  if (/mirror/.test(text)) {
    if (/dimming/.test(text)) return featureDetails('mirrors', /automatic/.test(text) ? 'Automatically dimming mirrors' : 'Dimming mirrors', /automatic/.test(text) ? 'Automatically reduces reflected glare from bright lights behind you.' : 'A dimming setting reduces glare from bright lights behind you.');
    if (/folding|heated|adjustable/.test(text)) {
      const functions = [ /electrically adjustable/.test(text) ? 'electrical adjustment' : /adjustable/.test(text) ? 'adjustment' : '', /folding/.test(text) ? 'folding' : '', /heated/.test(text) ? 'heating' : '' ].filter(Boolean);
      return featureDetails('mirrors', 'Door mirrors', `Mirror functions include ${functions.join(', ')}.`);
    }
    return featureDetails('mirrors', /package/.test(text) ? 'Mirror package' : 'Mirrors', /package/.test(text) ? 'A group of mirror features supplied together. Ask us which mirror functions this car has.' : 'Mirrors help you see behind and alongside the car.');
  }
  if (/electric windows?/.test(text)) return featureDetails('windows', 'Electric windows', `Powered window operation.${/one touch/.test(text) ? ' One-touch operation opens or closes a window with a single press.' : ''}${/obstruction/.test(text) ? ' Obstruction sensing can stop movement if something is detected in the way.' : ''}`);
  if (/exhaust/.test(text)) return featureDetails('exhaust', 'Exhaust styling', 'The shape and finish of the exhaust outlets at the rear of the car.');
  if (/ambient lighting/.test(text)) return featureDetails('lights', 'Ambient cabin lighting', 'Soft lighting around the cabin, with a dimmer to adjust its brightness where fitted.');
  if (/headlights?|tail lights?|daytime running lights?|brake light|reading lights?|interior lighting|vanity mirrors?/.test(text)) return featureDetails('lights', 'Vehicle lighting', 'Lighting for the area of the car described. LED lights use light-emitting diodes rather than conventional bulbs.');
  if (/glove compartment/.test(text)) return featureDetails('storage', 'Glove compartment', /air conditioned/.test(text) ? 'A glove compartment supplied with cooled air, with a lock where listed. Cooling depends on the cabin air-conditioning system.' : 'An enclosed storage compartment in the dashboard.');
  if (/armrest/.test(text)) return featureDetails('armrest', hasRear ? 'Rear armrest' : hasFront ? 'Front armrest' : 'Armrest', /storage|compartment/.test(text) ? 'An arm support with a built-in storage compartment.' : 'A support for your arm while seated.');
  if (/cup holder|bottle holder/.test(text)) return featureDetails('cup-holder', /bottle/.test(text) ? 'Bottle holder' : 'Cup holders', 'A holder for drinks. Use containers that fit securely.');
  if (/bag hooks?|door pockets?|map pockets?|boot release/.test(text)) return featureDetails('storage', /boot release/.test(text) ? 'Interior boot release' : 'Storage features', /boot release/.test(text) ? 'A switch inside the car to release the boot.' : 'Hooks or pockets for small items. Keep items secured and follow any load limits.');
  if (/head restraints?/.test(text)) return featureDetails('head-restraint', hasRear ? 'Rear head restraints' : hasFront ? 'Front head restraints' : 'Head restraints', 'Supports the head and helps reduce injury risk. Set the height and position as instructed in the car’s handbook.');
  if (/lumbar/.test(text)) return featureDetails('seat-adjustment', 'Lumbar support', 'Support for your lower back to help you find a comfortable seating position.');
  if (/seats?.*adjustment|seat adjustment/.test(text)) return featureDetails('seat-adjustment', 'Seat adjustment', /electrical height/.test(text) && hasFront ? 'Lets you adjust the height of the front seats electrically.' : 'Lets you adjust the seat position for a comfortable driving position.');
  if (/steering column/.test(text)) return featureDetails('steering', 'Adjustable steering column', 'Lets you adjust the steering-wheel position. Make adjustments while the car is stationary.');
  if (/steering wheel.*paddles?|gear shift paddles?/.test(text)) return featureDetails('steering', 'Gear-shift paddles', 'Steering-wheel controls for selecting gears when supported by the transmission’s operating mode.');
  if (/steering wheel/.test(text)) return featureDetails('steering', 'Steering wheel', /multi function/.test(text) ? 'Steering-wheel buttons operate supported car functions.' : 'The steering-wheel design and material fitted to this car.');
  if (/power steering/.test(text)) return featureDetails('steering', 'Power steering', /speed sensitive/.test(text) ? 'Steering assistance varies with vehicle speed to help balance low-speed manoeuvring and steering feel.' : 'Assistance reduces the effort needed to turn the steering wheel.');
  if (/suspension/.test(text)) return featureDetails('suspension', /comfort/.test(text) ? 'Comfort suspension' : 'Suspension', /comfort/.test(text) ? 'Suspension designed with ride comfort in mind.' : 'Supports the car and absorbs movement from the road to help keep the tyres in contact with the surface.');
  if (/alarm|immobiliser|central locking/.test(text)) return featureDetails('security', /central locking/.test(text) ? 'Central locking' : /alarm/.test(text) ? 'Alarm and security' : 'Immobiliser', /central locking/.test(text) ? 'Locks or unlocks the doors together. Remote controls and audible confirmation are included when specified.' : /alarm/.test(text) ? 'An alarm warns of detected intrusion. An immobiliser, where fitted, helps prevent unauthorised engine starting.' : 'Helps prevent the engine from starting without an authorised key.');
  if (/air condition/.test(text)) return featureDetails('air-conditioning', 'Air conditioning', 'Cools and helps dehumidify the cabin air.');
  if (/trim|door handles?|door sill panels?|radiator grille|rear apron|exterior colour/.test(text)) return featureDetails('exterior', 'Trim and finish', 'A styling or finish detail on the car. Photographs and lighting can affect how it looks on screen.');
  return undefined;
}

/** Kept for existing compact feature lists and accessible descriptions. */
export function vehicleFeatureHelp(feature: string): string | undefined {
  return vehicleFeatureDetails(feature)?.description;
}

const conciseFeatureLabels = new Set<VehicleFeatureIconKey>([
  'parking-front', 'parking-rear', 'parking', 'parking-assist',
  'cruise-control', 'adaptive-cruise-control', 'speed-limiter',
  'climate', 'heated-seats', 'bluetooth-calls', 'bluetooth-audio',
  'navigation', 'isofix', 'camera',
]);

/** Shorten recognised highlights only; keep detailed specifications and brand names intact. */
export function vehicleFeatureLabel(feature: string): string {
  const details = vehicleFeatureDetails(feature);
  if (details?.icon === 'bluetooth-calls' && !/bluetooth/i.test(feature)) return feature;
  return details && conciseFeatureLabels.has(details.icon) ? details.title : feature;
}
