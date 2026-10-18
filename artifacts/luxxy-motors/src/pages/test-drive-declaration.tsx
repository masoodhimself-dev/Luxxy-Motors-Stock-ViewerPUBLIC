import { useEffect, useRef, useState } from "react";
import { useRoute } from "wouter";
import {
  CalendarDays,
  CarFront,
  Check,
  FileCheck2,
  LoaderCircle,
  Printer,
  ShieldCheck,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestUuid } from "@/lib/request-uuid";
import {
  declarationTime,
  type PublicTestDriveDeclaration,
} from "@/lib/test-drive-declarations";
import "./test-drive-declaration.css";

/** Deliberately outside the showroom shell, analytics and staff sign-in. */
export default function TestDriveDeclarationPage() {
  const [, params] = useRoute("/test-drive-declaration/:token");
  const token = params?.token ?? "";
  const [record, setRecord] = useState<PublicTestDriveDeclaration>();
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [accepted, setAccepted] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<{ requestId: string; signerName: string } | undefined>(
    undefined,
  );
  const currentToken = useRef(token);
  currentToken.current = token;
  useEffect(() => {
    if (record?.status === "signed") {
      heading.current?.focus({ preventScroll: true });
      heading.current?.scrollIntoView?.({
        block: "start",
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")
          .matches
          ? "auto"
          : "smooth",
      });
    }
  }, [record?.status]);
  async function call(method = "GET", body?: unknown) {
    const response = await fetch(
      `/api/test-drive-declarations/${encodeURIComponent(token)}`,
      {
        method,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(
        data.error ||
          "This declaration is unavailable. Ask the showroom for a new link.",
      ), { status: response.status });
    return data;
  }
  useEffect(() => {
    document.title = "Test-drive declaration";
    const prior = document.querySelector('meta[name="referrer"]');
    const meta = prior ?? document.createElement("meta");
    const old = meta.getAttribute("content");
    meta.setAttribute("name", "referrer");
    meta.setAttribute("content", "no-referrer");
    if (!prior) document.head.appendChild(meta);
    let disposed = false;
    setRecord(undefined);
    setError("");
    setLoading(true);
    setBusy(false);
    setName("");
    setAccepted(false);
    request.current = undefined;
    if (!/^[a-f0-9]{64}$/.test(token)) {
      setError(
        "This link is incomplete. Ask the showroom for a new declaration link.",
      );
      setLoading(false);
    } else
      void call()
        .then((data) => {
          if (!disposed) setRecord(data);
        })
        .catch((cause) => {
          if (!disposed) setError(cause.message);
        })
        .finally(() => {
          if (!disposed) setLoading(false);
        });
    return () => {
      disposed = true;
      if (prior && old !== null) meta.setAttribute("content", old);
      else meta.remove();
    };
  }, [token]);
  async function sign(event: React.FormEvent) {
    event.preventDefault();
    if (
      !record ||
      record.status === "signed" ||
      record.signingEnabled === false ||
      busy ||
      !accepted ||
      name.trim().length < 2
    )
      return;
    setBusy(true);
    setError("");
    // A network retry repeats the same submission. Editing the name starts a new identity.
    const submission =
      request.current?.signerName === name.trim()
        ? request.current
        : { requestId: requestUuid(), signerName: name.trim() };
    request.current = submission;
    try {
      const result = await call("POST", {
        ...submission,
        accepted: true,
        statementVersion: record.statementVersion,
        statementHash: record.statementHash,
      });
      if (currentToken.current === token)
        setRecord({ ...record, status: "signed", signedAt: result.signedAt });
    } catch (cause) {
      if (currentToken.current !== token) return;
      const status = (cause as Error & { status?: number }).status;
      if (status === 403 || status === 409 || status === 410) {
        // A rejected link is not a network retry. Re-read its current state so
        // another device's signature, revocation or expiry removes this form.
        request.current = undefined;
        setAccepted(false);
        try {
          const latest = await call();
          if (currentToken.current !== token) return;
          setRecord(latest);
          setError(latest.status === "signed" ? "" : (cause as Error).message);
        } catch (refreshError) {
          if (currentToken.current !== token) return;
          setRecord(undefined);
          setError((refreshError as Error).message);
        }
      } else setError((cause as Error).message);
    } finally {
      if (currentToken.current === token) setBusy(false);
    }
  }
  const signed = record?.status === "signed";
  return (
    <main className="declaration-page">
      <div className="declaration-shell">
        <header className="declaration-header">
          <FileCheck2 aria-hidden="true" />
          <span>{record?.dealerName || "Your showroom"}</span>
          <span className="declaration-private">
            <ShieldCheck size={16} aria-hidden="true" />
            Private link
          </span>
        </header>
        <section className="declaration-card">
          <p className="declaration-eyebrow">Before your test drive</p>
          <h1 ref={heading} tabIndex={-1}>
            {signed ? "Declaration received" : "A quick check before you drive"}
          </h1>
          {loading && (
            <p role="status" className="declaration-status">
              <LoaderCircle className="animate-spin" aria-hidden="true" />
              Loading your declaration…
            </p>
          )}
          {record && (
            <>
              <div className="declaration-visit">
                <div>
                  <CarFront aria-hidden="true" />
                  <div>
                    <strong>{record.vehicle.title}</strong>
                    {record.vehicle.registration && (
                      <span>{record.vehicle.registration}</span>
                    )}
                  </div>
                </div>
                <div>
                  <CalendarDays aria-hidden="true" />
                  <div>
                    <strong>{declarationTime(record.appointmentAt)}</strong>
                    <span>UK time · {record.durationMinutes} minutes</span>
                  </div>
                </div>
              </div>
              {signed && (
                <div className="declaration-success" role="status">
                  <Check aria-hidden="true" />
                  <div>
                    <strong>Thank you. Your declaration is saved.</strong>
                    <p>
                      {record.signedAt &&
                        `Signed ${declarationTime(record.signedAt)} (UK time). `}
                      The showroom will check your driving licence and insurance
                      arrangements before you drive.
                    </p>
                  </div>
                </div>
              )}
              <h2>Your declaration</h2>
              <div className="declaration-statement">{record.statement}</div>
              <p className="declaration-version">
                Statement {record.statementVersion}
              </p>
              {!signed && record.signingEnabled === false ? <p role="status" className="declaration-error">The showroom has paused new signatures. Your declaration is available to read; contact the showroom before your test drive.</p> : !signed ? (
                <form onSubmit={sign}>
                  <label
                    className="declaration-name"
                    htmlFor="declaration-name"
                  >
                    Your full name
                    <Input
                      id="declaration-name"
                      value={name}
                      autoComplete="name"
                      maxLength={120}
                      minLength={2}
                      required
                      disabled={busy}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </label>
                  <label className="declaration-accept">
                    <input
                      type="checkbox"
                      checked={accepted}
                      required
                      disabled={busy}
                      onChange={(event) => setAccepted(event.target.checked)}
                    />
                    <span>
                      I have read the declaration above and agree to sign it
                      using my typed name.
                    </span>
                  </label>
                  <Button
                    type="submit"
                    disabled={busy || !accepted || name.trim().length < 2}
                  >
                    {busy ? (
                      <>
                        <LoaderCircle
                          className="animate-spin"
                          aria-hidden="true"
                        />
                        Saving declaration…
                      </>
                    ) : (
                      <>
                        <FileCheck2 aria-hidden="true" />
                        Sign declaration
                      </>
                    )}
                  </Button>
                  <p className="declaration-help">
                    This link expires {declarationTime(record.expiresAt)} (UK
                    time). If any car or appointment details are wrong, ask the
                    showroom for a replacement before signing.
                  </p>
                </form>
              ) : (
                <Button
                  className="declaration-print"
                  type="button"
                  variant="outline"
                  onClick={() => window.print()}
                >
                  <Printer aria-hidden="true" />
                  Print confirmation
                </Button>
              )}
            </>
          )}
          {error && (
            <p className="declaration-error" role="alert">
              {error}
            </p>
          )}
          {error && !record && /^[a-f0-9]{64}$/.test(token) && (
            <Button
              type="button"
              variant="outline"
              onClick={() => window.location.reload()}
            >
              Try again
            </Button>
          )}
          <footer className="declaration-note">
            Keep this link private. Signing records your acknowledgement; the
            showroom must still check that you can drive this vehicle.
          </footer>
        </section>
      </div>
    </main>
  );
}
