import { useEffect, type CSSProperties, type ReactNode } from 'react';
import { multiCustomerThemeVariables } from '@/lib/multi-customer-theme';
import './multi-customer-theme.css';

/** Route-owned tokens also reach dialogs rendered directly under document.body. */
function useScopedBodyTheme(
  variables: CSSProperties,
  active: boolean,
  attribute: 'data-dealer-customer' | 'data-dealer-portal',
) {
  useEffect(() => {
    if (!active) return;
    const entries = Object.entries(variables) as [string, string][];
    const previous = entries.map(([key]) => [key, document.body.style.getPropertyValue(key)] as const);
    const marker = document.body.getAttribute(attribute);
    for (const [key, value] of entries) document.body.style.setProperty(key, value);
    document.body.setAttribute(attribute, 'true');
    return () => {
      for (const [key, value] of previous) {
        if (value) document.body.style.setProperty(key, value);
        else document.body.style.removeProperty(key);
      }
      if (marker === null) document.body.removeAttribute(attribute);
      else document.body.setAttribute(attribute, marker);
    };
  }, [variables, active, attribute]);
}

export function useCustomerBodyTheme(variables: CSSProperties, active = true) {
  useScopedBodyTheme(variables, active, 'data-dealer-customer');
}

export function usePortalBodyTheme(variables: CSSProperties, active: boolean) {
  useScopedBodyTheme(variables, active, 'data-dealer-portal');
}

const standaloneVariables = multiCustomerThemeVariables() as CSSProperties;
/** Secure public documents keep their minimal shell and privacy boundaries. */
export function CustomerDocumentTheme({ children }: { children: ReactNode }) {
  useCustomerBodyTheme(standaloneVariables);
  return <div className="dealer-site-theme dealer-document-theme" style={standaloneVariables}>{children}</div>;
}
