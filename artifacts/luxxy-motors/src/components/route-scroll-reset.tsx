import { isVehiclePagePath } from '@workspace/vehicle-meta';
import { requestBrowseRestore } from "@/lib/browse-session";
import { useLayoutEffect, useRef } from "react";
import { useLocation, useSearch } from 'wouter';

export function RouteScrollReset() {
  const [location] = useLocation();

  const search = useSearch();
  const previous = useRef<{ path: string; fromStock: boolean } | undefined>(undefined);
  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = { path: location, fromStock: new URLSearchParams(search).get('from') === 'stock' };
    if (last?.path === location) return;
    if (location === "/stock" && last?.fromStock && isVehiclePagePath(last.path)) requestBrowseRestore();
    window.history.scrollRestoration = 'manual';
    // `auto` inherits html's smooth anchor scrolling and would sweep through
    // the previous page's position when opening a vehicle from deep in stock.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, [location, search]);

  return null;
}
