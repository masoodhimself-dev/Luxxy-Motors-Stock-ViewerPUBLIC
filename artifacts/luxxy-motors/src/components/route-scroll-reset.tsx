import { requestBrowseRestore } from "@/lib/browse-session";
import { useLayoutEffect, useRef } from "react";
import { useLocation } from 'wouter';

export function RouteScrollReset() {
  const [location] = useLocation();

  const previous = useRef(location);
  useLayoutEffect(() => {
    if (location === "/" && previous.current !== "/") requestBrowseRestore();
    previous.current = location;
    window.history.scrollRestoration = 'manual';
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [location]);

  return null;
}
