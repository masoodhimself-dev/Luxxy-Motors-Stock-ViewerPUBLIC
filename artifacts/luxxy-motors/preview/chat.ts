import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ChatError,
  DealerChatService,
  emptyChatState,
  type ChatEnquiryInput,
  type ChatState,
  type ChatStore,
  type ChatTransaction,
  type ChatDealer,
  type ChatStock,
} from "../../api-server/src/lib/dealer-chat";
import {
  roleHasPermission,
  type StaffRole,
} from "../../api-server/src/lib/staff-permissions";
import {
  readPreviewSettings,
  readPreviewBookingState,
  upsertPreviewChatEnquiry,
} from "./reservations";
import {
  readPreviewStaffDirectory,
  readPreviewPriceOverrides,
  type PreviewOperationsState,
} from "./operations";
import { readPreviewSaleInventory } from "./sales";
import { previewStock } from "./stock";
const defaultFile = fileURLToPath(
  new URL("../../../.local/website-chat-preview.json", import.meta.url),
);
const operationFile = fileURLToPath(
  new URL("../../../.local/dealer-operations-preview.json", import.meta.url),
);
const queues = new Map<string, Promise<unknown>>();
function serial<T>(file: string, work: () => Promise<T>): Promise<T> {
  const run = (queues.get(file) ?? Promise.resolve()).then(work, work);
  queues.set(
    file,
    run.catch(() => {}),
  );
  return run;
}
type FileState = { state: ChatState; pending: ChatEnquiryInput[] };
/** A durable outbox recovers enquiry writes if the preview stops between the two files. */
export class PreviewChatStore implements ChatStore {
  constructor(
    public file = defaultFile,
    private saveEnquiry: (
      input: ChatEnquiryInput,
    ) => Promise<void> = upsertPreviewChatEnquiry,
  ) {}
  private async load(): Promise<FileState> {
    try {
      const value = JSON.parse(await readFile(this.file, "utf8")) as FileState;
      if (
        value.state.schemaVersion !== 1 ||
        !Array.isArray(value.state.records) ||
        !Array.isArray(value.pending)
      )
        throw new Error("Invalid chat store");
      return value;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { state: emptyChatState(), pending: [] };
      throw error;
    }
  }
  private async save(value: FileState) {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(value), { mode: 0o600 });
    await rename(tmp, this.file);
  }
  private async flush(value: FileState) {
    if (!value.pending.length) return;
    for (const input of value.pending) await this.saveEnquiry(input);
    value.pending = [];
    await this.save(value);
  }
  async read(_dealerId: string) {
    return serial(this.file, async () => {
      const value = await this.load();
      await this.flush(value);
      return structuredClone(value.state);
    });
  }
  async transaction<T>(
    _dealerId: string,
    work: (tx: ChatTransaction) => Promise<T>,
  ): Promise<T> {
    return serial(this.file, async () => {
      const value = await this.load();
      await this.flush(value);
      const result = await work({
        state: value.state,
        saveEnquiry: async (input) => {
          const previous = value.pending.findIndex((p) => p.id === input.id);
          if (previous >= 0) value.pending[previous] = input;
          else value.pending.push(input);
        },
      });
      await this.save(value);
      await this.flush(value);
      return result;
    });
  }
}
export async function readPreviewChatStaff(): Promise<
  Array<{ id: string; name: string; role: StaffRole }>
> {
  try {
    const state = JSON.parse(
      await readFile(operationFile, "utf8"),
    ) as PreviewOperationsState;
    return state.members
      .filter((m) => m.active)
      .map((m) => ({
        id: m.authUserId,
        name: m.name ?? m.email ?? "Staff member",
        role: m.role,
      }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return [
        { id: "preview-alex", name: "Alex", role: "owner" },
        { id: "preview-jamie", name: "Jamie", role: "salesperson" },
      ];
    throw error;
  }
}
export const previewChatStore = new PreviewChatStore();
export function createPreviewChatService(store: ChatStore = previewChatStore) {
  return new DealerChatService(store, {
    dealerId: () => "local-preview",
    dealer: async () => (await readPreviewSettings()) as ChatDealer,
    staff: readPreviewStaffDirectory,
    vehicle: async (id): Promise<ChatStock | null> => {
      const car = previewStock.cars.find((c) => c.id === id);
      if (
        !car ||
        !["available", "reserved"].includes(
          car.inventoryStatus ?? "available",
        ) ||
        car.sourceStatus === "missing"
      )
        return null;
      const [sales, prices, booking] = await Promise.all([
        readPreviewSaleInventory(),
        readPreviewPriceOverrides(),
        readPreviewBookingState(),
      ]);
      const reserved = booking.reservations.some(
        (r) =>
          r.status === "reserved" &&
          (r.vehicleId === id ||
            r.vehicleId ===
              `00000000-0000-4000-8000-${String(previewStock.cars.indexOf(car) + 1).padStart(12, "0")}`),
      );
      const status =
        sales[id] ??
        (reserved ? "reserved" : (car.inventoryStatus ?? "available"));
      if (!["available", "reserved"].includes(status)) return null;
      return {
        ...car,
        inventoryStatus: status,
        price: prices[id] ?? car.price,
      } as ChatStock;
    },
  });
}
const previewService = createPreviewChatService();
export async function readPreviewChatRecords(
  store: ChatStore = previewChatStore,
) {
  return (await store.read("local-preview")).records.map((record) => ({
    conversation: record.conversation,
    messages: record.messages,
  }));
}
function local(req: IncomingMessage) {
  const remote = (req.socket.remoteAddress ?? "").replace(/^::ffff:/, "");
  let host: string;
  try {
    host = new URL(`http://${req.headers.host}`).hostname;
  } catch {
    return false;
  }
  const loopback =
    ["127.0.0.1", "::1"].includes(remote) &&
    ["127.0.0.1", "localhost", "[::1]"].includes(host);
  const lanHost = process.env.LUXXY_PREVIEW_LAN_HOST,
    privateIpv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;
  const lan = Boolean(
    lanHost &&
    privateIpv4.test(lanHost) &&
    host === lanHost &&
    (privateIpv4.test(remote) || remote === "127.0.0.1"),
  );
  return (
    (loopback || lan) &&
    (!req.headers.origin || req.headers.origin === `http://${req.headers.host}`)
  );
}
function send(res: ServerResponse, status: number, value: unknown) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  let data = "";
  for await (const chunk of req) {
    data += chunk;
    if (Buffer.byteLength(data) > 12_000)
      throw new ChatError("This message is too large.", 413);
  }
  try {
    const input = JSON.parse(data || "{}");
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new Error();
    return input;
  } catch {
    throw new ChatError("Please check the chat request.");
  }
}
const limits = new Map<string, { count: number; reset: number }>();
export type ChatPreviewOptions = {
  service?: DealerChatService;
  staff?: typeof readPreviewChatStaff;
  rateLimit?: boolean;
};
export async function chatPreview(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  options: ChatPreviewOptions = {},
): Promise<boolean> {
  if (!/^\/api\/(?:chat|staff\/chat)(?:\/|$)/.test(url.pathname)) return false;
  if (!local(req)) {
    send(res, 403, {
      error: "This service is available only on the authorised network.",
    });
    return true;
  }
  const path = url.pathname.replace(/^\/api/, ""),
    service = options.service ?? previewService,
    token =
      typeof req.headers["x-chat-token"] === "string"
        ? req.headers["x-chat-token"]
        : "";
  try {
    const staffRoute = path.startsWith("/staff/chat");
    let staff:
      Awaited<ReturnType<typeof readPreviewChatStaff>>[number] | undefined;
    if (staffRoute) {
      const id =
        typeof req.headers["x-preview-staff-id"] === "string"
          ? req.headers["x-preview-staff-id"]
          : "preview-alex";
      staff = (await (options.staff ?? readPreviewChatStaff)()).find(
        (s) => s.id === id,
      );
      if (!staff)
        throw new ChatError(
          "Sign in with an active staff account to use the dealer portal.",
          401,
        );
      if (
        path === "/staff/chat/settings" &&
        req.method !== "GET" &&
        !roleHasPermission(staff.role, "settings.publish")
      )
        throw new ChatError("Your staff role does not allow this action.", 403);
    }
    if (!staffRoute && options.rateLimit !== false) {
      const now = Date.now(),
        start = path === "/chat/conversations" && req.method === "POST",
        key = `${req.socket.remoteAddress}:${start ? "start" : req.method === "GET" ? "read" : "write"}`;
      if (limits.size > 10_000)
        for (const [id, b] of limits) if (b.reset <= now) limits.delete(id);
      const bucket = limits.get(key),
        max = start ? 30 : req.method === "GET" ? 180 : 45;
      if (!bucket || bucket.reset < now)
        limits.set(key, { count: 1, reset: now + (start ? 3600_000 : 60_000) });
      else if (++bucket.count > max) {
        res.setHeader("Retry-After", Math.ceil((bucket.reset - now) / 1000));
        throw new ChatError(
          "Please wait a moment before sending more chat requests.",
          429,
        );
      }
    }
    let result: unknown;
    let status = 200;
    let allow: string | null = null;
    const publicConversation =
        /^\/chat\/conversations\/([^/]+)(?:\/(messages|contact|handover))?$/.exec(
          path,
        ),
      staffConversation =
        /^\/staff\/chat\/conversations\/([^/]+)(?:\/(messages|read))?$/.exec(
          path,
        );
    if (path === "/chat/config") {
      allow = "GET";
      if (req.method === "GET") result = await service.config();
    } else if (path === "/chat/conversations") {
      allow = "POST";
      if (req.method === "POST") {
        result = await service.start(await body(req), token);
        status = 201;
      }
    } else if (publicConversation) {
      const [, id, action] = publicConversation;
      allow = action ? "POST" : "GET";
      if (!action && req.method === "GET")
        result = await service.get(id, token);
      if (req.method === "POST") {
        if (action === "messages")
          result = await service.message(id, await body(req), token);
        if (action === "contact")
          result = await service.contact(id, await body(req), token);
        if (action === "handover") result = await service.handover(id, token);
      }
    } else if (path === "/staff/chat/conversations") {
      allow = "GET";
      if (req.method === "GET") result = await service.inbox();
    } else if (staffConversation) {
      const [, id, action] = staffConversation;
      allow = action ? "POST" : "GET, PATCH";
      if (!action && req.method === "GET")
        result = await service.get(id, undefined, true);
      if (!action && req.method === "PATCH")
        result = await service.update(id, await body(req));
      if (action === "messages" && req.method === "POST")
        result = await service.message(id, await body(req), undefined, staff);
      if (action === "read" && req.method === "POST")
        result = await service.read(id);
    } else if (path === "/staff/chat/presence") {
      allow = "POST";
      if (req.method === "POST")
        result = await service.presence(staff!.id, (await body(req)).available);
    } else if (path === "/staff/chat/settings") {
      allow = "GET, PATCH";
      if (req.method === "GET") result = await service.settings();
      if (req.method === "PATCH")
        result = await service.settings(await body(req));
    }
    if (result === undefined) {
      if (allow) res.setHeader("Allow", allow);
      throw new ChatError(
        "This chat action is unavailable.",
        allow ? 405 : 404,
      );
    }
    send(res, status, result);
  } catch (error) {
    send(res, error instanceof ChatError ? error.status : 500, {
      error:
        error instanceof ChatError
          ? error.message
          : "Chat could not be loaded or saved. Please try again.",
    });
  }
  return true;
}
