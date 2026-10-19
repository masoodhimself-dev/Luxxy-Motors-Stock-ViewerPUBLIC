import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { formatRegistrationPlate } from '@/lib/registration-display';
import { RegistrationPlate } from './registration-plate/src/RegistrationPlate';
import { UnionFlag } from './registration-plate/src/UnionFlag';
import { registrationFit } from './registration-plate/src/registration';
import type { CSSProperties } from 'react';
import './registration-plate/styles/registration-plate.css';
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
  showFlag?: boolean;
  inputLabel?: string;
  required?: boolean;
  disabled?: boolean;
};
const sizes = {sm:'small',md:'medium',lg:'large'} as const;

/** Existing input contract and host formatter around the approved presentation. */
export function UKNumberPlate({ value = '', editable = false, onChange, testId = 'uk-number-plate',
  inputTestId, inputId, helpId, size = 'md', variant = 'rear', className, showFlag = true, inputLabel = "Your car’s UK registration number", required = true, disabled = false,
}: UKNumberPlateProps) {
  if (!editable) return <span className={cn('registration-plate-container',className)} data-testid={testId} data-size={size} data-variant={variant}>
    <RegistrationPlate registration={value} formatter={formatRegistrationPlate} size={sizes[size]} variant={variant}
      showFlag={showFlag} className="registration-plate" />
  </span>;
  return <span className={cn('registration-plate ukrp-plate registration-plate-editable', `ukrp-plate--${sizes[size]} ukrp-plate--${variant}`,className)}
    data-flag={showFlag} data-size={size} data-variant={variant} data-testid={testId}
    style={{'--ukrp-fit':registrationFit(value || 'AB12 CDE')} as CSSProperties}>
    {showFlag && <span className="ukrp-country" aria-hidden="true"><UnionFlag /><span>UK</span></span>}
    <span className="ukrp-lettering"><Input id={inputId} required={required} disabled={disabled} minLength={required ? 2 : undefined} maxLength={12} pattern="[A-Za-z0-9 ]{2,12}"
      value={value ?? ''} onChange={event => onChange?.(event.target.value.toUpperCase().replace(/[^A-Z0-9 ]/g, ''))}
      placeholder="AB12 CDE" autoCapitalize="characters" autoComplete="off" spellCheck={false}
      aria-label={inputLabel} aria-describedby={helpId}
      className="uk-number-plate-input registration-plate-input ukrp-text"
      data-testid={inputTestId ?? `${testId}-input`} /></span>
  </span>;
}
