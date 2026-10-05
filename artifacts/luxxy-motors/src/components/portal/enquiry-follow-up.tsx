import { useRef, useState } from "react";
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
}: {
  time: string;
  note: string;
  onTime: (value: string) => void;
  onNote: (value: string) => void;
  noteMaxLength?: number;
}) {
  return (
    <div className="grid gap-3 rounded-sm border border-border bg-muted/30 p-3">
      <label className="grid gap-1.5 text-sm font-medium">
        Follow-up date and time (UK)
        <Input
          type="datetime-local"
          required
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
  onSaved: (entry: Enquiry) => void;
}) {
  const [time, setTime] = useState(
    entry.followUpAt ? followUpLocal(entry.followUpAt) : "",
  );
  const [note, setNote] = useState(entry.followUpNote ?? "");
  const [error, setError] = useState("");
  const busy = useRef(false);
  const mutation = useChangeStaffFollowUp();
  const outstanding = entry.followUpAt && !entry.followUpCompletedAt;
  async function save(action: "schedule" | "complete" | "cancel") {
    if (busy.current) return;
    setError("");
    const at = followUpIso(time);
    if (
      action === "schedule" &&
      (!at || new Date(at).getTime() <= Date.now())
    ) {
      setError("Choose a valid future UK date and time.");
      return;
    }
    busy.current = true;
    try {
      onSaved(
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
    }
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy.current) onClose();
      }}
    >
      <DialogContent className="portal-action-dialog enquiry-action-dialog">
        <DialogHeader>
          <DialogTitle className="pr-10">
            {outstanding ? "Manage follow-up" : "Request a follow-up"}
          </DialogTitle>
          <DialogDescription>
            {entry.customerName} · {entry.reference}
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm">
          {entry.vehicleTitle || "General enquiry"} · {entry.phone}
        </p>
        {outstanding && (
          <p className="text-sm">
            Currently due: {appointmentLabel(entry.followUpAt!)}
          </p>
        )}
        <fieldset disabled={mutation.isPending}>
          <FollowUpFields
            time={time}
            note={note}
            onTime={setTime}
            onNote={setNote}
          />
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={mutation.isPending}
            onClick={() => save("schedule")}
          >
            Save follow-up
          </Button>
          {outstanding && (
            <>
              <Button
                variant="outline"
                disabled={mutation.isPending}
                onClick={() => save("complete")}
              >
                Mark follow-up done
              </Button>
              <Button
                variant="ghost"
                disabled={mutation.isPending}
                onClick={() => save("cancel")}
              >
                Remove follow-up
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
