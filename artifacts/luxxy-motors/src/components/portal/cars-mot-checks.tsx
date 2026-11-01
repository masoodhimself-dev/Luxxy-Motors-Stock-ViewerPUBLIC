import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { StaffMotCheckStatus } from "@workspace/vehicle-meta";
import { Button } from "@/components/ui/button";
import { staffCarsKey } from "./staff-cars-query";

export const carsMotChecksKey = ["staff-cars-mot-checks"];
const endpoint = "/api/staff/vehicles/mot-checks";

export function motChecksAreActive(data?: StaffMotCheckStatus) {
  return Boolean(data && (data.run?.status === "queued" || data.run?.status === "running" || data.current.pending > 0));
}

/** Status reads never call DVSA; the server worker handles automatic and requested checks. */
export function useCarsMotChecks(canManage: boolean) {
  const client = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState(false);
  const inFlight = useRef(false);
  const startRequest = useRef<AbortController | null>(null);
  useEffect(() => () => startRequest.current?.abort(), [canManage]);
  const query = useQuery({
    queryKey: carsMotChecksKey,
    queryFn: ({ signal }) => customFetch<StaffMotCheckStatus>(endpoint, { signal }),
    enabled: canManage,
    staleTime: 10_000,
    retry: false,
    refetchInterval: (q) => canManage && motChecksAreActive(q.state.data) ? 3_000 : false,
  });
  const data = canManage ? query.data : undefined;
  const progress = data ? JSON.stringify([data.current, data.run]) : "";
  useEffect(() => {
    if (canManage && progress) void client.invalidateQueries({ queryKey: staffCarsKey });
  }, [client, canManage, progress]);

  const active = motChecksAreActive(data);
  const disabled = !canManage || starting || active || query.isPending || query.isError || !data?.configured || data.current.total === 0;
  const start = async () => {
    if (disabled || inFlight.current) return;
    inFlight.current = true;
    const controller = new AbortController();
    startRequest.current = controller;
    setStarting(true);
    setStartError(false);
    try {
      const result = await customFetch<StaffMotCheckStatus>(endpoint, { method: "POST", responseType: "json", signal: controller.signal });
      if (controller.signal.aborted) return;
      client.setQueryData(carsMotChecksKey, result);
      void client.invalidateQueries({ queryKey: staffCarsKey });
    } catch {
      if (!controller.signal.aborted) setStartError(true);
    } finally {
      inFlight.current = false;
      if (startRequest.current === controller) startRequest.current = null;
      setStarting(false);
    }
  };
  return { query, data, active, starting, startError, disabled, start };
}

export function CarsMotCheckStatus({ checks }: { checks: ReturnType<typeof useCarsMotChecks> }) {
  const { query, data, active, starting, startError } = checks;
  if (!data && !query.isError && !startError) return null;
  if (query.isError || startError) return <div className="cars-mot-check-status" role="status" aria-live="polite">
    <p>{startError ? "MOT checks could not be started. Please try again." : "MOT check progress is unavailable. Existing MOT details are still shown."}</p>
    {query.isError && <Button size="sm" variant="ghost" disabled={query.isFetching} onClick={() => void query.refetch()}>Retry MOT status</Button>}
  </div>;
  if (!data) return null;
  if (!data.configured) return <div className="cars-mot-check-status" role="status"><p>MOT checks are unavailable. Check the MOT connection in Settings.</p></div>;
  const runActive = data.run?.status === "queued" || data.run?.status === "running";
  const total = runActive ? data.run!.total : data.current.total;
  const done = runActive ? data.run!.checked + data.run!.failed + data.run!.skipped : data.current.checked + data.current.failed + data.current.missingRegistration;
  return <div className="cars-mot-check-status" role="status" aria-live="polite" aria-atomic="true">
    <div>
      <p>{active || starting
        ? `Checking MOTs · ${Math.min(done, total)} of ${total} cars processed`
        : data.current.total === 0
          ? "No current cars to check."
          : `${data.current.checked} of ${data.current.total} current cars checked`}
        {data.current.failed > 0 && ` · ${data.current.failed} could not be checked`}
        {data.current.missingRegistration > 0 && ` · ${data.current.missingRegistration} without a usable registration`}
        {"preview" in data && data.preview === true && " · Preview check"}
      </p>
      <p className="cars-mot-check-note">New arrivals are checked automatically. Available and reserved cars only.</p>
    </div>
    {active && total > 0 && <progress aria-label="MOT check progress" value={Math.min(done, total)} max={total} />}
  </div>;
}
