import { Link } from 'wouter';
import { Heart } from '@/components/icons';
import { Car } from '@/lib/stock-context';
import { useSavedCars } from '@/lib/saved-cars-context';
import { useToast } from '@/hooks/use-toast';
import { cn, vehicleDisplayTitle } from '@/lib/utils';
import { HoverHelp } from '@/components/customer-help';

export function vehicleLabelFor(car: Car) {
  return vehicleDisplayTitle(car);
}

export function SaveCarButton({
  car,
  variant = 'overlay',
  className,
}: {
  car: Car;
  variant?: 'overlay' | 'inline';
  className?: string;
}) {
  const { isSaved, toggleSaved } = useSavedCars();
  const saved = isSaved(car.id);
  const { toast } = useToast();
  const label = vehicleLabelFor(car);

  return (
    <HoverHelp text={saved ? 'Remove this car from your saved list.' : 'Keep this car in Saved so you can return to it later on this browser.'}>
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        toggleSaved(car.id, car);
        if (!saved) toast({title: 'Car saved', description: <Link href="/saved" className="underline underline-offset-4">View saved cars</Link>, duration: 5000});
      }}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${label} from your saved cars` : `Save ${label} to your saved cars`}
      data-testid={`button-save-${car.id}`}
      className={cn(
        'inline-flex items-center justify-center gap-2 border transition-colors  focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
        variant === 'overlay'
          ? 'photo-glass-control'
          : 'h-11 px-4 text-[13px] font-bold',
        variant === 'inline' &&
          (saved
            ? 'border-accent bg-accent/12 text-primary'
            : 'border-border bg-background text-foreground hover:border-primary/45 hover:bg-secondary'),
        className,
      )}
    >
      <Heart className={cn('h-4 w-4', saved ? 'fill-current' : variant === 'inline' ? 'text-accent' : '')} />
      {variant === 'inline' && (saved ? 'Saved' : 'Save')}
    </button>
    </HoverHelp>
  );
}
