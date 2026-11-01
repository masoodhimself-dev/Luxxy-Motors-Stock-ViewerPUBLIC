import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { isMultiChoiceWebsite } from '@/lib/multi-home-scope';
import { multiCustomerThemeVariables } from '@/lib/multi-customer-theme';
import './multi-customer-theme.css';

/** Route-owned tokens also reach dialogs rendered directly under document.body. */
function useScopedBodyTheme(
  variables: CSSProperties,
  multiChoice: boolean,
  active: boolean,
  attribute: 'data-multi-choice-customer' | 'data-multi-choice-portal',
) {
  useEffect(() => {
    if (!active) return;
    const entries = Object.entries(variables) as [string, string][];
    const previous = entries.map(([key]) => [key, document.body.style.getPropertyValue(key)] as const);
    const marker = document.body.getAttribute(attribute);
    for (const [key, value] of entries) document.body.style.setProperty(key, value);
    if (multiChoice) document.body.setAttribute(attribute, 'true');
    else document.body.removeAttribute(attribute);
    return () => {
      for (const [key, value] of previous) {
        if (value) document.body.style.setProperty(key, value);
        else document.body.style.removeProperty(key);
      }
      if (marker === null) document.body.removeAttribute(attribute);
      else document.body.setAttribute(attribute, marker);
    };
  }, [variables, multiChoice, active, attribute]);
}

export function useCustomerBodyTheme(variables: CSSProperties, multiChoice: boolean, active = true) {
  useScopedBodyTheme(variables, multiChoice, active, 'data-multi-choice-customer');
}

export function usePortalBodyTheme(variables: CSSProperties, active: boolean) {
  useScopedBodyTheme(variables, active, active, 'data-multi-choice-portal');
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
