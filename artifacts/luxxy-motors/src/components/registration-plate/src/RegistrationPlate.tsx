import { forwardRef, type CSSProperties, type HTMLAttributes } from 'react';
import { UnionFlag } from './UnionFlag.js';
import { registrationFit, resolveRegistration, type RegistrationFormatter } from './registration.js';

export type RegistrationPlateSize = 'small' | 'medium' | 'large';
export type RegistrationPlateVariant = 'front' | 'rear';

export interface RegistrationPlateProps extends Omit<
  HTMLAttributes<HTMLSpanElement>,
  'children' | 'dangerouslySetInnerHTML' | 'role' | 'aria-label' | 'aria-labelledby' | 'aria-hidden' | 'dir'
> {
  registration?: string | null;
  /** Existing host formatter. Receives the unmodified input; output is preserved. */
  formatter?: RegistrationFormatter;
  variant?: RegistrationPlateVariant;
  size?: RegistrationPlateSize;
  /** False uses the narrower, flag-free face at the same lettering size. */
  showFlag?: boolean;
}

/** Selectable, accessible registration text. No lookup, storage or format mask. */
export const RegistrationPlate = forwardRef<HTMLSpanElement, RegistrationPlateProps>(
  function RegistrationPlate(
    { registration, formatter, variant = 'front', size = 'medium', showFlag = true,
      className = '', style, ...spanProps },
    ref,
  ) {
    const value = resolveRegistration(registration, formatter);
    if (value === null) {
      return (
        <span {...spanProps} ref={ref} className={`ukrp-missing ${className}`.trim()} style={style}>
          Registration not added
        </span>
      );
    }

    const plateStyle = { ...style, '--ukrp-fit': registrationFit(value) } as CSSProperties;
    return (
      <span
        {...spanProps}
        ref={ref}
        className={`ukrp-plate ukrp-plate--${size} ukrp-plate--${variant} ${className}`.trim()}
        style={plateStyle}
        dir="ltr"
        role="group"
        aria-label={`Registration ${value}`}
        data-registration={value}
        data-flag={showFlag}
      >
        {showFlag && (
          <span className="ukrp-country" aria-hidden="true">
            <UnionFlag />
            <span>UK</span>
          </span>
        )}
        <span className="ukrp-lettering" aria-hidden="true">
          <span className="ukrp-text">{value}</span>
        </span>
      </span>
    );
  },
);
