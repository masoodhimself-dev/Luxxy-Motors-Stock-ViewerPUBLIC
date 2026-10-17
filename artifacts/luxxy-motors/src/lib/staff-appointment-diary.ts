import { useQuery } from "@tanstack/react-query";
import { customFetch, getGetEnquiriesQueryKey } from "@workspace/api-client-react";

export type StaffDiaryAppointment = {
  id: string;
  reference: string;
  customerName: string;
  vehicleTitle: string | null;
  assignedToName: string | null;
  appointmentAt: string;
  appointmentDurationMinutes: number | null;
  appointmentBufferMinutes: number | null;
};
export type StaffAppointmentDiary = { date: string; timezone: "Europe/London"; appointments: StaffDiaryAppointment[] };

export function useStaffAppointmentDiary(date: string, enabled = true) {
  return useQuery({
    queryKey: [...getGetEnquiriesQueryKey(), "appointments", date],
    queryFn: ({ signal }) => customFetch<StaffAppointmentDiary>(`/api/staff/enquiries/appointments?date=${encodeURIComponent(date)}`, { signal, responseType: "json" }),
    enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(date),
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
    // Never show another date's diary while a new date is being checked.
    placeholderData: undefined,
  });
}
