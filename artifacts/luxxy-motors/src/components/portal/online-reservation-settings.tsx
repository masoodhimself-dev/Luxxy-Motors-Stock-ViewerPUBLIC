import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch, getGetDealerSettingsQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type ReservationSettings = {
  enabled: boolean;
  paymentReady: boolean;
  supported: boolean;
};

const endpoint = "/api/staff/reservations/settings";
const settingsKey = ["staff-reservation-settings"] as const;
const readinessKey = ["reservation-payment-readiness"] as const;

export function OnlineReservationSettings() {
  const client = useQueryClient();
  const [draft, setDraft] = useState<boolean | null>(null);
  const query = useQuery({
    queryKey: settingsKey,
    queryFn: ({ signal }) => customFetch<ReservationSettings>(endpoint, { signal }),
    retry: false,
  });
  const settings = query.data;
  const enabled = draft ?? settings?.enabled ?? false;
  const dirty = Boolean(settings && enabled !== settings.enabled);
  const update = useMutation({
    mutationFn: (next: boolean) => customFetch<ReservationSettings>(endpoint, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: next }),
    }),
    onSuccess: (saved) => {
      client.setQueryData(settingsKey, saved);
      setDraft(null);
      if (!saved.enabled || !saved.paymentReady) {
        client.setQueryData(readinessKey, { enabled: false });
      }
      void client.invalidateQueries({ queryKey: readinessKey });
      void client.invalidateQueries({ queryKey: getGetDealerSettingsQueryKey() });
    },
  });

  return (
    <section className="admin-card mb-4 grid gap-3" aria-labelledby="online-reservations-title" data-settings-dirty={dirty}>
      <div>
        <h3 id="online-reservations-title">Online reservations</h3>
        <p className="text-sm text-muted-foreground">Offer a fully refundable £99 reservation on available vehicles.</p>
      </div>
      {query.isPending && <p role="status">Loading reservation settings…</p>}
      {query.isError && (
        <div className="grid justify-items-start gap-2" role="alert">
          <p>Reservation settings could not load.</p>
          <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>Try again</Button>
        </div>
      )}
      {settings && !query.isError && (settings.supported ? (
        <>
          <label className="flex min-h-11 items-center justify-between gap-4 text-sm font-semibold">
            <span>Allow £99 reservations on the website</span>
            <Switch
              checked={enabled}
              disabled={update.isPending}
              onCheckedChange={(next) => { update.reset(); setDraft(next); }}
            />
          </label>
          <p>
            {settings.enabled && settings.paymentReady ? "On. Eligible vehicle pages show the £99 offer."
              : settings.enabled ? "On. The offer will appear once payments are ready."
                : "Off. Customers can enquire about cars from their vehicle pages."}
          </p>
          <p>Switch off to hide the offer and stop new online checkouts. Manage existing reservations in Sales.</p>
          <Button className="min-h-11 justify-self-start" disabled={!dirty || update.isPending} onClick={() => update.mutate(enabled)}>
            {update.isPending ? "Saving…" : "Save reservation setting"}
          </Button>
          {update.isError && <p role="alert">The reservation setting could not be saved. Try again.</p>}
          {update.isSuccess && <p role="status">Online reservations turned {update.data.enabled ? "on" : "off"}.</p>}
        </>
      ) : <p>Online reservations are unavailable for this website.</p>)}
    </section>
  );
}
