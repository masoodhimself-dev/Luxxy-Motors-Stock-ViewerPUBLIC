import {
  Armchair,
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
  MapPin,
  Palette,
  RegistrationPlate,
  RoadTax,
  ServiceBook,
  Shield,
  Sprout,
  Transmission,
  UsersRound,
  VehicleHistory,
} from '@/components/icons';

/** Icons supplement readable labels; they never replace a vehicle fact. */
export function VehicleFactIcon({ label, className = 'h-4 w-4 shrink-0 text-muted-foreground' }: { label: string; className?: string }) {
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
    : /gear|transmission|drivetrain/.test(value) ? Transmission
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
  return <Icon className={className} aria-hidden="true" />;
}
