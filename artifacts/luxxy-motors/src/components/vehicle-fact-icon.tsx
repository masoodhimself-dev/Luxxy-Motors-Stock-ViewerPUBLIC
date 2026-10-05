import { CalendarDays, Gauge, Fuel, Settings2, CarFront, Users, KeyRound, BookOpen, BadgePoundSterling, Leaf, ShieldCheck, Palette, DoorOpen, Armchair, CircleCheck, MapPin } from 'lucide-react';

/** Icons supplement readable labels; they never replace a vehicle fact. */
export function VehicleFactIcon({ label, className = 'h-4 w-4 shrink-0 text-muted-foreground' }: { label: string; className?: string }) {
 const value = label.toLowerCase();
 const Icon = /owner|keeper/.test(value) ? Users : /key/.test(value) ? KeyRound : /service|record/.test(value) ? BookOpen : /tax|price|cost/.test(value) ? BadgePoundSterling : /mileage|mile|speed/.test(value) ? Gauge : /fuel|mpg|urban|average/.test(value) ? Fuel : /gear|transmission|engine|drivetrain/.test(value) ? Settings2 : /year|date|mot/.test(value) ? CalendarDays : /seat/.test(value) ? Armchair : /door/.test(value) ? DoorOpen : /colour/.test(value) ? Palette : /emission|co₂|co2/.test(value) ? Leaf : /history|warranty|insurance/.test(value) ? ShieldCheck : /location/.test(value) ? MapPin : /body|vehicle/.test(value) ? CarFront : CircleCheck;
 return <Icon className={className} strokeWidth={1.7} aria-hidden="true" />;
}
