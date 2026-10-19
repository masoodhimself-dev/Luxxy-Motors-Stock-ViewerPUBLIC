import type { ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatRegistrationPlate } from '@/lib/registration-display';
import './uk-number-plate.css';

export type UKNumberPlateProps = {
  value?: string | null;
  editable?: boolean;
  onChange?: (value: string) => void;
  testId?: string;
  inputTestId?: string;
  inputId?: string;
  helpId?: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'front' | 'rear';
  className?: string;
  /** Slot for the approved Union Flag/UK artwork; no placeholder flag is drawn. */
  identifier?: ReactNode;
};

export function UKNumberPlate({ value = '', editable = false, onChange, testId = 'uk-number-plate',
  inputTestId, inputId, helpId, size = 'md', variant = 'rear', className, identifier,
}: UKNumberPlateProps) {
  const displayValue = formatRegistrationPlate(value);
  if (!editable && !displayValue) return <span className={cn('registration-plate-empty', className)} data-testid={testId}>Registration not added</span>;
  return <span className={cn('registration-plate', className)} data-size={size} data-variant={variant}
    data-identifier={identifier ? 'true' : undefined} data-testid={testId}>
    {identifier && <span className="registration-plate-identifier" aria-hidden="true">{identifier}</span>}
    {editable ? <Input id={inputId} required minLength={2} maxLength={12} pattern="[A-Za-z0-9 ]{2,12}"
      value={value ?? ''} onChange={event => onChange?.(event.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, ''))}
      placeholder="AB12 CDE" autoCapitalize="characters" autoComplete="off" spellCheck={false}
      aria-label="Your car’s UK registration number" aria-describedby={helpId}
      className="uk-number-plate-input registration-plate-input"
      data-testid={inputTestId ?? `${testId}-input`} />
      : <span className="registration-plate-text" aria-label={`UK registration ${displayValue}`}>{displayValue}</span>}
  </span>;
}
