import { dealerFeatureEnabled } from "./dealer-features";
import { multiTenantEnabled } from "./tenant-context";
import { demoEmailEnvelope } from "./demo-policy";
import {
  defaultEmailTemplates,
  renderEmailTemplate,
  type EmailFacts,
  type EmailLayoutVersion,
} from "@workspace/vehicle-meta";
import {
  dealerIntegrationsStore,
  effectiveResendSettings,
  integrationReadiness,
  type ResendSettings,
} from "./dealer-integrations-store";
import { createHash } from "node:crypto";
import { serviceLifecycle } from "./service-lifecycle";

/** Preserve only the status, never the provider response body or credentials. */
export class EmailProviderError extends Error {
  constructor(
    readonly httpStatus: number,
    readonly retryAfterSeconds: number | null = null,
    readonly providerCode: string | null = null,
    readonly attempted = true,
  ) {
    super(`Email provider returned HTTP ${httpStatus}.`);
    this.name = "EmailProviderError";
  }
}

export type EmailRequest = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  idempotencyKey: string;
  attachments?: Array<{ filename: string; content: string }>;
};
export type EmailEnvelope = {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text?: string;
  reply_to?: string;
  attachments?: Array<{ filename: string; content: string }>;
};
export const emailAccountHash = (config: Pick<ResendSettings, "apiKey">) =>
  createHash("sha256").update(config.apiKey).digest("hex");

export function classifyEmailFailure(error: unknown) {
  const status =
    error instanceof EmailProviderError
      ? error.httpStatus
      : error instanceof Error
        ? Number(
            /^Email provider returned HTTP (\d{3})\.$/.exec(error.message)?.[1],
          )
        : 0;
  const concurrent =
    error instanceof EmailProviderError &&
    error.providerCode === "concurrent_idempotent_requests";
  if (
    status === 429 ||
    [500, 502, 503, 504].includes(status) ||
    (status === 409 && concurrent)
  )
    return {
      kind: "retryable" as const,
      retryAfterSeconds:
        error instanceof EmailProviderError ? error.retryAfterSeconds : null,
    };
  if (status >= 400 && status < 500 && status !== 408 && status !== 409)
    return { kind: "permanent" as const, retryAfterSeconds: null };
  return { kind: "unknown" as const, retryAfterSeconds: null };
}

export function emailRetryAfter(
  value: string | null,
  now = Date.now(),
): number | null {
  if (!value) return null;
  const seconds = /^\d+$/.test(value.trim())
    ? Number(value)
    : (Date.parse(value) - now) / 1000;
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(86400, Math.max(1, Math.ceil(seconds)))
    : null;
}

async function providerCode(response: Response) {
  if (!response.body) return null;
  const reader = response.body.getReader();
  let bytes = 0,
    value = "";
  try {
    const decoder = new TextDecoder();
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 4096) {
        await reader.cancel();
        return null;
      }
      value += decoder.decode(part.value, { stream: true });
    }
    const name = JSON.parse(value)?.name;
    return [
      "concurrent_idempotent_requests",
      "invalid_idempotent_request",
    ].includes(name)
      ? String(name)
      : null;
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

// Bound every local provider call, including older invoice/demo callers. The
// durable outbox also reserves an account slot across processes before retries.
let providerActive = 0;
let nextProviderSend = 0;
const nextAccountSend = new Map<string, number>();
function pacedProvider<T>(account: string, work: () => Promise<T>): Promise<T> {
  if (providerActive >= 2)
    return Promise.reject(
      new EmailProviderError(503, 15, "local_capacity", false),
    );
  providerActive++;
  return (async () => {
    try {
      const previous = nextAccountSend.get(account) ?? 0;
      const startAt = Math.max(Date.now(), previous, nextProviderSend);
      if (startAt - Date.now() > 1100)
        throw new EmailProviderError(503, 15, "local_capacity", false);
      nextProviderSend = startAt + 1000;
      nextAccountSend.set(account, startAt + 1000);
      // Expired entries contain only one-way credential hashes and are bounded.
      if (nextAccountSend.size > 1000)
        for (const [key, at] of nextAccountSend)
          if (at < Date.now()) nextAccountSend.delete(key);
      if (startAt > Date.now())
        await new Promise((r) => setTimeout(r, startAt - Date.now()));
      return await work();
    } finally {
      providerActive--;
    }
  })();
}

/** Resolve demo routing once, before persisting the immutable approved envelope. */
export async function prepareEmailWithSettings(
  config: ResendSettings,
  request: EmailRequest,
  executor?: unknown,
) {
  const envelope = await demoEmailEnvelope(request, config, executor);
  config = envelope.config;
  request = { ...request, ...envelope.request };
  if (!config.enabled)
    throw new Error(
      "Email delivery is disabled. Configure and enable Resend in integration settings.",
    );
  if (
    !integrationReadiness({
      resend: config,
      stripe: {
        enabled: false,
        mode: "test",
        publishableKey: "",
        secretKey: "",
        webhookSecret: "",
      },
    }).resend.ready
  )
    throw new Error(
      "Configure RESEND_API_KEY and RESEND_FROM_EMAIL or complete the private Resend settings before sending email.",
    );
  if (
    !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(request.to) ||
    !request.subject.trim() ||
    request.subject.length > 200 ||
    /[\r\n\u0000-\u001f]/.test(request.subject)
  )
    throw new Error("The email recipient or subject is invalid.");
  const body: EmailEnvelope = {
    from: config.from,
    to: [request.to],
    subject: request.subject,
    html: request.html,
    ...(request.text ? { text: request.text } : {}),
    ...(config.replyTo ? { reply_to: config.replyTo } : {}),
    ...(request.attachments?.length
      ? { attachments: request.attachments }
      : {}),
  };
  return { config, body };
}

/** Send the exact stored bytes; never re-render or re-route an outbox retry. */
export function sendPreparedEmail(
  config: ResendSettings,
  serializedBody: string,
  idempotencyKey: string,
  transport: typeof fetch = fetch,
): Promise<string> {
  return serviceLifecycle.track(() =>
    pacedProvider(emailAccountHash(config), async () => {
      // Recheck at the final provider boundary, including durable outbox retries.
      // Missing tenant context also fails closed in the shared installation.
      if (multiTenantEnabled()) {
        try {
          if (!(await dealerFeatureEnabled("customerEmails")))
            throw new EmailProviderError(503, 60, "feature_disabled", false);
        } catch (error) {
          if (error instanceof EmailProviderError) throw error;
          throw new EmailProviderError(
            503,
            60,
            "feature_policy_unavailable",
            false,
          );
        }
      }
      let response: Response;
      try {
        response = await transport("https://api.resend.com/emails", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(15_000),
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": idempotencyKey,
          },
          body: serializedBody,
        });
      } catch {
        throw new Error("Email provider connection failed.");
      }
      if (!response.ok)
        throw new EmailProviderError(
          response.status,
          emailRetryAfter(response.headers.get("retry-after")),
          await providerCode(response),
        );
      let result: { id?: unknown };
      try {
        result = (await response.json()) as { id?: unknown };
      } catch {
        throw new Error("Email provider acceptance could not be confirmed.");
      }
      if (!result.id || typeof result.id !== "string")
        throw new Error("Email provider did not return a delivery identifier.");
      return result.id;
    }),
  );
}

/** Transport is injectable so readiness and tests never send an email. */
export function sendEmailWithSettings(
  config: ResendSettings,
  request: EmailRequest,
  transport: typeof fetch = fetch,
): Promise<string> {
  return serviceLifecycle.track(async () => {
    const prepared = await prepareEmailWithSettings(config, request);
    return sendPreparedEmail(
      prepared.config,
      JSON.stringify(prepared.body),
      request.idempotencyKey,
      transport,
    );
  });
}
async function resendSettings(): Promise<ResendSettings> {
  const saved = await dealerIntegrationsStore.readPrivate();
  // Environment provisioning is explicit too, and applies only before the owner saves settings.
  return effectiveResendSettings(saved);
}
export async function renderDealerEmail(input: {
  templateId: string;
  layoutVersion?: EmailLayoutVersion;
  variables: Record<string, string | number | null | undefined>;
  facts: EmailFacts;
  attachments?: Array<{ filename: string; content: string }>;
}) {
  const { templates, appearance } =
    await dealerIntegrationsStore.listTemplates();
  const template = templates.find((item) => item.id === input.templateId);
  if (
    !template ||
    !defaultEmailTemplates.some((item) => item.id === input.templateId)
  )
    throw new Error("This email template is unavailable.");
  return renderEmailTemplate(
    template,
    input.variables,
    input.facts,
    appearance,
    {
      templateId: input.templateId,
      layoutVersion: input.layoutVersion,
      attachments: input.attachments?.map((item) => item.filename),
    },
  );
}
export async function sendTemplatedEmail(input: {
  templateId: string;
  to: string;
  variables: Record<string, string | number | null | undefined>;
  facts: EmailFacts;
  idempotencyKey: string;
  attachments?: Array<{ filename: string; content: string }>;
}): Promise<string> {
  const rendered = await renderDealerEmail(input);
  return sendEmailWithSettings(await resendSettings(), {
    ...rendered,
    to: input.to,
    idempotencyKey: input.idempotencyKey,
    attachments: input.attachments,
  });
}
/** Direct Resend transport. Never depends on hosting-provider credentials. */
export async function sendEmail(
  to: string,
  subject: string,
  html: string,
  idempotencyKey: string,
  _dealerName: string,
  attachments?: Array<{ filename: string; content: string }>,
  text?: string,
) {
  return sendEmailWithSettings(await resendSettings(), {
    to,
    subject,
    html,
    text,
    idempotencyKey,
    attachments,
  });
}
