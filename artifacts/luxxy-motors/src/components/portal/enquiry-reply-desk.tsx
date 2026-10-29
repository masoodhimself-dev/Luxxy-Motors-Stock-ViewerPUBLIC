import { useEffect, useRef, useState } from "react";
import type { Enquiry } from "@workspace/api-client-react";
import { Mail, MessageCircle, Phone } from "@/components/icons";
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
}: ReplyDeskProps) {
  const [channel, setChannel] = useState<"email" | "whatsapp" | "note">(
    requestedChannel,
  );
  const [opened, setOpened] = useState(false);
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
    setOpened(true);
    setChannel(requestedChannel);
    requestAnimationFrame(() =>
      container.current?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      }),
    );
  }, [focusRequest, requestedChannel, busy]);
  useEffect(() => {
    if (insertion && !busy && handledInsertion.current !== insertion.id) {
      handledInsertion.current = insertion.id;
      setOpened(true);
      if (channel === "note") setChannel("email");
    }
  }, [insertion, busy]);
  return (
    <section
      ref={container}
      className="enquiry-reply-desk"
      aria-label="Reply and staff notes"
    >
      <header>
        <div>
          <h4>Reply &amp; next step</h4>
          <p>
            {entry.reference} · {entry.vehicleTitle || "General enquiry"}
          </p>
        </div>
        {!opened && (
          <Button size="sm" onClick={() => setOpened(true)}>
            Write a reply
          </Button>
        )}
      </header>
      <div
        className="enquiry-reply-channels"
        role="group"
        aria-label="Reply channel"
      >
        {(
          [
            { id: "email", label: "Email", icon: Mail },
            { id: "whatsapp", label: "WhatsApp", icon: MessageCircle },
            { id: "note", label: "Call / private note", icon: Phone },
          ] as const
        ).map((item) => (
          <Button
            key={item.id}
            disabled={busy}
            size="sm"
            variant={channel === item.id && opened ? "default" : "outline"}
            aria-pressed={channel === item.id && opened}
            onClick={() => {
              setOpened(true);
              setChannel(item.id);
              setNotice("");
            }}
          >
            <item.icon aria-hidden size={16} />
            {item.label}
          </Button>
        ))}
      </div>
      {opened && (
        <>
          <div hidden={channel === "note"}>
            <EnquiryEmailComposer
              key={emailVersion}
              inline
              entry={entry}
              customerPhone={entry.phone}
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
                setChannel("email");
                setNotice("");
              }}
              onSaved={async (updated) => {
                await onSaved(updated);
                setNoteVersion((value) => value + 1);
                setNotice("Conversation saved to this enquiry.");
              }}
            />
          </div>
        </>
      )}
      {notice && (
        <p role="status" className="enquiry-reply-notice">
          {notice}
        </p>
      )}
    </section>
  );
}
