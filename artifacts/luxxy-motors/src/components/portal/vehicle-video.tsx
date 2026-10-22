import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ShareQr } from "@/components/share-qr";
import { InternalShareEmailButton } from "@/components/internal-share-email";
import "./vehicle-video.css";
import { VideoRecorder, usePhoneCamera } from "./video-recorder";
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
export function VehicleVideoEditor({ vehicleId, vehicleTitle = "", writable, recordingPage = false }: {
  vehicleId: string; vehicleTitle?: string; writable: boolean; recordingPage?: boolean;
}) {
  const phone = usePhoneCamera();
  const recordingUrl = new URL(`/portal?section=inventory&vehicleId=${encodeURIComponent(vehicleId)}&recordVideo=1`, window.location.origin).href;
  const path = `/api/staff/inventory/${vehicleId}/videos`;
  const query = useQuery({
    queryKey: ["vehicle-videos", vehicleId],
    queryFn: () => customFetch<{ enabled: boolean; preview?: boolean; videos: Video[]; shareUrl: string }>(path),
    retry: false,
    refetchInterval: (state) => state.state.data?.videos?.some(video => video.status === "processing") ? 4000 : false,
  });
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState(""), [reviewed, setReviewed] = useState("");
  const [cameraActive, setCameraActive] = useState(false);
  const upload = useRef<{ file: File; id: string } | null>(null);
  const input = useRef<HTMLInputElement>(null), pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function send(file: File, recorded = false): Promise<boolean> {
    if (pending.current) return false;
    const controller = new AbortController(); pending.current = controller;
    setBusy(true); setError(""); setNotice("");
    try {
      if (!recorded) await inspectVideoFile(file);
      if (upload.current?.file !== file) upload.current = { file, id: crypto.randomUUID() };
      await customFetch(`${path}/${upload.current.id}`, { method: "PUT", headers: { "Content-Type": file.type }, body: file, signal: controller.signal });
      upload.current = null; setReviewed("");
      const refreshed = await query.refetch();
      setNotice(refreshed.isError ? "Upload saved. Refresh video status to see your draft." : "Video saved as a draft. Watch it below before publishing.");
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed. Your clip is kept here so you can retry.");
      await query.refetch(); return false;
    } finally { pending.current = null; setBusy(false); }
  }
  async function change(video: Video, publish: boolean) {
    if (busy) return;
    setBusy(true);setError("");setNotice("");
    try {
      await customFetch(`${path}/${video.id}/${publish ? "publish" : "unpublish"}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ expectedRevision: video.revision, confirm: publish }) });
      setReviewed(""); await query.refetch();
      setNotice(publish ? "Video published. Customers can now watch it from the car’s gallery or shared link." : "Video link disabled. Customers can no longer open this video.");
    } catch(cause) { setError(cause instanceof Error ? cause.message : "Could not update video. Refresh its status and try again."); }
    finally {setBusy(false);}
  }
  const videos=query.data?.videos ?? [], published=videos.find(video=>video.published), draft=videos.find(video=>!video.published && video.status==="ready");
  const canEdit=writable || query.data?.preview;
  const disabled=busy || !writable || !query.data?.enabled || query.isError;
  const processing=videos.some(video=>video.status==="processing");
  const captureTools = canEdit && <div className="video-capture-tools">
    {phone ? <VideoRecorder disabled={disabled} onActiveChange={setCameraActive} onRecorded={file=>send(file,true)} /> : <div className="video-phone-handoff">
      <div><h4>Record on your phone</h4><p>Scan the QR, sign in and turn your phone sideways. Record up to 30 seconds with pause and resume.</p></div>
      <ShareQr purpose="record-video" url={recordingUrl} label="Record on phone · QR" disabled={busy || (!writable && !query.data?.preview)} />
    </div>}
    {!cameraActive && <div className="vehicle-video-actions video-upload-actions">
      <input ref={input} hidden aria-label="Choose car video" type="file" accept="video/mp4,video/quicktime,video/webm" disabled={disabled} onChange={event=>{const file=event.target.files?.[0]; event.target.value=""; if(file)void send(file);}} />
      <Button variant="outline" disabled={disabled} onClick={()=>input.current?.click()}>{published ? "Upload replacement video" : "Upload video"}</Button>
      <small>Already recorded? Choose an MP4, MOV or WebM, up to 30 seconds.</small>
    </div>}
  </div>;
  const draftPreview=draft && <div className="video-draft-card">
    <div className="video-section-heading"><h4>Draft preview</h4><span className="video-status-badge">Private draft</span></div>
    <video key={draft.id} aria-label="Draft video preview" controls playsInline preload="metadata" src={draft.previewUrl!}/>
    <p className="video-clip-meta">{(draft.durationMs/1000).toFixed(1)} seconds <span>/</span> {(draft.byteSize/1024/1024).toFixed(1)} MB</p>
    <p>{published ? "Your current published video stays available until you publish this replacement." : "Only staff can see this draft. Nothing is published automatically."}</p>
    {writable && <div className="video-publish-actions"><label><input type="checkbox" checked={reviewed===draft.id} onChange={event=>setReviewed(event.target.checked?draft.id:"")}/>I have reviewed this video and want to make its link shareable.</label><Button disabled={busy || reviewed!==draft.id} onClick={()=>void change(draft,true)}>Publish video</Button></div>}
  </div>;
  return <section className={`inventory-card vehicle-video-editor ${recordingPage?"video-recording-editor":""} ${cameraActive?"has-active-camera":""}`} aria-label="Car video">
    <header className="video-editor-heading"><div><h3>{recordingPage?"Record and review":"Car video"}</h3><p>{recordingPage ? "Record a short landscape clip, check it, then publish when you’re happy." : "A short walkaround, compressed for easy sharing. Review every clip before it goes on the website."}</p></div><span className="video-status-badge">30 seconds max</span></header>
    {recordingPage && !cameraActive && <ol className="video-recording-steps" aria-label="Video steps"><li>1. Record</li><li>2. Review</li><li>3. Publish</li></ol>}
    {query.isPending && <p role="status">Checking video status…</p>}
    {query.isError && <div className="video-notice" role="alert">Video status could not be loaded. <Button variant="outline" onClick={()=>void query.refetch()}>Retry video status</Button></div>}
    {query.data?.preview && <p className="video-notice">Local sample videos. Uploading and publishing are disabled in this preview.</p>}
    {query.data && !query.data.enabled && !query.data.preview && <p className="video-notice">Video storage needs connecting before uploads can be enabled. Ask the platform operator to check it.</p>}
    {notice && <p className="video-notice video-notice-success" role="status">{notice}</p>}
    {error && <div className="video-notice" role="alert"><p>{error}</p>{upload.current && !cameraActive && <Button disabled={busy} variant="outline" onClick={()=>void send(upload.current!.file,true)}>Retry upload</Button>}</div>}
    {busy && <p role="status" className="video-notice">Uploading and compressing your clip… Keep this page open. It will be saved as a draft.</p>}
    {captureTools}
    {!cameraActive && <div className="vehicle-video-previews">
      {draftPreview}
      {published && <div className="video-published-card"><div className="video-section-heading"><h4>{recordingPage?"Current published video":"Shareable video"}</h4><span className="video-status-badge video-status-live">Published</span></div>
        <video aria-label="Published video preview" controls playsInline preload="metadata" src={published.previewUrl!}/>
        <div className="vehicle-video-actions"><ShareQr url={query.data?.shareUrl} label="Video QR / share link"/><ShareQr templateVariables={{vehicle_title:vehicleTitle}} whatsapp vehicleId={vehicleId} url={query.data?.shareUrl} message="Here is the car video you asked about." label="WhatsApp QR"/>
        <InternalShareEmailButton label="Email video link" subject="Your car video" message={`Here is the car video: ${query.data?.shareUrl||""}`} vehicleId={vehicleId}/>
        {writable && <Button variant="outline" disabled={busy} onClick={()=>void change(published,false)}>Disable video link</Button>}</div>
      </div>}
    </div>}
    {processing && <p role="status" className="video-notice">Video processing. This status refreshes automatically.</p>}
    {videos[0]?.status==="failed" && <p className="video-notice">The last video could not be processed. Your published video is unchanged. Try the upload again.</p>}
    {!cameraActive && <div className="video-status-actions"><Button variant="ghost" disabled={busy || query.isFetching} onClick={()=>void query.refetch()}>Refresh video status</Button><small>Publishing and sharing are separate steps.</small></div>}
  </section>;
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
