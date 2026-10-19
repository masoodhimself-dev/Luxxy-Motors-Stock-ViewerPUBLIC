'use client';

import * as React from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive';
export type ButtonSize = 'standard' | 'prominent' | 'compact';
export type ButtonStatus = 'idle' | 'loading' | 'success';
export interface ButtonVisualProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  fullWidth?: boolean;
}
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, ButtonVisualProps {
  status?: ButtonStatus;
  /** Reserved even while hidden when status is supplied (including idle). */
  loadingLabel?: string;
  successLabel?: string;
  /** Overrides the live announcement; do not repeat it in a second live region. */
  statusMessage?: string;
  /** Reserves the spinner slot before work starts, including text-only actions. */
  reserveStatusSpace?: boolean;
}
export function buttonClass(variant: ButtonVariant = 'secondary', size: ButtonSize = 'standard', fullWidth = false, className = '') {
  return `db-btn db-btn--${variant} db-btn--${size}${fullWidth ? ' db-btn--full' : ''} ${className}`.trim();
}
export function IconSlot({ children }: { children: React.ReactNode }) {
  // The wrapper hides decorative content. SVG icon components should forward these props.
  const icon = React.isValidElement<React.SVGProps<SVGSVGElement>>(children)
    ? React.cloneElement(children, { 'aria-hidden': true, focusable: 'false', tabIndex: -1 })
    : children;
  return <span className="db-icon" aria-hidden="true">{icon}</span>;
}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button({
  variant = 'secondary', size = 'standard', leadingIcon, trailingIcon, fullWidth,
  status: suppliedStatus, loadingLabel = 'Working…', successLabel = 'Complete', statusMessage,
  reserveStatusSpace = false, children, className, disabled = false, type = 'button',
  onClick, 'aria-disabled': ariaDisabled, ...native
}, ref) {
  const status = suppliedStatus ?? 'idle';
  const reserveLabels = suppliedStatus !== undefined || reserveStatusSpace;
  const busy = status === 'loading';
  const blocked = disabled || busy || ariaDisabled === true || ariaDisabled === 'true';
  const [announcement, setAnnouncement] = React.useState('');
  React.useEffect(() => {
    setAnnouncement(status === 'idle' ? '' : statusMessage ?? (busy ? loadingLabel : successLabel));
  }, [status, busy, loadingLabel, successLabel, statusMessage]);
  const iconSpace = leadingIcon != null || reserveStatusSpace;
  return <>
    <button {...native} ref={ref} type={type} disabled={disabled}
      className={buttonClass(variant, size, fullWidth, className)} data-state={status}
      aria-disabled={blocked || undefined} aria-busy={busy || undefined}
      onClick={event => {
        if (blocked) { event.preventDefault(); event.stopPropagation(); return; }
        onClick?.(event);
      }}>
      {iconSpace && <span className="db-icon-stack" aria-hidden="true">
        <span className="db-idle-icon"><IconSlot>{leadingIcon}</IconSlot></span>
        <span className="db-spinner" />
      </span>}
      <span className="db-labels">
        <span className="db-label-idle" aria-hidden={status !== 'idle'}>{children}</span>
        <span className="db-label-loading" aria-hidden={!busy} style={reserveLabels ? undefined : {display: 'none'}}>{loadingLabel}</span>
        <span className="db-label-success" aria-hidden={status !== 'success'} style={reserveLabels ? undefined : {display: 'none'}}>{successLabel}</span>
      </span>
      {trailingIcon != null && <IconSlot>{trailingIcon}</IconSlot>}
    </button>
    <span className="db-sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
  </>;
});

export interface ButtonLinkProps extends React.AnchorHTMLAttributes<HTMLAnchorElement>, ButtonVisualProps {
  href: string;
  disabled?: boolean;
}
export const ButtonLink = React.forwardRef<HTMLAnchorElement, ButtonLinkProps>(function ButtonLink({
  variant = 'secondary', size = 'standard', leadingIcon, trailingIcon, fullWidth,
  children, className, disabled = false, href, onClick, tabIndex, target, rel, ...native
}, ref) {
  return <a {...native} ref={ref} href={disabled ? undefined : href} target={target}
    rel={rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined)}
    role={disabled ? 'link' : native.role} aria-disabled={disabled || undefined}
    tabIndex={disabled ? -1 : tabIndex} className={buttonClass(variant, size, fullWidth, className)}
    onClick={event => {
      if (disabled) { event.preventDefault(); event.stopPropagation(); return; }
      onClick?.(event);
    }}>
    {leadingIcon != null && <IconSlot>{leadingIcon}</IconSlot>}
    <span className="db-labels"><span className="db-label-idle">{children}</span></span>
    {trailingIcon != null && <IconSlot>{trailingIcon}</IconSlot>}
  </a>;
});

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'leadingIcon' | 'trailingIcon' | 'aria-label' | 'reserveStatusSpace'> {
  label: string;
  icon: React.ReactNode;
}
export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({
  label, icon, className = '', ...props
}, ref) {
  return <Button {...props} ref={ref} aria-label={label} leadingIcon={icon}
    reserveStatusSpace className={`db-btn--icon ${className}`}><span className="db-sr-only">{label}</span></Button>;
});

export interface ToggleButtonProps extends Omit<ButtonProps, 'onClick' | 'aria-pressed' | 'status'> {
  pressed: boolean;
  onPressedChange: (pressed: boolean, event: React.MouseEvent<HTMLButtonElement>) => void;
}
export const ToggleButton = React.forwardRef<HTMLButtonElement, ToggleButtonProps>(function ToggleButton({
  pressed, onPressedChange, className = '', ...props
}, ref) {
  // Keep the action label stable; aria-pressed communicates selection.
  return <Button {...props} ref={ref} className={`db-toggle ${className}`} aria-pressed={pressed}
    onClick={event => onPressedChange(!pressed, event)} />;
});
