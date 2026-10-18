import { customFetch } from "@workspace/api-client-react";

export type DeclarationSnapshot = {
  dealerName: string;
  enquiryReference: string;
  customerName?: string;
  vehicleId: string;
  vehicle: { title: string; registration: string | null };
  appointmentAt: string;
  durationMinutes: number;
  appointmentRevision: number;
};
export type TestDriveDeclaration = {
  id: string;
  status: "pending" | "signed" | "revoked" | "expired" | "superseded";
  revision: number;
  createdAt: string;
  expiresAt: string;
  signedAt: string | null;
  current?: boolean;
  signerName: string | null;
  snapshot: DeclarationSnapshot;
  statementVersion: string;
  statement: string;
  statementHash: string;
  revokedAt: string | null;
  staffChecks: {
    licenceChecked: boolean;
    insuranceChecked: boolean;
    checkedAt: string | null;
    checkedBy: string | null;
  };
};
export type PublicTestDriveDeclaration = Pick<
  TestDriveDeclaration,
  "expiresAt" | "signedAt" | "statementVersion" | "statement" | "statementHash"
> & {
  status: "pending" | "signed";
  dealerName: string;
  vehicle: DeclarationSnapshot["vehicle"];
  appointmentAt: string;
  durationMinutes: number;
  signingEnabled?: boolean;
};
export function declarationToken() {
  if (!globalThis.crypto?.getRandomValues)
    throw new Error("Use an up-to-date browser to create a secure link.");
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}
export function declarationTime(value: string) {
  return new Date(value).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    dateStyle: "medium",
    timeStyle: "short",
  });
}
export function declarationError(cause: unknown) {
  if (cause && typeof cause === "object" && "data" in cause) {
    const data = cause.data as { error?: string } | null;
    if (data?.error) return data.error;
  }
  return cause instanceof Error && !cause.message.startsWith("HTTP")
    ? cause.message
    : "Could not load this declaration. Please try again.";
}
export function declarationRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  return customFetch<T>(
    path,
    body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
}
