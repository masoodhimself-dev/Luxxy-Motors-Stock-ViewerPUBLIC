import { useRef, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import {
  canonicalCustomerEmail,
  saleCustomerUpdates,
  type SaleCustomerUpdateKind,
  type SaleCustomerUpdateMessage,
  type SaleWorkspaceRecord,
} from "@workspace/vehicle-meta";
import { Copy, Mail, MessageSquare, Printer } from "@/components/icons";
import { InternalShareEmail } from "@/components/internal-share-email";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { NativeSelect } from "@/components/ui/native-select";
import { useDealerSettings } from "@/lib/dealer-settings-context";

type Review = { revision: number; email: string; updates: SaleCustomerUpdateMessage[] };

const changedUpdateError = () => {
  const message = "The sale changed. Reopen it and review the customer update before sharing.";
  return Object.assign(new Error(message), { data: { error: message } });
};

function printUpdate(popup: Window, update: SaleCustomerUpdateMessage) {
  const doc = popup.document;
  const style = doc.createElement("style");
  style.textContent = "@page{size:A4;margin:22mm}body{margin:24px;color:#182334;font:14pt/1.5 system-ui,sans-serif}h1{font-size:21pt;margin:0 0 22pt}p{white-space:pre-wrap;overflow-wrap:anywhere}@media print{body{margin:0}}";
  const heading = doc.createElement("h1");
  heading.textContent = update.subject;
  const body = doc.createElement("p");
  body.textContent = update.message;
  doc.title = update.subject;
  doc.head.append(style);
  doc.body.replaceChildren(heading, body);
  popup.focus();
  popup.print();
}

export function SaleCustomerUpdate({ sale, canEmail, disabled }: {
  sale: SaleWorkspaceRecord;
  canEmail: boolean;
  disabled?: boolean;
}) {
  const { settings } = useDealerSettings();
  const updates = saleCustomerUpdates(sale, settings.identity.name);
  const [review, setReview] = useState<Review | null>(null);
  const [selection, setSelection] = useState<SaleCustomerUpdateKind>();
  const [emailOpen, setEmailOpen] = useState(false);
  const [sharing, setSharing] = useState<"copy" | "print" | null>(null);
  const [notice, setNotice] = useState("");
  const [problem, setProblem] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
  const messageText = useRef<HTMLParagraphElement>(null);
  const openingEmail = useRef(false);
  const shareLock = useRef(false);
  const update = review?.updates.find(option => option.kind === selection) ?? review?.updates[0];
  const stale = Boolean(review && (review.revision !== sale.revision || disabled));

  function open() {
    setNotice("");
    setProblem("");
    setSelection(undefined);
    setReview({ revision: sale.revision, email: canonicalCustomerEmail(sale.draft.email), updates });
  }
  function close() {
    setReview(null);
    setEmailOpen(false);
  }
  function restoreFocus(event: Event) {
    if (openingEmail.current) {
      event.preventDefault();
      return;
    }
    const target = opener.current;
    if (!target?.isConnected || target.disabled) return;
    event.preventDefault();
    target.focus({ preventScroll: true });
  }
  async function verifySavedUpdate() {
    if (!review || stale) throw changedUpdateError();
    const { sale: latest } = await customFetch<{ sale: SaleWorkspaceRecord }>(`/api/sale-workspace/${encodeURIComponent(sale.id)}`);
    const currentUpdate = saleCustomerUpdates(latest, settings.identity.name).find(option => option.kind === update?.kind);
    if (latest.revision !== review.revision || canonicalCustomerEmail(latest.draft.email) !== review.email ||
        currentUpdate?.message !== update?.message) {
      throw changedUpdateError();
    }
  }
  async function copy(update: SaleCustomerUpdateMessage) {
    await share("copy", async () => {
      // Safari requires the clipboard write to begin with the click. Its data
      // promise resolves only when the saved sale still matches the review.
      const current = verifySavedUpdate();
      let clipboard: Promise<void> | undefined;
      try {
        if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
          const text = current.then(() => new Blob([update.message], { type: "text/plain" }));
          void text.catch(() => {});
          clipboard = navigator.clipboard.write([new ClipboardItem({
            "text/plain": text,
          })]);
          void clipboard.catch(() => {});
        }
      } catch { /* The selectable preview remains available after verification. */ }
      await current;
      try {
        await (clipboard ?? navigator.clipboard.writeText(update.message));
        setNotice("Message copied. Paste it into the customer’s WhatsApp chat.");
        return;
      } catch { /* Use manual copy on restricted browsers. */ }
      const text = messageText.current;
      const selectedText = window.getSelection();
      if (text && selectedText) {
        text.focus({ preventScroll: true });
        const range = document.createRange();
        range.selectNodeContents(text);
        selectedText.removeAllRanges();
        selectedText.addRange(range);
      }
      setProblem("Copy the selected message, then paste it into WhatsApp.");
    });
  }
  async function print(update: SaleCustomerUpdateMessage) {
    await share("print", async () => {
      const popup = window.open("about:blank", "_blank");
      if (!popup) throw new Error("Allow the print window to open, then try again.");
      popup.opener = null;
      try {
        await verifySavedUpdate();
        if (!popup.closed) printUpdate(popup, update);
      } catch (error) {
        popup.close();
        throw error;
      }
    });
  }
  async function share(action: "copy" | "print", run: () => Promise<void>) {
    if (shareLock.current || stale) return;
    shareLock.current = true;
    setSharing(action);
    setNotice("");
    setProblem("");
    try {
      await run();
    } catch (error) {
      setProblem((error as { data?: { error?: string } })?.data?.error ||
        (error instanceof Error && error.message.startsWith("Allow the print window") ? error.message : "Could not check the current sale. Reopen it before sharing."));
    } finally {
      shareLock.current = false;
      setSharing(null);
    }
  }
  return <>
    {updates.length > 0 && <Button ref={opener} variant="outline" disabled={disabled} onClick={open}>
      <MessageSquare size={16} aria-hidden="true" />Customer update
    </Button>}
    {review && update && !emailOpen && <Dialog open onOpenChange={value => { if (!value && !shareLock.current) close(); }}>
      <DialogContent className="portal-action-dialog sales-action-dialog max-w-xl" closeDisabled={Boolean(sharing)} onCloseAutoFocus={restoreFocus} onOpenAutoFocus={event => {
        event.preventDefault();
        (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-popup-title]")?.focus({ preventScroll: true });
      }}>
        <DialogHeader>
          <DialogTitle>Customer update</DialogTitle>
          <DialogDescription>Review the message before sharing it with {sale.draft.customer}.</DialogDescription>
        </DialogHeader>
        <div className="grid min-w-0 gap-4">
          {review.updates.length > 1 && <label className="grid gap-2 text-sm font-semibold">
            Update
            <NativeSelect value={update.kind} disabled={Boolean(sharing)} onChange={event => { setSelection(event.target.value as SaleCustomerUpdateKind); setNotice(""); setProblem(""); }}>
              {review.updates.map(option => <option key={option.kind} value={option.kind}>{option.label}</option>)}
            </NativeSelect>
          </label>}
          <section aria-label={update.label} className="grid min-w-0 gap-2">
            <h3 className="text-sm font-semibold">{update.label}</h3>
            <p ref={messageText} tabIndex={-1} className="select-text whitespace-pre-wrap rounded-md border border-border bg-muted/25 p-3 text-sm leading-relaxed [overflow-wrap:anywhere]">{update.message}</p>
          </section>
          {review.email && canEmail && <p className="text-sm text-muted-foreground [overflow-wrap:anywhere]">Email to {review.email}</p>}
          {stale && <p role="alert">The sale changed. Reopen the update to review the latest details.</p>}
          {problem && <p role="alert">{problem}</p>}
          {notice && <p role="status">{notice}</p>}
        </div>
        <DialogFooter className="grid grid-cols-1 items-stretch gap-2 sm:grid-cols-[1fr_auto_auto]">
          <Button size="sm" disabled={!canEmail || !review.email || stale || Boolean(sharing)} onClick={() => {
            openingEmail.current = true;
            setEmailOpen(true);
          }}>
            <Mail size={16} aria-hidden="true" />Review email
          </Button>
          <Button size="sm" variant="outline" disabled={stale || Boolean(sharing)} onClick={() => void copy(update)}>
            <Copy size={16} aria-hidden="true" />{sharing === "copy" ? "Checking sale…" : "Copy for WhatsApp"}
          </Button>
          <Button size="sm" variant="outline" disabled={stale || Boolean(sharing)} onClick={() => void print(update)}>
            <Printer size={16} aria-hidden="true" />{sharing === "print" ? "Checking sale…" : "Print update"}
          </Button>
        </DialogFooter>
        {!review.email && <p className="text-sm text-muted-foreground">Add the customer’s email to the sale to use email.</p>}
        {review.email && !canEmail && <p className="text-sm text-muted-foreground">Email is unavailable for this sale. You can copy or print the update.</p>}
      </DialogContent>
    </Dialog>}
    {review && update && emailOpen && <InternalShareEmail open onOpenChange={value => {
      if (value) return;
      openingEmail.current = false;
      close();
      requestAnimationFrame(() => opener.current?.focus({ preventScroll: true }));
    }}
      subject={update.subject} message={update.message} saleId={sale.id} customerName={sale.draft.customer}
      customerEmail={review.email} fixedRecipient={review.email} customerPhone={sale.draft.phone}
      saleUpdate={{ saleId: sale.id, revision: review.revision, kind: update.kind }}
      verifyBeforePrepare={verifySavedUpdate} />}
  </>;
}
