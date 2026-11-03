export type DeliverySnapshot = {
  dealerName: string;
  saleReference: string;
  vehicleId: string;
  vehicle: string;
  registration: string;
  customer: string;
  recipient: string;
  phone: string;
  address: string;
  scheduledDate: string;
  timeWindow: string;
  driver: string;
  instructions: string;
};
export type DeliveryPhotoSlot =
  "front" | "rear" | "left" | "right" | "dashboard" | "damage";
export const deliveryPhotoSlots: { id: DeliveryPhotoSlot; label: string }[] = [
  { id: "front", label: "Front" },
  { id: "rear", label: "Rear" },
  { id: "left", label: "Left side" },
  { id: "right", label: "Right side" },
  { id: "dashboard", label: "Dashboard & mileage" },
  { id: "damage", label: "Damage / other" },
];
export type DeliveryReport = {
  requestId: string;
  driverName: string;
  recipientName: string;
  handoverAt: string;
  mileage: number;
  outcome: "delivered" | "not-delivered";
  notes: string;
  keys: number;
  documentsProvided: boolean;
  acknowledged: boolean;
  location: {
    latitude: number;
    longitude: number;
    accuracy: number;
    capturedAt: string;
  } | null;
  locationReason: string;
};
export type DeliveryJob = {
  id: string;
  status: "open" | "received" | "expired" | "revoked" | "superseded";
  current?: boolean;
  snapshot: DeliverySnapshot;
  expiresAt: string;
  createdAt: string;
  submittedAt: string | null;
  submission:
    (DeliveryReport & { source?: "paper"; recordedBy?: string }) | null;
  photos: {
    id: string;
    phase: string;
    slot: string;
    capturedAt: string;
    receivedAt: string;
  }[];
};
export type PublicDeliveryJob = Omit<DeliveryJob, "photos" | "submission"> & {
  submission: { outcome: string; receivedAt: string } | null;
  photos: { requestId: string; phase: string; slot: string }[];
};
export type QueuedDeliveryPhoto = {
  requestId: string;
  phase: "departure" | "arrival";
  slot: DeliveryPhotoSlot;
  capturedAt: string;
  dataUrl: string;
  saved?: boolean;
};
export type DeliveryLocalDraft = {
  key: string;
  savedAt: number;
  record: PublicDeliveryJob;
  report: DeliveryReport;
  photos: QueuedDeliveryPhoto[];
};
const databaseName = "dealer-delivery-evidence-v1";
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    let settled = false;
    const timer = window.setTimeout(() => {
      settled = true;
      reject(new Error("Device storage did not respond."));
    }, 4000);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("drafts", { keyPath: "key" });
    request.onsuccess = () => {
      clearTimeout(timer);
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      resolve(request.result);
    };
    const failed = (error: Error | DOMException | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error || new Error("Device storage is unavailable."));
    };
    request.onerror = () => failed(request.error);
    request.onblocked = () =>
      failed(new Error("Device storage is unavailable."));
  });
}
export async function deliveryLocalKey(token: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(bytes), (x) =>
    x.toString(16).padStart(2, "0"),
  ).join("");
}
export async function deliveryLocalDraft(
  key: string,
): Promise<DeliveryLocalDraft | undefined> {
  const db = await database();
  try {
    return await new Promise((resolve, reject) => {
      const r = db.transaction("drafts").objectStore("drafts").get(key);
      r.onsuccess = () => {
        const value = r.result as DeliveryLocalDraft | undefined;
        if (value && Date.now() - value.savedAt >= 7 * 86400_000)
          void clearDeliveryLocalDraft(key).catch(() => undefined);
        resolve(
          value && Date.now() - value.savedAt < 7 * 86400_000
            ? value
            : undefined,
        );
      };
      r.onerror = () => reject(r.error);
    });
  } finally {
    db.close();
  }
}
export async function saveDeliveryLocalDraft(value: DeliveryLocalDraft) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").put(value);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
export async function clearDeliveryLocalDraft(key: string) {
  const db = await database();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("drafts", "readwrite");
      tx.objectStore("drafts").delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}
/** Constrain uploads before buffering; the server independently decodes and strips metadata. */
export async function deliveryPhotoData(file: File): Promise<string> {
  if (
    !/^image\/(jpeg|png|webp)$/.test(file.type) ||
    file.size > 16 * 1024 * 1024
  )
    throw new Error("Choose a JPEG, PNG or WebP photo under 16 MB.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.width * image.height > 40_000_000)
      throw new Error("Choose a smaller photo.");
    const scale = Math.min(1, 1600 / Math.max(image.width, image.height)),
      canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    canvas
      .getContext("2d")!
      .drawImage(image, 0, 0, canvas.width, canvas.height);
    const output = canvas.toDataURL("image/jpeg", 0.82);
    if (output.length > 2_790_000)
      throw new Error("This photo is too large. Choose a smaller image.");
    return output;
  } finally {
    URL.revokeObjectURL(url);
  }
}
