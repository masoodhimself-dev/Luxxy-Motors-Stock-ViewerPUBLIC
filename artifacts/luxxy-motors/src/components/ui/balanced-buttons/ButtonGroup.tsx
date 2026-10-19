'use client';

import * as React from 'react';
export interface ButtonGroupProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Accessible name for a related group of actions. */
  label: string;
  /** Equal-height stacked actions with a consistent leading icon column. */
  vehicleActions?: boolean;
}
export function ButtonGroup({label,vehicleActions=false,className='',children,...props}:ButtonGroupProps) {
  return <div {...props} role="group" aria-label={label} className={`db-button-group${vehicleActions?' db-button-group--vehicle':''} ${className}`}>{children}</div>;
}
