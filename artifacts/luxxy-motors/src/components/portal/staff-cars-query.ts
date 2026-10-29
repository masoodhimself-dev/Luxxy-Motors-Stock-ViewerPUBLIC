import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import type { Car } from "@/lib/stock-context";
import type { StaffCarMeta, StaffCarsFeed } from "@workspace/vehicle-meta";
export type StaffCar = Car & { staff: StaffCarMeta };
export type StaffCarsData = { cars: StaffCar[]; feed: StaffCarsFeed };
export const staffCarsKey = ["staff-cars"];
export function useStaffCars() {
  return useQuery({
    queryKey: staffCarsKey,
    queryFn: ({ signal }) =>
      customFetch<StaffCarsData>("/api/staff/cars", { signal }),
    staleTime: 60000,
    retry: false,
    refetchInterval: false,
  });
}
