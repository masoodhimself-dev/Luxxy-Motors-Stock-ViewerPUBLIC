export * from "./generated/api";
export * from "./generated/types";

// Prefer the runtime path-parameter validator over Orval’s same-named query type.
export { GetStaffAppointmentAvailabilityParams } from "./generated/api";
