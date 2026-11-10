import { useEffect, useRef, useState } from "react";
import type { Enquiry } from "@workspace/api-client-react";
import { Mail, MessageCircle, Phone } from "@/components/icons";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { ConversationEditor } from "./enquiry-conversation";
import {
  EnquiryEmailComposer,
  type ReplyInsertion,
} from "./enquiry-email-composer";
import "./enquiry-reply-desk.css";

type ReplyDeskProps = {
  entry: Enquiry;
  insertion?: ReplyInsertion;
  onSaved: (entry: Enquiry) => void | Promise<void>;
  focusRequest?: number;
  requestedChannel?: "email" | "whatsapp" | "note";
  onBusyChange?: (busy: boolean) => void;
  compact?: boolean;
  allowMissingRecipient?: boolean;
  editRecipientRequest?: number;
  enquiryReplyId?: string;
};
export function EnquiryReplyDesk(props: ReplyDeskProps) {
  return <ReplyDesk key={props.entry.id} {...props} />;
}
function ReplyDesk({
  entry,
  insertion,
  onSaved,
  focusRequest = 0,
  requestedChannel = "email",
  onBusyChange,
  compact = false,
  allowMissingRecipient = false,
  editRecipientRequest = 0,
  enquiryReplyId,
}: ReplyDeskProps) {
  const defaultChannel = (requested: "email" | "whatsapp" | "note") =>
    requested === "email" && !allowMissingRecipient && !entry.email?.trim() ? "note" : requested;
  const [channel, setChannel] = useState<"email" | "whatsapp" | "note">(() =>
    defaultChannel(requestedChannel),
  );
  const [noteVersion, setNoteVersion] = useState(0);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [emailVersion, setEmailVersion] = useState(0);
  const [completedInsertion, setCompletedInsertion] = useState<number>();
  const container = useRef<HTMLElement>(null);
  const handledFocus = useRef(0);
  const handledInsertion = useRef<number | undefined>(undefined);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    if (!focusRequest || busy || handledFocus.current === focusRequest) return;
    handledFocus.current = focusRequest;
    setChannel(defaultChannel(requestedChannel));
    requestAnimationFrame(() =>
      container.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      }),
    );
  }, [focusRequest, requestedChannel, allowMissingRecipient, busy]);
  useEffect(() => {
    if (insertion && !busy && handledInsertion.current !== insertion.id) {
      handledInsertion.current = insertion.id;
      if (channel === "note") setChannel("email");
    }
  }, [insertion, busy]);
  return (
    <section
      ref={container}
      className={`enquiry-reply-desk${compact ? " enquiry-reply-compact" : ""}`}
      aria-label="Reply and staff notes"
    >
      {!compact && <header><h4>Reply</h4></header>}
      {compact ? <label className="enquiry-reply-channel-select"><span className="sr-only">Reply channel</span><NativeSelect aria-label="Reply channel" disabled={busy} value={channel} onChange={event=>{setChannel(event.target.value as typeof channel);setNotice("");}}><option value="email">Email</option><option value="whatsapp">WhatsApp</option><option value="note">Private note</option></NativeSelect></label> : <div
        className="enquiry-reply-channels"
        role="group"
        aria-label="Reply channel"
      >
        {(
          [
            { id: "email", label: "Email", icon: Mail },
            { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
            { id: "note", label: "Note", icon: Phone },
          ] as const
        ).map((item) => (
          <Button
            key={item.id}
            disabled={busy}
            size="sm"
            variant={channel === item.id ? "default" : "ghost"}
            aria-pressed={channel === item.id}
            onClick={() => {
              setChannel(item.id);
              setNotice("");
            }}
          >
            <item.icon aria-hidden size={16} />
            {item.label}
          </Button>
        ))}
      </div>}
      <div className="enquiry-reply-editor">
        <div hidden={channel === "note"}>
          <EnquiryEmailComposer
            key={emailVersion}
            inline
            compact={compact}
            entry={entry}
            customerPhone={entry.phone}
            editRecipientRequest={editRecipientRequest}
            linkedReply={allowMissingRecipient}
            enquiryReplyId={enquiryReplyId}
            channel={channel === "whatsapp" ? "whatsapp" : "email"}
            insertion={
              insertion?.id === completedInsertion ? undefined : insertion
            }
            onBusyChange={setBusy}
            onChooseEmail={() => setChannel("email")}
            onClose={(result) => {
              setNotice(
                result === "sent"
                  ? "Email submitted. Its saved status is in the conversation."
                  : "Saved draft kept with this enquiry.",
              );
              if (result === "sent") {
                setCompletedInsertion(insertion?.id);
                setEmailVersion((value) => value + 1);
              }
            }}
          />
        </div>
        <div hidden={channel !== "note"}>
          <ConversationEditor
            key={noteVersion}
            inline
            entry={entry}
            onClose={() => {
              setChannel(defaultChannel("email"));
              setNotice("");
            }}
            onSaved={async (updated) => {
              await onSaved(updated);
              setNoteVersion((value) => value + 1);
              setNotice("Conversation saved to this enquiry.");
            }}
          />
        </div>
      </div>
      {notice && (
        <p role="status" className="enquiry-reply-notice">
          {notice}
        </p>
      )}
    </section>
  );
}
