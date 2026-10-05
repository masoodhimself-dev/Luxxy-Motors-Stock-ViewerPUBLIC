import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  defaultChatSettings,
  vehicleRegistrationLabel,
  type ChatAction,
  type ChatAvailability,
  type ChatConversation,
  type ChatConversationView,
  type ChatInbox,
  type ChatMessage,
  type ChatPublicConfig,
  type ChatSession,
  type ChatSettings,
} from "@workspace/vehicle-meta";

export class ChatError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export type ChatStock = {
  id: string;
  title: string | null;
  price: number | null;
  inventoryStatus: string;
  heroImage?: string | null;
  registration?: string | null;
  plate?: string | null;
  vrm?: string | null;
  year?: number | null;
  registrationBand?: string | null;
  mileage?: number | null;
  fuel?: string | null;
  transmission?: string | null;
  engineSize?: string | null;
  colour?: string | null;
  doors?: number | null;
  seats?: number | null;
  currency?: string | null;
  features?: unknown;
  specifications?: object | null;
  sourceExtras?: object | null;
};
export type ChatDealer = {
  identity: { name: string };
  hours: Array<{ days: string; times: string }>;
  contact?: { phone?: string; email?: string };
  address?: { street?: string; city?: string; postcode?: string };
  warranty?: { enabled: boolean; description: string };
  delivery?: { enabled: boolean; description: string };
  onlineReservation?: { enabled: boolean; terms?: string; depositPence?: number };
  testDriveBooking?: { enabled?: boolean };
};
export interface ChatRecord {
  conversation: ChatConversation;
  messages: ChatMessage[];
  tokenHash: string;
  tokenExpiresAt: string;
  requestId: string;
}
export interface ChatState {
  schemaVersion: 1;
  settings: ChatSettings;
  records: ChatRecord[];
  presence: Record<string, { available: boolean; expiresAt: string }>;
}
export type ChatEnquiryInput = {
  id: string;
  reference: string;
  vehicle: ChatConversation["vehicle"];
  name: string;
  email: string | null;
  phone: string | null;
  message: string;
  callbackRequested: boolean;
  createdAt: string;
};
export interface ChatTransaction {
  state: ChatState;
  saveEnquiry: (input: ChatEnquiryInput) => Promise<void>;
}
export interface ChatStore {
  transaction<T>(
    dealerId: string,
    work: (tx: ChatTransaction) => Promise<T>,
  ): Promise<T>;
  read(dealerId: string): Promise<ChatState>;
}
export function emptyChatState(): ChatState {
  return {
    schemaVersion: 1,
    settings: { ...defaultChatSettings },
    records: [],
    presence: {},
  };
}
export class MemoryChatStore implements ChatStore {
  states = new Map<string, ChatState>();
  enquiries = new Map<string, ChatEnquiryInput>();
  private queue: Promise<unknown> = Promise.resolve();
  async read(id: string) {
    return structuredClone(this.states.get(id) ?? emptyChatState());
  }
  transaction<T>(
    id: string,
    work: (tx: ChatTransaction) => Promise<T>,
  ): Promise<T> {
    const run = this.queue.then(async () => {
      const state = await this.read(id);
      const enquiries = structuredClone(this.enquiries);
      const result = await work({
        state,
        saveEnquiry: async (value) => {
          enquiries.set(`${id}:${value.id}`, value);
        },
      });
      this.states.set(id, state);
      this.enquiries = enquiries;
      return result;
    });
    this.queue = run.catch(() => {});
    return run;
  }
}
export function chatTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
function tokenMatches(record: ChatRecord, token: string, now: Date) {
  if (
    !/^[a-zA-Z0-9_-]{43}$/.test(token) ||
    new Date(record.tokenExpiresAt) <= now
  )
    return false;
  return timingSafeEqual(
    Buffer.from(record.tokenHash, "hex"),
    Buffer.from(chatTokenHash(token), "hex"),
  );
}
function text(value: unknown, name: string, maximum: number, required = true) {
  if (
    typeof value !== "string" ||
    value.trim().length > maximum ||
    (required && !value.trim())
  )
    throw new ChatError(`Please check ${name}.`);
  return value.trim();
}
export function chatRequestId(value: unknown) {
  const id = text(value, "the message reference", 100);
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id))
    throw new ChatError("Please check the message reference.");
  return id;
}
type ChatContactInput = {
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  callbackRequested?: unknown;
};
function contactDetails(input: ChatContactInput) {
  const name = text(input.name, "your name", 120);
  if (name.length < 2) throw new ChatError("Please enter your name.");
  const email =
      input.email === undefined || input.email === null || input.email === ""
        ? null
        : text(input.email, "your email address", 254).toLowerCase(),
    phone =
      input.phone === undefined || input.phone === null || input.phone === ""
        ? null
        : text(input.phone, "your phone number", 30).replace(/[\s().-]/g, "");
  if (
    (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
    (phone && !/^\+?\d{7,15}$/.test(phone)) ||
    (!email && !phone) ||
    (input.callbackRequested !== undefined &&
      typeof input.callbackRequested !== "boolean") ||
    (input.callbackRequested === true && !phone)
  )
    throw new ChatError(
      "Leave a valid email or phone number. A callback needs a phone number.",
    );
  return { name, email, phone };
}
function range(value: string) {
  const match = value
    .trim()
    .match(
      /^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–—]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*\(sample\))?$/i,
    );
  if (!match) return null;
  const clock = (
    hour: string,
    minute: string | undefined,
    period: string | undefined,
  ) => {
    const h = Number(hour),
      m = Number(minute ?? 0);
    if (m > 59 || (period ? h < 1 || h > 12 : h > 23)) return null;
    return (
      (period ? (h % 12) + (period.toLowerCase() === "pm" ? 12 : 0) : h) * 60 +
      m
    );
  };
  const start = clock(match[1], match[2], match[3]),
    end = clock(match[4], match[5], match[6]);
  return start !== null && end !== null && end > start ? { start, end } : null;
}
/** London calendar arithmetic handles both BST and GMT; unparseable hours never imply online. */
export function chatAvailability(
  hours: ChatDealer["hours"],
  presence: ChatState["presence"],
  now = new Date(),
): ChatAvailability {
  const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const schedule = new Map<number, string>();
  for (const row of hours) {
    const days =
      row.days
        .toLowerCase()
        .match(
          /\b(?:sun(?:day)?|mon(?:day)?|tues?(?:day)?|wed(?:nesday)?|thu(?:rs?|r?sday)?|fri(?:day)?|sat(?:urday)?)\b/g,
        ) ?? [];
    const indexes = days
      .map((day) => weekdays.indexOf(day.slice(0, 3)))
      .filter((index) => index >= 0);
    if (/[-–—]|\bto\b/.test(row.days) && indexes.length > 1) {
      for (let n = 0; n < 7; n++) {
        const day = (indexes[0] + n) % 7;
        if (!schedule.has(day)) schedule.set(day, row.times);
        if (day === indexes[1]) break;
      }
    } else
      for (const day of indexes)
        if (!schedule.has(day)) schedule.set(day, row.times);
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const localDate = new Date(
    `${part("year")}-${part("month")}-${part("day")}T12:00:00Z`,
  );
  const today = localDate.getUTCDay(),
    minute = Number(part("hour")) * 60 + Number(part("minute"));
  const current = schedule.get(today),
    currentRange = current ? range(current) : null;
  const showroomState = currentRange
    ? minute >= currentRange.start && minute < currentRange.end
      ? "open"
      : "closed"
    : current && /^closed$/i.test(current.trim())
      ? "closed"
      : "unknown";
  let nextOpening: string | null = null;
  for (let offset = 0; offset <= 14; offset++) {
    const r = range(schedule.get((today + offset) % 7) ?? "");
    if (r && (offset > 0 || r.start > minute)) {
      const date = new Date(localDate);
      date.setUTCDate(date.getUTCDate() + offset);
      const label =
        offset === 0
          ? "today"
          : offset === 1
            ? "tomorrow"
            : new Intl.DateTimeFormat("en-GB", {
                timeZone: "Europe/London",
                weekday: "short",
                day: "numeric",
                month: "short",
              }).format(date);
      nextOpening = `${label} at ${String(Math.floor(r.start / 60)).padStart(2, "0")}:${String(r.start % 60).padStart(2, "0")} (UK time)`;
      break;
    }
  }
  return {
    showroomState,
    nextOpening,
    staffOnline:
      showroomState === "open" &&
      Object.values(presence).some(
        (p) => p.available && new Date(p.expiresAt) > now,
      ),
  };
}
type Answer = { body: string; actions: ChatAction[]; handover?: boolean };
export function chatAnswer(
  question: string,
  car: ChatStock | null,
  dealer: ChatDealer,
): Answer {
  const q = question.toLowerCase();
  if (/\b(?:are you|is this|am i (?:talking|speaking) to)\b.*\b(?:human|person|real|bot|robot|ai|automated|automation)\b|\b(?:who|what) are you\b/.test(q))
    return { body: 'I’m the showroom’s automated assistant. I can help with the published car details, or pass your question to the team.', actions: [], handover: false };
  const vehicle = car
    ? {
        label: "View this car",
        href: `/vehicle/${encodeURIComponent(car.id)}`,
        kind: "vehicle" as const,
      }
    : null;
  const contact = {
    label: "Contact the showroom",
    href: "/contact",
    kind: "contact" as const,
  };
  const finish = (
    body: string,
    actions: ChatAction[] = vehicle ? [vehicle] : [],
    handover = false,
  ) => ({ body, actions, handover });
  if (
    /\b(payment|paid|refund|invoice|collection|sale|reservation status|booking status|finance approval|customer history|previous owner|discount|best price|last price|negotiate|valuation|worth|fault|damage|accident|service history|mot|finance|loan|credit)\b/.test(
      q,
    )
  )
    return finish(
      "The showroom team will need to help with that. I can pass your question on here.",
      [],
      true,
    );
  if (/\b(staff|human|person|agent|team|call me|callback|phone me)\b/.test(q))
    return finish(
      "Of course. I’ll leave this with the showroom team. If you’d like a call back, leave your name and number.",
      [],
      true,
    );
  if (/^(hi|hello|hey)[!.,\s]*$/.test(q))
    return finish(
      car
        ? `Hi. What would you like to know about the ${car.title || "car"}?`
        : "Hi. Are you looking at a particular car, or can I help with a showroom question?",
      [],
    );
  if (/\b(open|opening|hours|close|closed|sunday|saturday)\b/.test(q))
    return finish(
      dealer.hours.length
        ? `Our published hours are ${dealer.hours.map((h) => `${h.days}: ${h.times}`).join("; ")}. Please arrange appointment-only visits with the team.`
        : "I don’t have confirmed opening hours here. The showroom team can help.",
      [contact],
    );
  if (/\b(address|location|where|find you|postcode|directions)\b/.test(q)) {
    const address = [
      dealer.address?.street,
      dealer.address?.city,
      dealer.address?.postcode,
    ]
      .filter(Boolean)
      .join(", ");
    return finish(
      address
        ? `You’ll find us at ${address}.`
        : "The contact page has our showroom details.",
      [contact],
    );
  }
  if (/\b(warranty|warranties)\b/.test(q))
    return dealer.warranty?.enabled && dealer.warranty.description.trim()
      ? finish(
          `${dealer.warranty.description.trim()} The team can confirm what applies to this car.`,
          [contact],
        )
      : finish(
          "The showroom team can confirm the warranty options for this car.",
          [],
          true,
        );
  if (/\b(delivery|deliver|shipping)\b/.test(q))
    return dealer.delivery?.enabled && dealer.delivery.description.trim()
      ? finish(
          `${dealer.delivery.description.trim()} The team can confirm the cost and arrangements for your address.`,
          [contact],
        )
      : finish(
          "The showroom team can check delivery arrangements for you.",
          [],
          true,
        );
  if (/\b(part.?exchange|trade.?in)\b/.test(q))
    return finish(
      "The team can look at a part exchange. Leave your registration and mileage in your message, and they’ll discuss a valuation with you.",
      [],
      true,
    );
  if (!car)
    return finish(
      "Which car are you interested in? Open its page and ask me there, or I can pass this question to the showroom team.",
      [contact],
      true,
    );
  if (/\b(available|availability|still|sold|stock)\b/.test(q))
    return finish(
      car.inventoryStatus === "available"
        ? `${car.title || "This car"} is currently listed as available. Stock can change, so the team will confirm before you travel.`
        : "This car is currently listed as reserved. The team can check its latest availability for you.",
      vehicle ? [vehicle] : [],
      car.inventoryStatus !== "available",
    );
  if (/\b(price|cost|much)\b/.test(q))
    return finish(
      car.price != null && Number.isFinite(car.price) && car.price > 0 && (!car.currency || car.currency.toUpperCase() === 'GBP')
        ? `The advertised price is ${new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(car.price)}.`
        : "There isn’t a confirmed price published here. The team can check it for you.",
      vehicle ? [vehicle] : [],
      car.price == null,
    );
  if (/\b(test.?drive|viewing|visit|book|appointment)\b/.test(q))
    return car.inventoryStatus === "available" &&
      dealer.testDriveBooking?.enabled !== false
      ? finish(
          "You can choose a viewing time using the booking page. It checks the current diary and will tell you whether the booking is confirmed or awaiting the team.",
          [
            {
              label: "Book a test drive",
              href: `/enquire?vehicleId=${encodeURIComponent(car.id)}&type=viewing`,
              kind: "book_test_drive",
            },
          ],
        )
      : finish(
          "The team will need to check a viewing for this car. I can pass your request on.",
          [],
          true,
        );
  if (/\b(reserve|reservation|hold|deposit)\b/.test(q))
    return dealer.onlineReservation?.enabled &&
      car.inventoryStatus === "available" &&
      car.price != null && Number.isFinite(car.price) && car.price > 0 && (!car.currency || car.currency.toUpperCase() === 'GBP') &&
      Boolean(dealer.onlineReservation.terms?.trim()) && (dealer.onlineReservation.depositPence ?? 10000) > 0 &&
      (dealer.onlineReservation.depositPence ?? 10000) <= Math.round(car.price * 100)
      ? finish(
          "You can start a reservation from the car page. Please read the reservation terms and check the amount there before paying.",
          [
            {
              label: "Reserve this car",
              href: `/vehicle/${encodeURIComponent(car.id)}#reserve-car-online`,
              kind: "reserve",
            },
          ],
        )
      : finish("The team can discuss holding this car for you.", [], true);
  if (
    /\b(features?|equipment|carplay|android auto|bluetooth|parking|sensors?|camera|sat.?nav|navigation|sunroof|heated|cruise)\b/.test(
      q,
    )
  ) {
    const headings = new Set([
      "please note",
      "audio and communications",
      "drivers assistance",
      "driver assistance",
      "exterior",
      "illumination",
      "interior",
      "performance",
      "safety and security",
      "valuable features",
      "rare features",
      "added extras",
    ]);
    const specs = car.specifications as
        Record<string, unknown> | null | undefined,
      extras = car.sourceExtras as Record<string, unknown> | null | undefined;
    const sources = [
      car.features,
      specs?.features,
      extras?.features,
      extras?.featureList,
    ];
    const features =
      sources
        .filter(Array.isArray)
        .map((source) => [
          ...new Set(
            (source as unknown[])
              .filter((v): v is string => typeof v === "string")
              .map((v) => v.trim())
              .filter(
                (v) => v && !headings.has(v.toLowerCase().replace(/:$/, "")),
              ),
          ),
        ])
        .find((values) => values.length) ?? [];
    const terms = q.match(
      /carplay|android auto|bluetooth|parking|sensors?|camera|sat.?nav|navigation|sunroof|heated|cruise/g,
    );
    const matching = terms?.length
      ? features.filter((feature) =>
          terms.some((term) =>
            feature.toLowerCase().includes(term.replace(/sat.?nav/, "sat nav")),
          ),
        )
      : features;
    return matching.length
      ? finish(
          `The published equipment list includes ${matching.slice(0, 8).join("; ")}. Please check any feature that matters to you with the team before purchase.`,
        )
      : finish(
          "That equipment isn’t confirmed in the published listing. The showroom team can check it for you.",
          [],
          true,
        );
  }
  const facts: Array<[RegExp, string, unknown]> = [
    [
      /mileage|miles/,
      "The listed mileage is",
      car.mileage != null
        ? `${car.mileage.toLocaleString("en-GB")} miles`
        : null,
    ],
    [/fuel|petrol|diesel|electric/, "The listed fuel type is", car.fuel],
    [
      /transmission|automatic|manual|gearbox/,
      "The listed transmission is",
      car.transmission,
    ],
    [/engine/, "The listed engine size is", car.engineSize],
    [/colou?r/, "The listed colour is", car.colour],
    [
      /doors?/,
      "The listing shows",
      car.doors != null ? `${car.doors} doors` : null,
    ],
    [
      /seats?/,
      "The listing shows",
      car.seats != null ? `${car.seats} seats` : null,
    ],
  ];
  const fact = facts.find(([pattern]) => pattern.test(q));
  if (fact)
    return fact[2] != null && fact[2] !== ""
      ? finish(`${fact[1]} ${fact[2]}.`)
      : finish(
          "That detail isn’t confirmed in the published listing. I’ll pass your question to the team.",
          [],
          true,
        );
  return finish(
    "I don’t have a confirmed answer to that here. I’ll leave your question with the showroom team.",
    [],
    true,
  );
}

export class DealerChatService {
  constructor(
    public store: ChatStore,
    private options: {
      dealerId: () => string;
      dealer: () => Promise<ChatDealer>;
      vehicle: (id: string) => Promise<ChatStock | null>;
      staff: () => Promise<Array<{ id: string; name: string }>>;
      now?: () => Date;
    },
  ) {}
  private now() {
    return this.options.now?.() ?? new Date();
  }
  private record(state: ChatState, id: string, token?: string) {
    const record = state.records.find((r) => r.conversation.id === id);
    if (
      !record ||
      (token !== undefined && !tokenMatches(record, token, this.now()))
    )
      throw new ChatError(
        "This chat session is unavailable. Please start a new chat.",
        404,
      );
    return record;
  }
  private view(
    record: ChatRecord,
    availability: ChatAvailability,
    staff: boolean,
  ): ChatConversationView {
    const conversation = structuredClone(record.conversation);
    if (!staff) {
      conversation.assignedToId = null;
      conversation.assignedToName = null;
      conversation.unreadCount = 0;
    }
    return {
      conversation,
      messages: structuredClone(record.messages),
      availability,
    };
  }
  private append(
    record: ChatRecord,
    role: ChatMessage["authorRole"],
    body: string,
    name: string,
    clientMessageId: string | null = null,
    actions: ChatAction[] = [],
  ) {
    if (record.messages.length >= 1000)
      throw new ChatError(
        "This conversation is full. Please start a new chat.",
        409,
      );
    const now = this.now().toISOString();
    record.messages.push({
      id: randomUUID(),
      conversationId: record.conversation.id,
      authorRole: role,
      authorName: name,
      body,
      createdAt: now,
      actions,
      clientMessageId,
    });
    Object.assign(record.conversation, {
      lastMessage: body.slice(0, 240),
      updatedAt: now,
      revision: record.conversation.revision + 1,
    });
    if (role === "customer") record.conversation.unreadCount++;
  }
  private async syncEnquiry(record: ChatRecord, tx: ChatTransaction) {
    const c = record.conversation;
    if (!c.enquiryId || !c.customerName) return;
    await tx.saveEnquiry({
      id: c.enquiryId,
      reference: `CHAT-${c.reference}-${c.id.slice(-8).toUpperCase()}`,
      vehicle: c.vehicle,
      name: c.customerName,
      email: c.email,
      phone: c.phone,
      message: record.messages
        .map((m) => `${m.authorName}: ${m.body}`)
        .join("\n\n"),
      callbackRequested: c.callbackRequested,
      createdAt: c.createdAt,
    });
  }
  private requireContact(record: ChatRecord) {
    try {
      contactDetails({
        name: record.conversation.customerName,
        email: record.conversation.email,
        phone: record.conversation.phone,
      });
    } catch {
      throw new ChatError(
        "Please leave your name and a valid email address or phone number before continuing.",
      );
    }
  }
  async config(): Promise<ChatPublicConfig> {
    const [state, dealer] = await Promise.all([
      this.store.read(this.options.dealerId()),
      this.options.dealer(),
    ]);
    return {
      settings: state.settings,
      availability: chatAvailability(dealer.hours, state.presence, this.now()),
      dealerName: dealer.identity.name,
    };
  }
  async start(
    input: {
      requestId?: unknown;
      vehicleId?: unknown;
      message?: unknown;
      name?: unknown;
      email?: unknown;
      phone?: unknown;
    },
    token?: string,
  ): Promise<ChatSession> {
    const requestId = chatRequestId(input.requestId),
      dealer = await this.options.dealer();
    return this.store.transaction(this.options.dealerId(), async (tx) => {
      if (!tx.state.settings.enabled)
        throw new ChatError("Website chat is currently unavailable.", 503);
      const duplicate = tx.state.records.find((r) => r.requestId === requestId);
      if (duplicate) {
        if (!token || !tokenMatches(duplicate, token, this.now()))
          throw new ChatError(
            "This chat was already started. Please start a new chat.",
            409,
          );
        return {
          ...this.view(
            duplicate,
            chatAvailability(dealer.hours, tx.state.presence, this.now()),
            false,
          ),
          sessionToken: token,
        };
      }
      const { name, email, phone } = contactDetails(input),
        body =
          input.message === undefined || input.message === ""
            ? null
            : text(input.message, "your message", 2000),
        vehicleId =
          input.vehicleId === undefined || input.vehicleId === null
            ? null
            : text(input.vehicleId, "the car", 100),
        car = vehicleId ? await this.options.vehicle(vehicleId) : null;
      if (vehicleId && !car)
        throw new ChatError(
          "This car is no longer in the public stock. Please ask the team.",
          404,
        );
      const now = this.now(),
        sessionToken =
          token && /^[a-zA-Z0-9_-]{43}$/.test(token)
            ? token
            : randomBytes(32).toString("base64url"),
        id = randomUUID();
      const record: ChatRecord = {
        requestId,
        tokenHash: chatTokenHash(sessionToken),
        tokenExpiresAt: new Date(now.getTime() + 30 * 86400_000).toISOString(),
        conversation: {
          id,
          reference: id.slice(0, 8).toUpperCase(),
          vehicle: car
            ? {
                id: car.id,
                title: car.title || "Vehicle",
                registration: vehicleRegistrationLabel(car),
                price: car.price,
                imageUrl: car.heroImage ?? null,
                url: `/vehicle/${encodeURIComponent(car.id)}`,
              }
            : null,
          enquiryId: randomUUID(),
          customerName: name,
          email,
          phone,
          status: tx.state.settings.automaticAnswers
            ? "assistant"
            : "waiting_staff",
          assignedToId: null,
          assignedToName: null,
          callbackRequested: false,
          unreadCount: 0,
          lastMessage: "",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          revision: 0,
        },
        messages: [],
      };
      this.append(
        record,
        "assistant",
        tx.state.settings.greeting,
        "Showroom assistant",
      );
      if (body) {
        this.append(record, "customer", body, name, requestId);
        if (tx.state.settings.automaticAnswers) {
          const answer = chatAnswer(body, car, dealer);
          this.append(
            record,
            "assistant",
            answer.body,
            "Showroom assistant",
            null,
            answer.actions,
          );
          if (answer.handover) record.conversation.status = "waiting_staff";
        }
      }
      record.conversation.unreadCount = Math.max(
        1,
        record.conversation.unreadCount,
      );
      await this.syncEnquiry(record, tx);
      tx.state.records.unshift(record);
      return {
        ...this.view(
          record,
          chatAvailability(dealer.hours, tx.state.presence, now),
          false,
        ),
        sessionToken,
      };
    });
  }
  async get(id: string, token?: string, staff = false) {
    const [state, dealer] = await Promise.all([
      this.store.read(this.options.dealerId()),
      this.options.dealer(),
    ]);
    return this.view(
      this.record(state, id, staff ? undefined : (token ?? "")),
      chatAvailability(dealer.hours, state.presence, this.now()),
      staff,
    );
  }
  async message(
    id: string,
    input: { body?: unknown; clientMessageId?: unknown },
    token?: string,
    staff?: { id: string; name: string },
  ) {
    const body = text(input.body, "your message", 2000),
      clientMessageId = chatRequestId(input.clientMessageId),
      dealer = await this.options.dealer();
    return this.store.transaction(this.options.dealerId(), async (tx) => {
      if (!staff && !tx.state.settings.enabled)
        throw new ChatError("Website chat is currently unavailable.", 503);
      const record = this.record(
        tx.state,
        id,
        staff ? undefined : (token ?? ""),
      );
      if (!staff) this.requireContact(record);
      const duplicate = record.messages.find(
        (m) =>
          m.clientMessageId === clientMessageId &&
          m.authorRole === (staff ? "staff" : "customer"),
      );
      if (duplicate) {
        if (duplicate.body !== body)
          throw new ChatError("That message reference was already used.", 409);
        return this.view(
          record,
          chatAvailability(dealer.hours, tx.state.presence, this.now()),
          Boolean(staff),
        );
      }
      this.append(
        record,
        staff ? "staff" : "customer",
        body,
        staff?.name ?? record.conversation.customerName ?? "Visitor",
        clientMessageId,
      );
      if (staff) {
        Object.assign(record.conversation, {
          status: "with_staff",
          assignedToId: staff.id,
          assignedToName: staff.name,
          unreadCount: 0,
        });
      } else {
        if (record.conversation.status === "resolved")
          record.conversation.status = "waiting_staff";
        if (
          record.conversation.status === "assistant" &&
          tx.state.settings.automaticAnswers
        ) {
          const car = record.conversation.vehicle
            ? await this.options.vehicle(record.conversation.vehicle.id)
            : null;
          const answer = chatAnswer(body, car, dealer);
          this.append(
            record,
            "assistant",
            answer.body,
            "Showroom assistant",
            null,
            answer.actions,
          );
          if (answer.handover) record.conversation.status = "waiting_staff";
        }
      }
      await this.syncEnquiry(record, tx);
      return this.view(
        record,
        chatAvailability(dealer.hours, tx.state.presence, this.now()),
        Boolean(staff),
      );
    });
  }
  async contact(
    id: string,
    input: ChatContactInput,
    token: string,
  ) {
    const { name, email, phone } = contactDetails(input);
    const dealer = await this.options.dealer();
    return this.store.transaction(this.options.dealerId(), async (tx) => {
      if (!tx.state.settings.enabled)
        throw new ChatError("Website chat is currently unavailable.", 503);
      const record = this.record(tx.state, id, token),
        c = record.conversation;
      const same =
        c.customerName === name &&
        c.email === email &&
        c.phone === phone &&
        c.callbackRequested === Boolean(input.callbackRequested);
      Object.assign(c, {
        customerName: name,
        email,
        phone,
        callbackRequested: Boolean(input.callbackRequested),
        enquiryId: c.enquiryId ?? randomUUID(),
      });
      if (!same) {
        c.unreadCount = Math.max(1, c.unreadCount);
        c.status = c.status === "with_staff" ? "with_staff" : "waiting_staff";
        this.append(
          record,
          "assistant",
          input.callbackRequested
            ? `Thanks, ${name}. I’ve saved your request for a call back. The team will pick it up when they’re available.`
            : `Thanks, ${name}. Your details are saved with this chat so the team can get back to you.`,
          "Showroom assistant",
        );
      }
      await this.syncEnquiry(record, tx);
      return this.view(
        record,
        chatAvailability(dealer.hours, tx.state.presence, this.now()),
        false,
      );
    });
  }
  async handover(id: string, token: string) {
    const dealer = await this.options.dealer();
    return this.store.transaction(this.options.dealerId(), async (tx) => {
      if (!tx.state.settings.enabled)
        throw new ChatError("Website chat is currently unavailable.", 503);
      const record = this.record(tx.state, id, token);
      this.requireContact(record);
      if (
        !["waiting_staff", "with_staff"].includes(record.conversation.status)
      ) {
        record.conversation.status = "waiting_staff";
        const availability = chatAvailability(
          dealer.hours,
          tx.state.presence,
          this.now(),
        );
        this.append(
          record,
          "assistant",
          availability.staffOnline
            ? "I’ve passed this to the showroom team. They’ll reply here when they can."
            : tx.state.settings.offlineMessage,
          "Showroom assistant",
        );
        record.conversation.unreadCount = Math.max(
          1,
          record.conversation.unreadCount,
        );
        await this.syncEnquiry(record, tx);
      }
      return this.view(
        record,
        chatAvailability(dealer.hours, tx.state.presence, this.now()),
        false,
      );
    });
  }
  async inbox(): Promise<ChatInbox> {
    const [state, dealer] = await Promise.all([
      this.store.read(this.options.dealerId()),
      this.options.dealer(),
    ]);
    const conversations = state.records
      .map((r) => structuredClone(r.conversation))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return {
      conversations,
      totalUnread: conversations.reduce((sum, c) => sum + c.unreadCount, 0),
      staffOnline: chatAvailability(dealer.hours, state.presence, this.now())
        .staffOnline,
    };
  }
  async update(
    id: string,
    input: {
      status?: unknown;
      assignedToId?: unknown;
      expectedRevision?: unknown;
    },
  ) {
    const members = await this.options.staff(),
      dealer = await this.options.dealer();
    if (
      !Number.isInteger(input.expectedRevision) ||
      (input.status === undefined && input.assignedToId === undefined) ||
      (input.status !== undefined &&
        !["assistant", "waiting_staff", "with_staff", "resolved"].includes(
          String(input.status),
        ))
    )
      throw new ChatError("Please check the chat update.");
    const assigned =
      input.assignedToId === undefined || input.assignedToId === null
        ? null
        : members.find((m) => m.id === input.assignedToId);
    if (input.assignedToId != null && !assigned)
      throw new ChatError("Choose an active member of this dealership.");
    return this.store.transaction(this.options.dealerId(), async (tx) => {
      const record = this.record(tx.state, id),
        c = record.conversation;
      if (c.revision !== input.expectedRevision)
        throw new ChatError("This chat changed. Refresh before saving.", 409);
      if (input.status !== undefined)
        c.status = input.status as ChatConversation["status"];
      if (input.assignedToId !== undefined) {
        c.assignedToId = assigned?.id ?? null;
        c.assignedToName = assigned?.name ?? null;
      }
      c.revision++;
      c.updatedAt = this.now().toISOString();
      return this.view(
        record,
        chatAvailability(dealer.hours, tx.state.presence, this.now()),
        true,
      );
    });
  }
  async read(id: string) {
    const dealer = await this.options.dealer();
    return this.store.transaction(this.options.dealerId(), async (tx) => {
      const record = this.record(tx.state, id);
      if (record.conversation.unreadCount) {
        record.conversation.unreadCount = 0;
        record.conversation.revision++;
      }
      return this.view(
        record,
        chatAvailability(dealer.hours, tx.state.presence, this.now()),
        true,
      );
    });
  }
  async presence(id: string, available: unknown) {
    if (typeof available !== "boolean")
      throw new ChatError("Please check your availability.");
    const dealer = await this.options.dealer();
    return this.store.transaction(this.options.dealerId(), async (tx) => {
      tx.state.presence[id] = {
        available,
        expiresAt: new Date(this.now().getTime() + 90_000).toISOString(),
      };
      return {
        staffOnline: chatAvailability(
          dealer.hours,
          tx.state.presence,
          this.now(),
        ).staffOnline,
      };
    });
  }
  async settings(input?: unknown) {
    if (input === undefined)
      return (await this.store.read(this.options.dealerId())).settings;
    if (!input || typeof input !== "object" || Array.isArray(input))
      throw new ChatError("Please check the chat settings.");
    const value = input as Record<string, unknown>;
    const allowed = Object.keys(defaultChatSettings);
    if (Object.keys(value).some((key) => !allowed.includes(key)))
      throw new ChatError("Please check the chat settings.");
    return this.store.transaction(this.options.dealerId(), async (tx) => {
      const next = { ...tx.state.settings, ...value };
      for (const field of [
        "enabled",
        "automaticAnswers",
        "notificationsEnabled",
      ] as const)
        if (typeof next[field] !== "boolean")
          throw new ChatError("Please check the chat settings.");
      next.buttonLabel = text(next.buttonLabel, "the button label", 40);
      next.greeting = text(next.greeting, "the greeting", 600);
      next.offlineMessage = text(
        next.offlineMessage,
        "the offline message",
        600,
      );
      tx.state.settings = next as ChatSettings;
      return tx.state.settings;
    });
  }
}
