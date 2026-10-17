import { requestBrowseRestore } from "@/lib/browse-session";
import { useLayoutEffect, useRef } from "react";
import { useLocation } from 'wouter';

export function RouteScrollReset() {
  const [location] = useLocation();

  const previous = useRef(location);
  useLayoutEffect(() => {
    if (location === "/stock" && previous.current.startsWith("/vehicle/")) requestBrowseRestore();
    previous.current = location;
    window.history.scrollRestoration = 'manual';
    // `auto` inherits html's smooth anchor scrolling and would sweep through
    // the previous page's position when opening a vehicle from deep in stock.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location]);

  return null;
}
