/** Public MOT records only: no VIN, credentials or dealership/customer data. */
export interface MotTest {
  completedDate: string;
  result: "PASSED" | "FAILED";
  expiryDate: string | null;
  mileage: string | null;
  mileageUnit: "MI" | "KM" | null;
  defects: { text: string; type: string; dangerous: boolean }[];
}
export interface MotHistory {
  registration: string;
  make: string | null;
  model: string | null;
  checkedAt: string;
  /** Supplied by DVSA for new vehicles; never inferred from registration bands. */
  firstMotDueDate?: string | null;
  registrationDate?: string | null;
  recall: "Yes" | "No" | "Unknown" | "Unavailable";
  tests: MotTest[];
}
