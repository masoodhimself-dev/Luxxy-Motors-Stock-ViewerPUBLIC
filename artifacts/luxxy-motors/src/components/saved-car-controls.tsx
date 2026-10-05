import { Link } from 'wouter';
import { useDealerSettings } from '@/lib/dealer-settings-context';
import { Check, Heart, Scale } from 'lucide-react';
import { Car } from '@/lib/stock-context';
import { MAX_COMPARE, useSavedCars } from '@/lib/saved-cars-context';
import { useToast } from '@/hooks/use-toast';
import { cn, vehicleDisplayTitle } from '@/lib/utils';
import { trackEvent } from '@/lib/analytics';
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

export function CompareCarButton({ car, className, variant = 'default' }: { car: Car; className?: string; variant?: 'default' | 'compact' }) {
  const { settings } = useDealerSettings();
  const { isComparing, toggleCompare } = useSavedCars();
  const { toast } = useToast();
  const comparing = isComparing(car.id);
  const label = vehicleLabelFor(car);
  const helpText = comparing
    ? 'Remove this car from your comparison.'
    : `Choose up to ${MAX_COMPARE} cars to compare their prices and details side by side.`;

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    const result = toggleCompare(car.id);
    trackEvent('comparison_changed', {
      action: result === 'full' ? 'limit_reached' : comparing ? 'removed' : 'added',
      source: variant === 'compact' ? 'compact_card' : 'vehicle_card',
    });
    if (result === 'full') {
      toast({
        title: `You can compare ${MAX_COMPARE} cars at a time`,
        description: 'Open Compare selected cars and remove one to add this car instead.',
      });
    }
  };

  if (!settings.presentation?.comparisonEnabled) return null;

  if (variant === 'compact') {
    return (
      <HoverHelp text={helpText}>
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={comparing}
        aria-label={comparing ? `Remove ${label} from your comparison` : `Add ${label} to your comparison`}
        data-testid={`button-compare-${car.id}`}
        className={cn(
          'inline-flex min-h-11 w-fit max-w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-[11px] font-bold  tracking-normal transition-colors  focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          comparing ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          className
        )}
      >
        {comparing ? <Check className="h-3.5 w-3.5" /> : <Scale className="h-3.5 w-3.5" />}
        <span>{comparing ? 'Comparing' : 'Compare'}</span>
      </button>
      </HoverHelp>
    );
  }

  return (
    <HoverHelp text={helpText}>
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={comparing}
      aria-label={comparing ? `Remove ${label} from your comparison` : `Add ${label} to your comparison`}
      data-testid={`button-compare-${car.id}`}
      className={cn(
        'inline-flex h-11 w-fit max-w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap border px-4 text-[13px] font-bold transition-colors  focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        comparing
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-background text-foreground hover:border-primary/45 hover:bg-secondary',
        className,
      )}
    >
      {comparing ? <Check className="h-4 w-4 text-primary" /> : <Scale className="h-4 w-4 text-accent" />}
      <span>{comparing ? 'Comparing' : 'Compare'}</span>
    </button>
    </HoverHelp>
  );
}

export function CompareSelectionLink() {
  const { settings } = useDealerSettings();
  const { compareCount } = useSavedCars();
  if (!settings.presentation?.comparisonEnabled || !compareCount) return null;
  return <Link href="/compare" className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold underline underline-offset-4"><Scale className="h-4 w-4" aria-hidden="true" />Compare selected cars ({compareCount}/2)</Link>;
}
