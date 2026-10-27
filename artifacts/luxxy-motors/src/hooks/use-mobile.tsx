import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

/** Match the breakpoint of the layout using this hook; other callers retain 768px. */
export function useIsMobile(breakpoint = MOBILE_BREAKPOINT) {
  const [isMobile, setIsMobile] = React.useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(`(max-width: ${breakpoint - 1}px)`).matches
      : false,
  );

  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => {
      setIsMobile(mql.matches);
    };
    onChange();
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // Older Safari versions expose the legacy MediaQueryList listener API.
    mql.addListener?.(onChange);
    return () => mql.removeListener?.(onChange);
  }, [breakpoint]);

  return isMobile;
}
