import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ShareQr } from "@/components/share-qr";
import "./vehicle-video.css";
import { VideoRecorder } from "./video-recorder";
type Video = {
  id: string;
  status: "processing" | "ready" | "failed";
  published: boolean;
  revision: number;
  durationMs: number;
  byteSize: number;
  previewUrl: string | null;
};
export async function inspectVideoFile(file: File) {
  if (file.size > 200 * 1024 * 1024)
    throw new Error("Choose a source video smaller than 200 MB.");
  if (!["video/mp4", "video/quicktime", "video/webm"].includes(file.type))
    throw new Error("Choose an MP4, MOV or WebM video.");
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<number>((resolve, reject) => {
      const video = document.createElement("video");
      const timer = setTimeout(() => {
        video.removeAttribute("src");
        video.load();
        reject(new Error("The video could not be checked. Try an MP4 clip."));
      }, 12000);
      const finish = () => {
        clearTimeout(timer);
        video.removeAttribute("src");
        video.load();
      };
      video.preload = "metadata";
      video.onloadedmetadata = () => {
        const seconds = video.duration;
        finish();
        if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 30)
          reject(
            new Error(
              "Choose a video no longer than 30 seconds. Trim it before uploading.",
            ),
          );
        else resolve(seconds);
      };
      video.onerror = () => {
        finish();
        reject(
          new Error(
            "This video format cannot be previewed here. Try an MP4 clip.",
          ),
        );
      };
      video.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
export function VehicleVideoEditor({
  vehicleId,
  writable,
}: {
  vehicleId: string;
  writable: boolean;
}) {
  const path = `/api/staff/inventory/${vehicleId}/videos`;
  const query = useQuery({
    queryKey: ["vehicle-videos", vehicleId],
    queryFn: () =>
      customFetch<{
        enabled: boolean;
        preview?: boolean;
        videos: Video[];
        shareUrl: string;
      }>(path),
    retry: false,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [reviewed, setReviewed] = useState("");
  const upload = useRef<{ file: File; id: string } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function send(file: File, recorded = false) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (!recorded) await inspectVideoFile(file);
      if (upload.current?.file !== file)
        upload.current = { file, id: crypto.randomUUID() };
      const controller = new AbortController();
      pending.current = controller;
      await customFetch(`${path}/${upload.current!.id}`, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
        signal: controller.signal,
      });
      upload.current = null;
      setReviewed("");
      await query.refetch();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Upload failed. Refresh the status before retrying.",
      );
      await query.refetch();
    } finally {
      setBusy(false);
    }
  }
  async function change(video: Video, publish: boolean) {
    setBusy(true);
    setError("");
    try {
      await customFetch(
        `${path}/${video.id}/${publish ? "publish" : "unpublish"}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            expectedRevision: video.revision,
            confirm: publish,
          }),
        },
      );
      setReviewed("");
      await query.refetch();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update video.",
      );
    } finally {
      setBusy(false);
    }
  }
  const videos = query.data?.videos ?? [],
    published = videos.find((video) => video.published),
    draft = videos.find(
      (video) => !video.published && video.status === "ready",
    );
  return (
    <section
      className="inventory-card vehicle-video-editor"
      aria-label="Car video"
    >
      <h3>Car video</h3>
      <p>
        One short walkaround, up to 30 seconds. Upload an MP4, MOV or WebM clip;
        we compress it to a phone-friendly MP4 under 5 MB. Review it before
        publishing.
      </p>
      {query.isPending && <p>Loading video…</p>}
      {query.isError && (
        <p role="alert">
          Video status could not be loaded.{" "}
          <Button variant="outline" onClick={() => void query.refetch()}>
            Retry video status
          </Button>
        </p>
      )}
      {query.data?.preview && (
        <p>
          Local sample videos · uploads and publishing require the authenticated
          server.
        </p>
      )}
      {query.data && !query.data.enabled && (
        <p>Video storage needs connecting before uploads can be enabled.</p>
      )}
      {error && <p role="alert">{error}</p>}
      {busy && (
        <p role="status">
          Uploading or processing video… Keep this page open. Nothing is
          published automatically.
        </p>
      )}
      <div className="vehicle-video-previews">
        {published && (
          <div>
            <h4>Shareable video</h4>
            <video
              controls
              playsInline
              preload="metadata"
              src={published.previewUrl!}
            />
            <div className="vehicle-video-actions">
              <ShareQr
                url={query.data?.shareUrl}
                label="Video QR / share link"
              />
              <ShareQr
                whatsapp vehicleId={vehicleId}
                url={query.data?.shareUrl}
                message="Here is the car video you asked about."
                label="WhatsApp QR"
              />
              <a
                className="phone-share-open"
                href={`mailto:?subject=${encodeURIComponent("Your car video")}&body=${encodeURIComponent(`Here is the car video: ${query.data?.shareUrl || ""}`)}`}
              >
                Email video link
              </a>
              <p>
                Enter the customer’s number, then scan the WhatsApp QR on
                your phone and tap Send. Email video link
                opens your email app.
              </p>
              {writable && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void change(published, false)}
                >
                  Disable video link
                </Button>
              )}
            </div>
          </div>
        )}
        {draft && (
          <div>
            <h4>Draft preview</h4>
            <video
              key={draft.id}
              controls
              playsInline
              preload="metadata"
              src={draft.previewUrl!}
            />
            <p>
              {(draft.durationMs / 1000).toFixed(1)} seconds ·{" "}
              {(draft.byteSize / 1024 / 1024).toFixed(1)} MB.{" "}
              {published
                ? "The existing shared video stays available until you publish this replacement."
                : "This draft is not visible to customers."}
            </p>
            {writable && (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={reviewed === draft.id}
                    onChange={(e) =>
                      setReviewed(e.target.checked ? draft.id : "")
                    }
                  />{" "}
                  I have reviewed this video and want to make its link
                  shareable.
                </label>
                <Button
                  disabled={busy || reviewed !== draft.id}
                  onClick={() => void change(draft, true)}
                >
                  Publish video
                </Button>
              </>
            )}
          </div>
        )}
      </div>
      {videos.some((video) => video.status === "processing") && (
        <p>A video is processing. Refresh its status before retrying.</p>
      )}
      {videos[0]?.status === "failed" && (
        <p>
          The last video could not be processed. Its previous published version
          is unchanged.
        </p>
      )}
      {(writable || query.data?.preview) && (
        <VideoRecorder
          disabled={busy || !writable || !query.data?.enabled}
          onRecorded={(file) => void send(file, true)}
        />
      )}
      {(writable || query.data?.preview) && (
        <div className="vehicle-video-actions">
          <input
            ref={input}
            hidden
            aria-label="Choose car video"
            type="file"
            accept="video/mp4,video/quicktime,video/webm"
            disabled={busy || !writable || !query.data?.enabled}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void send(file);
            }}
          />
          <Button
            variant="outline"
            disabled={busy || !writable || !query.data?.enabled}
            onClick={() => input.current?.click()}
          >
            {published ? "Upload replacement video" : "Upload video"}
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void query.refetch()}
          >
            Refresh video status
          </Button>
        </div>
      )}
    </section>
  );
}
export function PublicVehicleVideo({
  vehicleId,
  poster,
}: {
  vehicleId: string;
  poster?: string | null;
}) {
  const query = useQuery({
    queryKey: ["public-car-video", vehicleId],
    queryFn: () =>
      customFetch<{
        video: { url: string; shareUrl: string; preview?: boolean } | null;
      }>(`/api/vehicles/${vehicleId}/video`),
    retry: false,
  });
  const video = query.data?.video;
  useEffect(() => {
    if (
      video &&
      new URLSearchParams(window.location.search).get("video") === "1"
    )
      document
        .getElementById("walkaround")
        ?.scrollIntoView({ block: "center" });
  }, [video?.url]);
  if (!video) return null;
  return (
    <section
      id="walkaround"
      className="vehicle-video-public"
      aria-label="Watch car video"
    >
      <h2>Watch the walkaround</h2>
      {video.preview && <p>Local sample video · not footage of this car.</p>}
      <video
        controls
        playsInline
        preload="none"
        poster={poster || undefined}
        src={video.url}
      />
      <ShareQr url={video.shareUrl} label="Share video" />
    </section>
  );
}
