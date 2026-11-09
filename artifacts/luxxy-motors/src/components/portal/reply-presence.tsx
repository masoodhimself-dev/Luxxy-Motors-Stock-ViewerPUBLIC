import { useEffect, useRef, useState, type RefObject } from "react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import "./workspace-tools.css";
type Presence = { name: string; expiresAt: string; mine: boolean } | null;
/** Awareness only. Existing send/revision checks remain authoritative. */
export function ReplyPresence({
  enquiryId,
  scope,
  enabled,
}: {
  enquiryId: string;
  scope: RefObject<HTMLElement | null>;
  enabled: boolean;
}) {
  const [presence, setPresence] = useState<Presence>(null),
    [unavailable, setUnavailable] = useState(false),
    [confirm, setConfirm] = useState(false),
    [busy, setBusy] = useState(false);
  const session = useRef(crypto.randomUUID()),
    active = useRef(0),
    request = useRef(0),
    serial = useRef(0);
  useEffect(() => {
    setPresence(null);
    setConfirm(false);
    setUnavailable(false);
    setBusy(false);
    active.current = 0;
    serial.current++;
    if (
      !enabled ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(enquiryId)
    )
      return;
    const controller = new AbortController(),
      current = ++request.current;
    const url = `/api/staff/workspace/presence/${enquiryId}`;
    let lastClaim = 0;
    const update = async (claim = false) => {
      const ordinal = ++serial.current;
      if (claim) lastClaim = Date.now();
      try {
        const data = await customFetch<{ presence: Presence }>(
          claim ? url : `${url}?session=${session.current}`,
          {
            signal: controller.signal,
            ...(claim
              ? {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ session: session.current }),
                }
              : {}),
          },
        );
        if (current === request.current && ordinal === serial.current) {
          setPresence(data.presence);
          setUnavailable(false);
        }
      } catch {
        if (!controller.signal.aborted && current === request.current)
          setUnavailable(true);
      }
    };
    const editing = (e: Event) => {
      const target = e.target;
      if (
        target instanceof Element &&
        target.closest(
          ".enquiry-reply-desk,.enquiry-email-form,.enquiry-conversation-form",
        )
      ) {
        active.current = Date.now();
        if (Date.now() - lastClaim >= 20_000) void update(true);
      }
    };
    const root = scope.current;
    root?.addEventListener("focusin", editing);
    root?.addEventListener("input", editing);
    void update();
    const timer = setInterval(() => {
      if (document.visibilityState !== "hidden")
        void update(Date.now() - active.current < 60_000);
    }, 25_000);
    const expiry = setInterval(
      () =>
        setPresence((p) =>
          p && Date.parse(p.expiresAt) <= Date.now() ? null : p,
        ),
      1000,
    );
    return () => {
      request.current++;
      serial.current++;
      controller.abort();
      clearInterval(timer);
      clearInterval(expiry);
      root?.removeEventListener("focusin", editing);
      root?.removeEventListener("input", editing);
      void customFetch(url, {
        method: "DELETE",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ session: session.current }),
      }).catch(() => {});
    };
  }, [enquiryId, enabled, scope]);
  async function takeover() {
    const generation = request.current,
      ordinal = ++serial.current;
    setBusy(true);
    try {
      const data = await customFetch<{ presence: Presence }>(
        `/api/staff/workspace/presence/${enquiryId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session: session.current, takeover: true }),
        },
      );
      if (generation !== request.current || ordinal !== serial.current) return;
      setPresence(data.presence);
      active.current = Date.now();
      setConfirm(false);
      setUnavailable(false);
    } catch {
      if (generation === request.current) setUnavailable(true);
    } finally {
      if (generation === request.current) setBusy(false);
    }
  }
  if (!enabled || (!presence && !unavailable)) return null;
  return (
    <aside className="workspace-reply-presence" role="status">
      {unavailable ? (
        <p>
          Staff reply status is unavailable. Check with your team before
          sending.
        </p>
      ) : presence?.mine ? (
        <p>You are preparing a reply. Other staff can see this.</p>
      ) : (
        <>
          <p>
            <strong>{presence?.name}</strong> is preparing a reply. Coordinate
            before sending; this does not lock the conversation.
          </p>
          {confirm ? (
            <>
              <Button size="sm" disabled={busy} onClick={() => void takeover()}>
                {busy ? "Taking over…" : "Confirm take over"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setConfirm(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setConfirm(true)}
            >
              Take over
            </Button>
          )}
        </>
      )}
    </aside>
  );
}
