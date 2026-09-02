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
  className,
}: {
  value: string;
  editable?: boolean;
  onChange?: (value: string) => void;
  testId: string;
  inputTestId?: string;
  helpId?: string;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const registration = value.trim().toUpperCase();
  const displayValue = registration || 'REG NOT AVAILABLE';
  const small = size === 'sm';

  return (
    <div
      className={cn(
        'relative aspect-[4.7/1] overflow-hidden border-2 border-[#171717] bg-[#f5cc38]',
        small
          ? 'min-h-[30px] rounded-[0.3rem] shadow-[inset_0_0_0_1px_rgba(255,255,255,.28),0_2px_0_#b3941e]'
          : 'min-h-[58px] rounded-[0.45rem] shadow-[inset_0_0_0_1px_rgba(255,255,255,.28),0_3px_0_#b3941e,0_6px_12px_rgba(27,27,27,.14)]',
        className,
      )}
      data-testid={testId}
    >
      <div
        className={cn(
          'pointer-events-none absolute inset-y-0 left-0 flex flex-col items-center justify-center bg-[#164f92] text-white',
          small ? 'w-[12%] min-w-[16px]' : 'w-[11%] min-w-9',
        )}
      >
        <span className={cn('font-black leading-none tracking-[0.08em]', small ? 'text-[6px]' : 'text-[8px]')}>GB</span>
        <span className={cn('leading-none text-[#f5cc38]', small ? 'mt-[2px] text-[5px]' : 'mt-1 text-[7px]')}>✦</span>
      </div>
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
          className="h-full min-h-[58px] border-0 bg-transparent pl-[14%] font-mono text-xl font-black tracking-[0.16em] text-[#151515] placeholder:text-[#625414]/60 focus-visible:ring-0 sm:text-2xl"
          data-testid={inputTestId ?? `${testId}-input`}
        />
      ) : (
        <span
          className={cn(
            'flex h-full items-center truncate font-mono font-black text-[#151515]',
            small
              ? 'min-h-[30px] pl-[16%] pr-2 text-[12px] tracking-[0.1em]'
              : 'min-h-[58px] pl-[14%] pr-3 text-xl tracking-[0.16em] sm:text-2xl',
          )}
          aria-label={`UK registration ${displayValue}`}
        >
          {displayValue}
        </span>
      )}
    </div>
  );
}
