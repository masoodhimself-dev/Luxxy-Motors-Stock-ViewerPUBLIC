import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export function UKNumberPlate({
  value,
  editable = false,
  onChange,
  testId,
  inputTestId,
  helpId,
  size = 'md',
  variant = 'rear',
  className,
}: {
  value: string;
  editable?: boolean;
  onChange?: (value: string) => void;
  testId: string;
  inputTestId?: string;
  helpId?: string;
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
        small
          ? 'min-h-[28px]'
          : 'min-h-[56px]',
        className,
      )}
      data-testid={testId}
    >
      {editable ? (
        <Input
          required
          minLength={2}
          maxLength={12}
          pattern="[A-Za-z0-9 ]{2,12}"
          value={value}
          onChange={(event) => onChange?.(event.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, ''))}
          placeholder="AB12 CDE"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          aria-label="Your car’s UK registration number"
          aria-describedby={helpId}
          className="h-full min-h-[56px] border-0 bg-transparent px-4 text-center font-sans text-xl font-black uppercase tracking-[0.12em] text-[hsl(var(--primary))] placeholder:font-bold placeholder:text-[hsl(var(--primary))]/40 focus-visible:ring-0 sm:text-2xl"
          data-testid={inputTestId ?? `${testId}-input`}
        />
      ) : (
        <span
          className={cn(
            'flex h-full w-full items-center justify-center truncate px-2 text-center font-sans font-black uppercase leading-none text-[hsl(var(--primary))]',
            small
              ? 'min-h-[28px] text-[12px] tracking-[0.1em]'
              : 'min-h-[56px] text-xl tracking-[0.12em] sm:text-2xl',
          )}
          aria-label={`UK registration ${displayValue}`}
        >
          {displayValue}
        </span>
      )}
    </div>
  );
}
