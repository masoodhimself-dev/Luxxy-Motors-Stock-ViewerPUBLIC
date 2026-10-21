import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { QrCode } from "@/components/icons";
import "./share-qr.css";
export type PhoneShareSource =
  | {
      kind: "document";
      saleId: string;
      documentId: string;
      taxReference?: string;
    }
  | { kind: "enquiry"; enquiryId: string; draft: unknown; previewHash: string };
export function ShareQr({
  url,
  source,
  label = "Share by QR",
  disabled = false,
  beforeGenerate,
}: {
  url?: string;
  source?: PhoneShareSource;
  label?: string;
  disabled?: boolean;
  beforeGenerate?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false),
    [grant, setGrant] = useState<{
      id?: string;
      url: string;
      expiresAt?: string;
      preview?: boolean;
    } | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const attempt = useRef<{ requestId: string; token: string } | null>(null);
  const identity = JSON.stringify(source ?? url);
  const current = useRef(identity);
  current.current = identity;
  useEffect(() => {
    setGrant(null);
    attempt.current = null;
    setError("");
    setNotice("");
  }, [identity]);
  async function generate() {
    setOpen(true);
    setError("");
    setNotice("");
    if (grant || busy) return;
    const key = identity;
    if (url) {
      try {
        const parsed = new URL(url, window.location.origin);
        if (!["http:", "https:"].includes(parsed.protocol)) throw new Error();
        setGrant({ url: parsed.href });
      } catch {
        setError("This link is not available.");
      }
      return;
    }
    if (!source) return;
    setBusy(true);
    try {
      await beforeGenerate?.();
      if (!attempt.current) {
        const bytes = crypto.getRandomValues(new Uint8Array(32));
        attempt.current = {
          requestId: crypto.randomUUID(),
          token: Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join(
            "",
          ),
        };
      }
      const created = await customFetch<{
        id: string;
        url: string;
        expiresAt: string;
        preview?: boolean;
      }>("/api/staff/phone-shares", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...attempt.current, source }),
      });
      if (current.current === key) setGrant(created);
    } catch (cause) {
      if (current.current === key)
        setError(
          cause instanceof Error
            ? cause.message
            : "The QR code could not be created. Nothing was sent.",
        );
    } finally {
      setBusy(false);
    }
  }
  async function revoke() {
    if (!grant?.id) return;
    setBusy(true);
    try {
      await customFetch(`/api/staff/phone-shares/${grant.id}/revoke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      setGrant(null);
      attempt.current = null;
      setNotice("Link revoked. It can no longer be opened.");
    } catch {
      setError("Could not revoke the link. Try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        disabled={disabled}
        onClick={() => void generate()}
      >
        <QrCode size={17} />
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="phone-share-dialog">
          <DialogHeader>
            <DialogTitle>Share from your phone</DialogTitle>
            <DialogDescription>
              Scan this code with your phone camera. Review the content, then
              choose how to share it with the customer. Nothing is sent
              automatically.
            </DialogDescription>
          </DialogHeader>
          {busy && <p role="status">Preparing sharing link…</p>}
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
          {grant && (
            <>
              {grant.preview && (
                <p>
                  Fictional local preview only. No real customer document is
                  shared.
                </p>
              )}
              <div className="phone-share-qr">
                <QRCodeSVG
                  value={grant.url}
                  size={220}
                  marginSize={4}
                  title="Scan to open the sharing preview"
                />
              </div>
              <p>
                {grant.expiresAt
                  ? `Private link · expires ${new Date(grant.expiresAt).toLocaleString("en-GB")}. Anyone with this link can view this sharing pack until it expires or is revoked.`
                  : "Anyone with this link can open it. Check the recipient before forwarding."}
              </p>
              <div className="phone-share-actions">
                <Button
                  variant="outline"
                  onClick={() =>
                    void navigator.clipboard
                      .writeText(grant.url)
                      .then(() => setNotice("Link copied."))
                      .catch(() =>
                        setError(
                          "Copy is unavailable. Open the preview and copy its address.",
                        ),
                      )
                  }
                >
                  Copy link
                </Button>
                <a
                  className="phone-share-open"
                  href={grant.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open preview
                </a>
                {grant.id && (
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() => void revoke()}
                  >
                    Revoke link
                  </Button>
                )}
              </div>
            </>
          )}
          {!grant && !busy && source && (
            <Button onClick={() => void generate()}>Create sharing link</Button>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
