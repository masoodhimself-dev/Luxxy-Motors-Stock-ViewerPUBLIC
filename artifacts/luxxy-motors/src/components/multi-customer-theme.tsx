import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { isMultiChoiceWebsite } from '@/lib/multi-home-scope';
import { multiCustomerThemeVariables } from '@/lib/multi-customer-theme';
import './multi-customer-theme.css';

/** One lifecycle owner carries the current customer palette into React portals. */
export function useCustomerBodyTheme(
  variables: CSSProperties,
  multiChoice: boolean,
  active = true,
) {
  useEffect(() => {
    if (!active) return;
    const entries = Object.entries(variables) as [string, string][];
    const previous = entries.map(([key]) => [key, document.body.style.getPropertyValue(key)] as const);
    const marker = document.body.getAttribute('data-multi-choice-customer');
    for (const [key, value] of entries) document.body.style.setProperty(key, value);
    if (multiChoice) document.body.setAttribute('data-multi-choice-customer', 'true');
    else document.body.removeAttribute('data-multi-choice-customer');
    return () => {
      for (const [key, value] of previous) {
        if (value) document.body.style.setProperty(key, value);
        else document.body.style.removeProperty(key);
      }
      if (marker === null) document.body.removeAttribute('data-multi-choice-customer');
      else document.body.setAttribute('data-multi-choice-customer', marker);
    };
  }, [variables, multiChoice, active]);
}

const standaloneVariables = multiCustomerThemeVariables() as CSSProperties;
/** Secure public documents keep their minimal shell and privacy boundaries. */
export function MultiCustomerDocumentTheme({ children }: { children: ReactNode }) {
  const multiChoice = isMultiChoiceWebsite();
  useCustomerBodyTheme(standaloneVariables, multiChoice, multiChoice);
  return multiChoice
    ? <div className="multi-choice-site multi-choice-standalone" style={standaloneVariables}>{children}</div>
    : <>{children}</>;
}
