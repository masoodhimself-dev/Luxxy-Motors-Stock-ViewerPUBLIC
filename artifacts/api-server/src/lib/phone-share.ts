import { createHash } from "node:crypto";
export type PhoneShareFile = {
  filename: string;
  content: string;
  contentType: string;
};
export type PhoneSharePayload = {
  confirmationScope?: "document";
  enquiryId?: string;
  customerEmail?: string;
  customerName?: string;
  vehicleId?: string;
  customerPhone?: string;
  title: string;
  message: string;
  files: PhoneShareFile[];
};
export class PhoneShareError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}
export const phoneShareHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const validPhoneToken = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
export function validatePhoneSharePayload(payload: PhoneSharePayload) {
  if (
    !payload.title.trim() ||
    payload.title.length > 240 ||
    payload.message.length > 30000 ||
    payload.files.length > 8
  )
    throw new PhoneShareError(
      "The sharing pack is too large. Choose fewer attachments.",
    );
  let size = 0;
  for (const file of payload.files) {
    if (
      !/^[\w .()-]{1,180}$/.test(file.filename) ||
      !["application/pdf", "image/jpeg", "image/png", "text/calendar"].includes(
        file.contentType,
      ) ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)
    )
      throw new PhoneShareError("An attachment cannot be shared.");
    size += Buffer.from(file.content, "base64").length;
  }
  if (size > 8 * 1024 * 1024)
    throw new PhoneShareError(
      "Choose fewer attachments to keep this sharing pack under 8 MB.",
    );
  return payload;
}
