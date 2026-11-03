import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import {
  Camera,
  Copy,
  FileText,
  LoaderCircle,
  MapPin,
  Printer,
  RefreshCw,
  Truck,
} from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  declarationError,
  declarationRequest,
  declarationToken,
  declarationTime,
} from "@/lib/test-drive-declarations";
import { requestUuid } from "@/lib/request-uuid";
import { deliveryPhotoData, type DeliveryJob } from "@/lib/delivery-evidence";
import "./sale-delivery-evidence.css";
const labels: Record<DeliveryJob["status"], string> = {
  open: "Awaiting evidence",
  received: "Evidence received",
  expired: "Link expired",
  revoked: "Link withdrawn",
  superseded: "Delivery changed",
};
export function SaleDeliveryEvidence({
  saleId,
  revision,
  readOnly = false,
}: {
  saleId: string;
  revision: number;
  readOnly?: boolean;
}) {
  const base = `/api/staff/sales/${saleId}/delivery-evidence`,
    query = useQuery({
      queryKey: ["sale-delivery-evidence", saleId, revision],
      queryFn: () => declarationRequest<{ jobs: DeliveryJob[] }>(base),
      retry: false,
      staleTime: 0,
    });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [link, setLink] = useState<{ id: string; url: string }>(),
    [preview, setPreview] = useState<{ url: string; label: string }>();
  const [paper, setPaper] = useState<{
    job: DeliveryJob;
    requestId: string;
    dataUrl: string;
    driverName: string;
    recipientName: string;
    handoverAt: string;
    mileage: string;
    keys: string;
    documentsProvided: boolean;
    notes: string;
    acknowledged: boolean;
    outcome: "delivered" | "not-delivered";
  }>();
  const attempt = useRef<
    { requestId: string; token: string; expectedRevision: number } | undefined
  >(undefined);
  const currentSaleId = useRef(saleId);
  currentSaleId.current = saleId;
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );
  useEffect(() => {
    setBusy(false);
    setLink(undefined);
    setError("");
    setPreview(undefined);
    setPaper(undefined);
    attempt.current = undefined;
  }, [saleId]);
  async function create() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      if (!attempt.current || attempt.current.expectedRevision !== revision)
        attempt.current = {
          requestId: requestUuid(),
          token: declarationToken(),
          expectedRevision: revision,
        };
      const result = await declarationRequest<{
        job: DeliveryJob;
        url: string;
      }>(base, attempt.current);
      if (currentSaleId.current !== saleId) return;
      setLink({ id: result.job.id, url: result.url });
      attempt.current = undefined;
      await query.refetch();
      if (currentSaleId.current !== saleId) return;
      setNotice(
        "Driver link is ready. It expires in 72 hours. Generating a new link withdraws the previous open link.",
      );
    } catch (cause) {
      if (currentSaleId.current === saleId) setError(declarationError(cause));
    } finally {
      if (currentSaleId.current === saleId) setBusy(false);
    }
  }
  async function revoke(id: string) {
    setBusy(true);
    setError("");
    try {
      await declarationRequest(`${base}/${id}/revoke`, {});
      if (currentSaleId.current !== saleId) return;
      if (link?.id === id) setLink(undefined);
      await query.refetch();
      if (currentSaleId.current !== saleId) return;
      setNotice("Driver link withdrawn. Saved evidence is retained.");
    } catch (cause) {
      if (currentSaleId.current === saleId) setError(declarationError(cause));
    } finally {
      if (currentSaleId.current === saleId) setBusy(false);
    }
  }
  async function print(id: string) {
    const popup = window.open("", "_blank");
    if (!popup) {
      setError("Allow the print window and try again.");
      return;
    }
    popup.opener = null;
    setBusy(true);
    setError("");
    try {
      const html = await customFetch<string>(`${base}/${id}/declaration`, {
        responseType: "text",
        cache: "no-store",
      });
      if (currentSaleId.current !== saleId) {
        popup.close();
        return;
      }
      popup.document.open();
      popup.document.write(html);
      popup.document.close();
    } catch (cause) {
      popup.close();
      if (currentSaleId.current === saleId) setError(declarationError(cause));
    } finally {
      if (currentSaleId.current === saleId) setBusy(false);
    }
  }
  async function photo(job: DeliveryJob, image: DeliveryJob["photos"][number]) {
    setBusy(true);
    setError("");
    try {
      const data = await customFetch<Blob>(
        `${base}/${job.id}/photos/${image.id}`,
        { responseType: "blob", cache: "no-store" },
      );
      if (currentSaleId.current !== saleId) return;
      setPreview({
        url: URL.createObjectURL(data),
        label: `${image.phase} · ${image.slot}`,
      });
    } catch (cause) {
      if (currentSaleId.current === saleId) setError(declarationError(cause));
    } finally {
      if (currentSaleId.current === saleId) setBusy(false);
    }
  }
  async function savePaper(e: React.FormEvent) {
    e.preventDefault();
    if (!paper || !paper.dataUrl || !paper.acknowledged) return;
    setBusy(true);
    setError("");
    try {
      const { job, ...fields } = paper;
      await declarationRequest(`${base}/${job.id}/paper`, {
        ...fields,
        mileage: Number(fields.mileage),
        keys: Number(fields.keys),
        handoverAt: new Date(fields.handoverAt).toISOString(),
      });
      if (currentSaleId.current !== saleId) return;
      setPaper(undefined);
      await query.refetch();
      if (currentSaleId.current !== saleId) return;
      setNotice(
        "Signed paper declaration saved. Handover remains a separate staff action.",
      );
    } catch (cause) {
      if (currentSaleId.current === saleId) setError(declarationError(cause));
    } finally {
      if (currentSaleId.current === saleId) setBusy(false);
    }
  }
  const editPaper = (patch: Partial<NonNullable<typeof paper>>) =>
    setPaper((previous) =>
      previous ? { ...previous, ...patch, requestId: requestUuid() } : previous,
    );
  return (
    <section className="sale-delivery-evidence">
      <header>
        <div>
          <h3>
            <Truck aria-hidden="true" />
            Delivery evidence
          </h3>
          <p>
            Driver photos and a delivery report stay with this sale and vehicle.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void query.refetch()}
          disabled={busy}
          aria-label="Refresh delivery evidence"
        >
          <RefreshCw />
        </Button>
      </header>
      {!readOnly && (
        <div className="sale-evidence-actions">
          <Button size="sm" onClick={create} disabled={busy}>
            {busy ? <LoaderCircle className="animate-spin" /> : <Camera />}
            Generate driver link
          </Button>
        </div>
      )}
      {link && (
        <div className="sale-evidence-link">
          <label htmlFor={`delivery-link-${saleId}`}>Private driver link</label>
          <div>
            <input
              id={`delivery-link-${saleId}`}
              value={link.url}
              readOnly
              onFocus={(e) => e.target.select()}
            />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard
                  .writeText(link.url)
                  .then(() => setNotice("Driver link copied."))
                  .catch(() =>
                    setError("Select and copy the driver link above."),
                  );
              }}
            >
              <Copy />
              Copy
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="sale-evidence-error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="sale-evidence-notice">
          {notice}
        </p>
      )}
      {query.isLoading ? (
        <p>Loading delivery file…</p>
      ) : query.isError ? (
        <p role="alert">{declarationError(query.error)}</p>
      ) : !query.data?.jobs?.length ? (
        <p className="sale-evidence-empty">
          <FileText />
          {readOnly
            ? "No delivery evidence is saved for this sale."
            : "Save the delivery address and date, then generate a driver link. Print the declaration before the driver leaves."}
        </p>
      ) : (
        <div className="sale-evidence-history">
          {query.data.jobs.map((job, index) => (
            <details key={job.id} open={index === 0}>
              <summary>
                <span className={`sale-evidence-state state-${job.status}`}>
                  {labels[job.status]}
                </span>
                <span>{declarationTime(job.createdAt)}</span>
                <span>{job.photos.length} photos</span>
              </summary>
              <div className="sale-evidence-details">
                <p>
                  <strong>
                    {job.snapshot.vehicle} · {job.snapshot.registration}
                  </strong>
                  <br />
                  {job.snapshot.address}
                  <br />
                  {job.snapshot.scheduledDate} {job.snapshot.timeWindow}{" "}
                  {job.snapshot.driver && `· ${job.snapshot.driver}`}
                </p>
                <div className="sale-evidence-actions">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void print(job.id)}
                  >
                    <Printer />
                    Print backup declaration
                  </Button>
                  {!readOnly && !job.submission && job.current !== false && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => {
                        setError("");
                        setPaper({
                          job,
                          requestId: requestUuid(),
                          dataUrl: "",
                          driverName: job.snapshot.driver,
                          recipientName: job.snapshot.recipient,
                          handoverAt: "",
                          mileage: "",
                          keys: "1",
                          documentsProvided: false,
                          notes: "",
                          acknowledged: false,
                          outcome: "delivered",
                        });
                      }}
                    >
                      <FileText />
                      Upload signed paper
                    </Button>
                  )}
                  {!readOnly && job.status === "open" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => void revoke(job.id)}
                    >
                      Withdraw link
                    </Button>
                  )}
                </div>
                {job.submission && (
                  <>
                    <dl>
                      <div>
                        <dt>Evidence source</dt>
                        <dd>
                          {job.submission.source === "paper"
                            ? "Signed paper declaration"
                            : "Driver report"}
                        </dd>
                      </div>
                      <div>
                        <dt>Outcome</dt>
                        <dd>
                          {job.submission.outcome === "delivered"
                            ? "Delivered — awaiting staff handover confirmation"
                            : "Delivery not completed"}
                        </dd>
                      </div>
                      <div>
                        <dt>Driver / recipient</dt>
                        <dd>
                          {job.submission.driverName} /{" "}
                          {job.submission.recipientName || "Not recorded"}
                        </dd>
                      </div>
                      <div>
                        <dt>Actual handover time</dt>
                        <dd>{declarationTime(job.submission.handoverAt)}</dd>
                      </div>
                      <div>
                        <dt>Evidence received</dt>
                        <dd>
                          {job.submittedAt
                            ? declarationTime(job.submittedAt)
                            : "Pending"}
                        </dd>
                      </div>
                      <div>
                        <dt>Mileage / keys</dt>
                        <dd>
                          {job.submission.mileage.toLocaleString()} miles ·{" "}
                          {job.submission.keys} keys
                        </dd>
                      </div>
                    </dl>
                    {job.submission.notes && <p>{job.submission.notes}</p>}
                    {job.submission.location ? (
                      <p>
                        <MapPin />
                        {job.submission.location.latitude.toFixed(5)},{" "}
                        {job.submission.location.longitude.toFixed(5)} ·
                        accuracy approximately{" "}
                        {Math.round(job.submission.location.accuracy)} m<br />
                        <small>
                          Device location is supporting evidence; it is not
                          proof of delivery.
                        </small>
                      </p>
                    ) : (
                      <p>
                        Location unavailable: {job.submission.locationReason}
                      </p>
                    )}
                  </>
                )}
                {job.photos.length > 0 && (
                  <div className="sale-evidence-photos">
                    {job.photos.map((image) => (
                      <Button
                        key={image.id}
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void photo(job, image)}
                      >
                        <Camera />
                        {image.phase} · {image.slot}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </details>
          ))}
        </div>
      )}
      <Dialog
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(undefined);
        }}
      >
        <DialogContent className="sale-evidence-photo-dialog">
          <DialogHeader>
            <DialogTitle>{preview?.label || "Delivery photo"}</DialogTitle>
            <DialogDescription>
              Private evidence saved in this sale file.
            </DialogDescription>
          </DialogHeader>
          {preview && <img src={preview.url} alt={preview.label} />}
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!paper}
        onOpenChange={(open) => {
          if (!open && !busy) setPaper(undefined);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save signed delivery declaration</DialogTitle>
            <DialogDescription>
              Record the actual handover details from the paper. The upload time
              is stored separately.
            </DialogDescription>
          </DialogHeader>
          {paper && (
            <form className="sale-evidence-paper" onSubmit={savePaper}>
              <label>
                Signed declaration photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      setBusy(true);
                      void deliveryPhotoData(file)
                        .then((dataUrl) => {
                          if (currentSaleId.current === saleId)
                            editPaper({ dataUrl });
                        })
                        .catch((cause) => {
                          if (currentSaleId.current === saleId)
                            setError(cause.message);
                        })
                        .finally(() => {
                          if (currentSaleId.current === saleId) setBusy(false);
                        });
                    }
                  }}
                />
                {paper.dataUrl && <span>Photo ready to upload</span>}
              </label>
              <div>
                <label>
                  Driver name
                  <input
                    required
                    minLength={2}
                    maxLength={120}
                    value={paper.driverName}
                    disabled={busy}
                    onChange={(e) => editPaper({ driverName: e.target.value })}
                  />
                </label>
                <label>
                  Recipient name
                  <input
                    required={paper.outcome === "delivered"}
                    minLength={paper.outcome === "delivered" ? 2 : 0}
                    maxLength={120}
                    value={paper.recipientName}
                    disabled={busy}
                    onChange={(e) =>
                      editPaper({ recipientName: e.target.value })
                    }
                  />
                </label>
                <label>
                  Actual handover time
                  <input
                    type="datetime-local"
                    required
                    value={paper.handoverAt}
                    disabled={busy}
                    onChange={(e) => editPaper({ handoverAt: e.target.value })}
                  />
                </label>
                <label>
                  Mileage
                  <input
                    type="number"
                    min="0"
                    max="5000000"
                    required
                    value={paper.mileage}
                    disabled={busy}
                    onChange={(e) => editPaper({ mileage: e.target.value })}
                  />
                </label>
                <label>
                  Keys supplied
                  <input
                    type="number"
                    min="0"
                    max="20"
                    required
                    value={paper.keys}
                    disabled={busy}
                    onChange={(e) => editPaper({ keys: e.target.value })}
                  />
                </label>
                <label>
                  Outcome
                  <select
                    value={paper.outcome}
                    disabled={busy}
                    onChange={(e) =>
                      editPaper({
                        outcome: e.target.value as
                          "delivered" | "not-delivered",
                      })
                    }
                  >
                    <option value="delivered">Delivered</option>
                    <option value="not-delivered">
                      Delivery not completed
                    </option>
                  </select>
                </label>
              </div>
              <label>
                Condition notes / exceptions
                <textarea
                  required={paper.outcome === "not-delivered"}
                  minLength={paper.outcome === "not-delivered" ? 5 : 0}
                  maxLength={3000}
                  value={paper.notes}
                  disabled={busy}
                  onChange={(e) => editPaper({ notes: e.target.value })}
                />
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={paper.documentsProvided}
                  disabled={busy}
                  onChange={(e) =>
                    editPaper({ documentsProvided: e.target.checked })
                  }
                />{" "}
                Agreed documents supplied
              </label>
              <label>
                <input
                  type="checkbox"
                  required
                  checked={paper.acknowledged}
                  disabled={busy}
                  onChange={(e) =>
                    editPaper({ acknowledged: e.target.checked })
                  }
                />{" "}
                I checked the signed paper and entered its details accurately.
              </label>
              {error && (
                <p role="alert" className="sale-evidence-error">
                  {error}
                </p>
              )}
              <Button
                type="submit"
                disabled={busy || !paper.dataUrl || !paper.acknowledged}
              >
                {busy ? "Saving…" : "Save signed declaration"}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
      <p className="sale-evidence-footnote">
        Evidence does not confirm payment or complete handover. The driver must
        keep unsent photos if a link expires or changes.
      </p>
    </section>
  );
}
