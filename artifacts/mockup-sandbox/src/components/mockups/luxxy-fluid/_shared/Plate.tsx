import { cn } from '../_data';

export function Plate({
  value,
  testId,
  size = 'md',
  variant = 'rear',
  className,
}: {
  value: string;
  testId: string;
  size?: 'sm' | 'md';
  variant?: 'front' | 'rear';
  className?: string;
}) {
  const registration = value.trim().toUpperCase();
  const compactRegistration = registration.replace(/\s+/g, '');
  const displayValue =
    compactRegistration.length === 7
      ? `${compactRegistration.slice(0, 4)} ${compactRegistration.slice(4)}`
      : registration.replace(/\s+/g, ' ') || 'REG NOT AVAILABLE';
  const small = size === 'sm';

  return (
    <div
      className={cn(
        'relative flex aspect-[4.68/1] items-center justify-center overflow-hidden rounded-[2px] border-2 border-[hsl(var(--primary))]',
        variant === 'front' ? 'bg-[#f7f7f4]' : 'bg-[#f5cf32]',
        small ? 'min-h-[28px]' : 'min-h-[56px]',
        className,
      )}
      data-testid={testId}
    >
      <span
        className={cn(
          'flex h-full w-full items-center justify-center truncate px-2 text-center font-sans font-black uppercase leading-none text-[hsl(var(--primary))]',
          small ? 'min-h-[28px] text-[12px] tracking-[0.1em]' : 'min-h-[56px] text-xl tracking-[0.12em] sm:text-2xl',
        )}
        aria-label={`UK registration ${displayValue}`}
      >
        {displayValue}
      </span>
    </div>
  );
}