import {
  Armchair,
  AutomaticTransmission,
  BadgePoundSterling,
  BodyType,
  CalendarDays,
  CarFront,
  CircleCheck,
  CircleGauge,
  DoorOpen,
  Engine,
  Fuel,
  Insurance,
  KeyRound,
  ManualTransmission,
  MapPin,
  Palette,
  RegistrationPlate,
  RoadTax,
  ServiceBook,
  Shield,
  Sprout,
  UsersRound,
  VehicleHistory,
} from '@/components/icons';

function recordedTransmissionIcon(value?: string | null) {
  const detail = value?.trim().toLowerCase();
  if (!detail || /\?|\b(?:unknown|unspecified|unconfirmed|tbc|tba|not|or|automated|clutchless)\b/.test(detail)) return null;
  const manual = /\bmanual\b/.test(detail);
  const automatic = /\b(?:auto(?:matic)?|dsg|dct|(?:e[-\s]?)?cvt|s[\s-]?tronic|tiptronic|steptronic|multitronic|powershift)\b/.test(detail);
  // Do not turn missing or contradictory source data into a manual gearbox.
  if (manual === automatic) return null;
  return manual ? ManualTransmission : AutomaticTransmission;
}

/** Icons supplement readable labels; they never replace a vehicle fact. */
export function VehicleFactIcon({ label, value: recordedValue, className = 'h-4 w-4 shrink-0 text-muted-foreground' }: { label: string; value?: string | null; className?: string }) {
  const value = label.toLowerCase();
  // Specific facts come before broad matches such as history, cost and vehicle.
  const Icon = /owner|keeper/.test(value) ? UsersRound
    : /key/.test(value) ? KeyRound
    : /service/.test(value) ? ServiceBook
    : /history|record/.test(value) ? VehicleHistory
    : /insurance/.test(value) ? Insurance
    : /warranty/.test(value) ? Shield
    : /tax/.test(value) ? RoadTax
    : /price|cost/.test(value) ? BadgePoundSterling
    : /mileage|mile|speed/.test(value) ? CircleGauge
    : /fuel|mpg|urban|average/.test(value) ? Fuel
    : /engine/.test(value) ? Engine
    : /gear|transmission|drivetrain/.test(value) ? recordedTransmissionIcon(recordedValue)
    : /year|date|mot|registration band/.test(value) ? CalendarDays
    : /registration|number plate|plate/.test(value) ? RegistrationPlate
    : /seat/.test(value) ? Armchair
    : /door/.test(value) ? DoorOpen
    : /colour|color/.test(value) ? Palette
    : /ulez|emission|co₂|co2/.test(value) ? Sprout
    : /location/.test(value) ? MapPin
    : /body/.test(value) ? BodyType
    : /vehicle/.test(value) ? CarFront
    : CircleCheck;
  return Icon ? <Icon className={className} aria-hidden="true" /> : null;
}
