import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { StaffTaxCheckStatus } from "@workspace/vehicle-meta";
import { staffCarsKey } from "./staff-cars-query";

const endpoint = "/api/staff/vehicles/tax-checks";
const taxChecksKey = ["staff-cars-tax-checks"];

export function useCarsTaxChecks(enabled: boolean) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: taxChecksKey,
    queryFn: ({ signal }) => customFetch<StaffTaxCheckStatus>(endpoint, { signal }),
    enabled,
    staleTime: 10_000,
    retry: false,
    refetchInterval: ({ state }) => state.data?.current.pending ? 3_000 : 60_000,
  });

  const progress = enabled ? query.data?.current : undefined;
  const checked = progress?.checked;
  const pending = progress?.pending;
  const unavailable = progress?.unavailable;
  useEffect(() => {
    if (checked !== undefined) void client.invalidateQueries({ queryKey: staffCarsKey });
  }, [client, checked, pending, unavailable]);

  const start = useMutation({
    mutationFn: () => customFetch<StaffTaxCheckStatus>(endpoint, { method: "POST", responseType: "json" }),
    onSuccess: (result) => {
      client.setQueryData(taxChecksKey, result);
      void client.invalidateQueries({ queryKey: staffCarsKey });
    },
  });
  return { query, progress, start };
}
