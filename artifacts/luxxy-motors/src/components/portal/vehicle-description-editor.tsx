import { useEffect, useId, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { workspaceError } from "./enquiry-workspace-tools";
import "./vehicle-description-editor.css";
export type DescriptionView = {
  previewExample?: boolean;
  version: string;
  current: string;
  originals: string[];
  disclosures: string[];
  draft: string;
  generationStatus: string | null;
  draftStale: boolean;
  aiAvailable: boolean;
  facts: { facts: Record<string, string | number>; features: string[] };
};
export function VehicleDescriptionEditor({
  vehicleId,
  writable,
}: {
  vehicleId: string;
  writable: boolean;
}) {
  const [open, setOpen] = useState(false),
    [data, setData] = useState<DescriptionView>(),
    [body, setBody] = useState(""),
    [saved, setSaved] = useState(""),
    [reviewed, setReviewed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const id = useId(),
    client = useQueryClient(),
    path = `/api/staff/vehicle-descriptions/${vehicleId}`;
  const query = useQuery({
    queryKey: ["vehicle-description", vehicleId],
    enabled: open && writable,
    retry: false,
    queryFn: () => customFetch<DescriptionView>(path),
  });
  const dirty = body !== saved;
  function accept(value: DescriptionView) {
    setData(value);
    setBody(value.draft || value.current);
    setSaved(value.draft || value.current);
    setReviewed(false);
  }
  useEffect(() => {
    if (query.data && !dirty && !busy && query.data.version !== data?.version)
      accept(query.data);
  }, [query.data, data?.version, dirty, busy]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  async function reload() {
    if (
      dirty &&
      !window.confirm("Discard your unsaved description edits and reload?")
    )
      return;
    setError("");
    const result = await query.refetch();
    if (result.data) {
      accept(result.data);
      setNotice("Latest description loaded.");
    }
  }
  async function act(
    action: "generate" | "save-draft" | "publish" | "restore",
  ) {
    if (!data || busy) return;
    if (
      (action === "generate" || action === "restore") &&
      dirty &&
      !window.confirm("Discard your unsaved description edits?")
    )
      return;
    if (
      action === "restore" &&
      !window.confirm("Use the original imported advert on the website again?")
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const payload =
        action === "generate"
          ? { expectedVersion: data.version, requestId: crypto.randomUUID() }
          : {
              action,
              expectedVersion: data.version,
              ...(action !== "restore" ? { description: body } : {}),
              ...(action === "publish" ? { reviewed: true } : {}),
            };
      const result = await customFetch<DescriptionView>(
        `${path}${action === "generate" ? "/generate" : ""}`,
        {
          method: action === "generate" ? "POST" : "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      client.setQueryData(["vehicle-description", vehicleId], result);
      accept(result);
      setNotice(
        action === "publish"
          ? "Description published to your website."
          : action === "restore"
            ? "Your website is using the original advert again."
            : action === "generate"
              ? result.generationStatus === "ready"
                ? "Draft ready. Review and edit it before publishing."
                : "No completed draft yet. Reload to check this request."
              : "Draft saved. Your website has not changed.",
      );
      if (action === "publish" || action === "restore")
        await client.invalidateQueries({
          predicate: (entry) =>
            entry.queryKey.some(
              (key) => typeof key === "string" && /stock/i.test(key),
            ),
        });
    } catch (caught) {
      setError(workspaceError(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="inventory-card vehicle-copy-editor">
      <div className="vehicle-copy-heading">
        <div>
          <h3>About this car</h3>
          <p>
            Turn recorded details into a clear description. Review it before it
            goes on your website.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!writable || busy}
          onClick={() => {
            if (
              open &&
              dirty &&
              !window.confirm("Discard unsaved description edits?")
            )
              return;
            if (open && dirty && data) accept(data);
            setOpen(!open);
          }}
        >
          {open ? "Close description" : "Write description"}
        </Button>
      </div>
      {open && (
        <div id={id}>
          {query.isLoading && (
            <p role="status">Loading the advert and recorded details…</p>
          )}
          {(query.isError || error) && (
            <div role="alert" className="vehicle-copy-error">
              {error || "Description could not be loaded."}
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => void reload()}
              >
                Reload latest details
              </Button>
            </div>
          )}
          {data && (
            <>
              {data.previewExample && (
                <p role="note" className="vehicle-copy-disclosures">
                  Local example only · sample wording from archived car details.
                  No AI calls or live changes.
                </p>
              )}
              <div className="vehicle-copy-source">
                <details>
                  <summary>Original advert · kept unchanged</summary>
                  {data.originals.length ? (
                    data.originals.map((original, index) => (
                      <p key={index}>{original}</p>
                    ))
                  ) : (
                    <p>No original description was supplied.</p>
                  )}
                </details>
                <details>
                  <summary>Recorded details & equipment</summary>
                  <dl>
                    {Object.entries(data.facts.facts).map(([key, value]) => (
                      <div key={key}>
                        <dt>{key.replace(/([A-Z])/g, " $1")}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <ul>
                    {data.facts.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                </details>
              </div>
              <div className="vehicle-copy-toolbar">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !data.aiAvailable}
                  onClick={() => void act("generate")}
                >
                  {busy
                    ? "Working…"
                    : data.draft
                      ? "Generate another AI draft"
                      : "Generate AI description"}
                </Button>
                <span>
                  {data.aiAvailable
                    ? "Uses this car’s recorded facts. Nothing publishes automatically."
                    : "AI generation is not enabled here. You can still write and save a description."}
                </span>
              </div>
              {data.draftStale && (
                <p role="alert" className="vehicle-copy-error">
                  The car’s details changed after this draft. Review the latest
                  facts and save a reviewed draft before publishing.
                </p>
              )}
              {data.generationStatus === "generating" && (
                <p role="status">
                  A request is being prepared or was interrupted. Reload to
                  check its result. A new request is allowed after two minutes.
                </p>
              )}
              <label htmlFor={`${id}-text`}>Website description</label>
              <textarea
                id={`${id}-text`}
                value={body}
                maxLength={4000}
                rows={8}
                disabled={busy}
                onChange={(event) => {
                  setBody(event.target.value);
                  setReviewed(false);
                  setNotice("");
                }}
                placeholder="Write about this car, or generate a draft from its recorded details."
              />
              <div className="vehicle-copy-counter">
                {body.length.toLocaleString("en-GB")} / 4,000 characters
                {dirty ? " · Unsaved edits" : ""}
              </div>
              {!!data.disclosures.length && (
                <aside className="vehicle-copy-disclosures">
                  <strong>Important information · always included</strong>
                  <p>
                    These original disclosures are added to the published
                    description. They cannot be removed here.
                  </p>
                  {data.disclosures.map((note) => (
                    <p key={note}>{note}</p>
                  ))}
                </aside>
              )}
              <details className="vehicle-copy-preview">
                <summary>Preview the published description</summary>
                <div>{body || "Your description will appear here."}</div>
                {data.disclosures
                  .filter(
                    (note) => !body.toLowerCase().includes(note.toLowerCase()),
                  )
                  .map((note) => (
                    <p key={note}>{note}</p>
                  ))}
              </details>
              <label className="vehicle-copy-review">
                <input
                  type="checkbox"
                  checked={reviewed}
                  disabled={busy}
                  onChange={(event) => setReviewed(event.target.checked)}
                />
                <span>
                  I’ve checked the facts, equipment and important information.
                </span>
              </label>
              <div className="vehicle-copy-actions">
                <Button
                  type="button"
                  disabled={
                    busy ||
                    !reviewed ||
                    body.trim().length < 20 ||
                    data.draftStale
                  }
                  onClick={() => void act("publish")}
                >
                  Publish description
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || body.trim().length < 20}
                  onClick={() => void act("save-draft")}
                >
                  Save draft
                </Button>
                {data.current && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void act("restore")}
                  >
                    Restore original advert
                  </Button>
                )}
              </div>
            </>
          )}
          {notice && (
            <p role="status" className="vehicle-copy-notice">
              {notice}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
