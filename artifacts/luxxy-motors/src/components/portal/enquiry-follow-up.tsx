import { useRef, useState, type RefObject } from "react";
import {
  useChangeStaffFollowUp,
  type Enquiry,
} from "@workspace/api-client-react";
import { localDateTimeToUtc } from "../../../../api-server/src/lib/booking-slots";
import { londonDate, appointmentLabel } from "@/lib/test-drive-dates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { usePopupDraftGuard } from "./popup-draft-guard";

export function followUpLocal(value: string) {
  const date = new Date(value);
  return `${londonDate(date)}T${new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date)}`;
}
export function followUpIso(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const [date, time] = value.split("T");
  const [hour, minute] = time.split(":").map(Number);
  const result = localDateTimeToUtc(date, hour, minute);
  if (
    !Number.isFinite(result.getTime()) ||
    followUpLocal(result.toISOString()) !== value
  )
    return null;
  return result.toISOString();
}
export function FollowUpFields({
  time,
  note,
  onTime,
  onNote,
  noteMaxLength = 1000,
  timeRef,
  invalid,
}: {
  time: string;
  note: string;
  onTime: (value: string) => void;
  onNote: (value: string) => void;
  noteMaxLength?: number;
  timeRef?: RefObject<HTMLInputElement | null>;
  invalid?: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-sm border border-border bg-muted/30 p-3">
      <label className="grid gap-1.5 text-sm font-medium">
        Follow-up date and time
        <Input
          ref={timeRef}
          type="datetime-local"
          required
          aria-invalid={invalid || undefined}
          value={time}
          onChange={(e) => onTime(e.target.value)}
        />
      </label>
      <label className="grid gap-1.5 text-sm font-medium">
        Follow-up note (optional)
        <Textarea
          rows={2}
          maxLength={noteMaxLength}
          value={note}
          onChange={(e) => onNote(e.target.value)}
          placeholder="For example: call back about the service history"
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Creates a staff task in the follow-up queue. No message is sent to the
        customer.
      </p>
    </div>
  );
}
export function FollowUpEditor({
  entry,
  onClose,
  onSaved,
}: {
  entry: Enquiry;
  onClose: () => void;
  onSaved: (entry: Enquiry) => void | Promise<void>;
}) {
  const [time, setTime] = useState(
    entry.followUpAt ? followUpLocal(entry.followUpAt) : "",
  );
  const [note, setNote] = useState(entry.followUpNote ?? "");
  const [error, setError] = useState("");
  const [invalidTime, setInvalidTime] = useState(false);
  const [saving, setSaving] = useState(false);
  const timeInput = useRef<HTMLInputElement>(null);
  const busy = useRef(false);
  const mutation = useChangeStaffFollowUp();
  const outstanding = entry.followUpAt && !entry.followUpCompletedAt;
  const { requestClose, discardPrompt } = usePopupDraftGuard({
    dirty: time !== (entry.followUpAt ? followUpLocal(entry.followUpAt) : "") || note !== (entry.followUpNote ?? ""),
    blocked: () => busy.current,
    onClose,
  });
  async function save(action: "schedule" | "complete" | "cancel") {
    if (busy.current) return;
    setError("");
    setInvalidTime(false);
    const at = followUpIso(time);
    if (
      action === "schedule" &&
      (!at || new Date(at).getTime() <= Date.now())
    ) {
      setError("Choose a date and time in the future.");
      setInvalidTime(true);
      timeInput.current?.focus();
      return;
    }
    busy.current = true;
    setSaving(true);
    try {
      await onSaved(
        await mutation.mutateAsync({
          id: entry.id,
          data: {
            action,
            followUpAt: action === "schedule" ? at : null,
            followUpNote: note.trim() || null,
            expectedRevision: entry.followUpRevision ?? 0,
          },
        }),
      );
    } catch {
      setError(
        "The follow-up could not be saved. It may have changed; close and refresh before trying again.",
      );
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <DialogContent className="portal-action-dialog enquiry-action-dialog portal-popup-form-dialog" closeDisabled={saving}>
        <DialogHeader>
          <DialogTitle className="pr-10">
            {outstanding ? "Manage follow-up" : "Request a follow-up"}
          </DialogTitle>
          <DialogDescription>
            {entry.customerName}
          </DialogDescription>
        </DialogHeader>
        {discardPrompt}
        <form className="portal-popup-form" noValidate onSubmit={event => { event.preventDefault(); void save("schedule"); }}>
        <p className="text-sm">
          {entry.vehicleTitle || "General enquiry"} · {entry.phone}
        </p>
        {outstanding && (
          <p className="text-sm">
            Currently due: {appointmentLabel(entry.followUpAt!)}
          </p>
        )}
        <fieldset disabled={saving}>
          <FollowUpFields
            time={time}
            note={note}
            onTime={value => { setTime(value); setInvalidTime(false); }}
            onNote={setNote}
            timeRef={timeInput}
            invalid={invalidTime}
          />
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="portal-popup-actions">
          <Button type="button" variant="outline" disabled={saving} onClick={requestClose}>Cancel</Button>
          <Button
            type="submit"
            disabled={saving}
          >
            {saving ? "Saving…" : "Save follow-up"}
          </Button>
          {outstanding && (
            <>
              <Button
                variant="outline"
                type="button"
                disabled={saving}
                onClick={() => save("complete")}
              >
                Mark done
              </Button>
              <Button
                variant="ghost"
                type="button"
                disabled={saving}
                onClick={() => save("cancel")}
              >
                Remove
              </Button>
            </>
          )}
        </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
