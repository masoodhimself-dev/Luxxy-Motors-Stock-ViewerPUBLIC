import { Check, Heart, Scale } from 'lucide-react';
import { Car } from '@/lib/stock-context';
import { MAX_COMPARE, useSavedCars } from '@/lib/saved-cars-context';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { trackEvent } from '@/lib/analytics';

export function vehicleLabelFor(car: Car) {
  return car.title || `${car.make || ''} ${car.model || ''}`.trim() || 'this vehicle';
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
  const label = vehicleLabelFor(car);

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        toggleSaved(car.id);
      }}
      aria-pressed={saved}
      aria-label={saved ? `Remove ${label} from your saved cars` : `Save ${label} to your saved cars`}
      title={saved ? 'Saved — click to remove' : 'Save this car'}
      data-testid={`button-save-${car.id}`}
      className={cn(
        'inline-flex items-center justify-center gap-2 border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2',
        variant === 'overlay'
          ? 'h-9 w-9 border-border/60 bg-background/90 backdrop-blur-sm hover:border-primary/50'
          : 'h-11 px-4 text-[13px] font-bold',
        variant === 'inline' &&
          (saved
            ? 'border-accent bg-accent/12 text-primary'
            : 'border-border bg-background text-foreground hover:border-primary/45 hover:bg-secondary'),
        variant === 'overlay' && saved && 'border-accent bg-accent text-accent-foreground',
        className,
      )}
    >
      <Heart className={cn('h-4 w-4', saved ? 'fill-current' : 'text-accent')} />
      {variant === 'inline' && (saved ? 'Saved' : 'Save')}
    </button>
  );
}

export function CompareCarButton({ car, className, variant = 'default' }: { car: Car; className?: string; variant?: 'default' | 'compact' }) {
  const { isComparing, toggleCompare } = useSavedCars();
  const { toast } = useToast();
  const comparing = isComparing(car.id);
  const label = vehicleLabelFor(car);

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
        description: 'Remove one from the compare bar to add this car instead.',
      });
    }
  };

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={handleClick}
        aria-pressed={comparing}
        aria-label={comparing ? `Remove ${label} from your comparison` : `Add ${label} to your comparison`}
        data-testid={`button-compare-${car.id}`}
        className={cn(
          'inline-flex w-fit max-w-full shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-[11px] font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          comparing ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
          className
        )}
      >
        {comparing ? <Check className="h-3.5 w-3.5" /> : <Scale className="h-3.5 w-3.5" />}
        <span>{comparing ? 'Comparing' : 'Compare'}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={comparing}
      aria-label={comparing ? `Remove ${label} from your comparison` : `Add ${label} to your comparison`}
      data-testid={`button-compare-${car.id}`}
      className={cn(
        'inline-flex h-11 w-fit max-w-full shrink-0 items-center justify-center gap-2 whitespace-nowrap border px-4 text-[13px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
        comparing
          ? 'border-primary bg-primary/10 text-primary'
          : 'border-border bg-background text-foreground hover:border-primary/45 hover:bg-secondary',
        className,
      )}
    >
      {comparing ? <Check className="h-4 w-4 text-primary" /> : <Scale className="h-4 w-4 text-accent" />}
      <span>{comparing ? 'Comparing' : 'Compare'}</span>
    </button>
  );
}
