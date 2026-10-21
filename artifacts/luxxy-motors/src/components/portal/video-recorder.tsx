import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Camera } from "@/components/icons";

export function usePhoneCamera() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    // Tablets and desktop browsers keep upload and QR, rather than recording controls.
    setPhone(/iPhone|iPod|Android.*Mobile/i.test(navigator.userAgent));
  }, []);
  return phone;
}
/** Camera access is deliberate; QR links retain normal staff authentication. */
export function VideoRecorder({ disabled, onRecorded, onActiveChange }: {
  disabled: boolean; onRecorded: (file: File) => void | boolean | Promise<void | boolean>;
  onActiveChange?: (active: boolean) => void;
}) {
  const phone = usePhoneCamera();
  const [phase, setPhase] = useState<"idle" | "opening" | "ready" | "recording" | "paused">("idle");
  const [landscape, setLandscape] = useState(() => window.innerWidth > window.innerHeight);
  const [seconds, setSeconds] = useState(0), [error, setError] = useState("");
  const [clip, setClip] = useState<{ file: File; url: string } | null>(null);
  const [saving, setSaving] = useState(false), [pauseReason, setPauseReason] = useState("");
  const preview = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null);
  const recorder = useRef<MediaRecorder | null>(null), timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const elapsed = useRef(0), began = useRef(0), alive = useRef(true), generation = useRef(0), clipUrl = useRef("");
  const savingRef = useRef(false);
  const activityCallback = useRef(onActiveChange);
  activityCallback.current = onActiveChange;
  const active = phase !== "idle";
  useEffect(() => { activityCallback.current?.(active || Boolean(clip)); }, [active, clip]);
  useEffect(() => () => activityCallback.current?.(false), []);
  function release() {
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    if (timer.current) clearInterval(timer.current); timer.current = null;
  }
  function pause(reason = "Recording paused. Tap Resume when you’re ready.") {
    if (recorder.current?.state !== "recording") return;
    try {
      recorder.current.pause(); elapsed.current += Date.now() - began.current;
      setSeconds(Math.floor(elapsed.current / 1000)); setPauseReason(reason); setPhase("paused");
    } catch { setError("The camera could not pause. Finish this clip before leaving the page."); }
  }
  function stopCamera() {
    generation.current++;
    if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
    release(); recorder.current = null; setPhase("idle");
  }
  function discardClip() {
    if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    clipUrl.current = ""; setClip(null);
  }
  function cancel() {
    if (savingRef.current) return;
    stopCamera(); discardClip(); setError(""); setPauseReason(""); setSeconds(0);
  }
  useEffect(() => {
    alive.current = true;
    const update = () => { const wide = window.innerWidth > window.innerHeight; setLandscape(wide); if (!wide) pause("Recording paused. Turn your phone sideways, then tap Resume."); };
    const hidden = () => { if (document.hidden) pause("Recording paused while you were away. Tap Resume when you’re ready."); };
    window.addEventListener("resize", update); window.addEventListener("orientationchange", update);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      alive.current = false; generation.current++;
      if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
      release(); if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
      window.removeEventListener("resize", update); window.removeEventListener("orientationchange", update);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  // Uploading disables the editor, but must not destroy its only copy of a finished recording.
  useEffect(() => { if (disabled) stopCamera(); }, [disabled]);
  useEffect(() => { if (preview.current && stream.current) preview.current.srcObject = stream.current; }, [phase]);
  async function open() {
    if (!phone || disabled || !landscape) return;
    const version = ++generation.current; setError("");
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Camera recording is unavailable. Open this page in Safari or Chrome on your phone, or upload a video."); return;
    }
    setPhase("opening");
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 }, aspectRatio: { ideal: 16 / 9 } }, audio: true });
      if (!alive.current || version !== generation.current) { camera.getTracks().forEach(t => t.stop()); return; }
      if (document.hidden) {
        camera.getTracks().forEach(t => t.stop()); setPhase("idle");
        setError("Camera access finished while this page was in the background. Tap Record new video to try again."); return;
      }
      camera.getTracks().forEach(track => track.addEventListener?.("ended", () => {
        if (!alive.current || version !== generation.current) return;
        if (recorder.current && recorder.current.state !== "inactive") recorder.current.stop();
        else { stopCamera(); setError("Camera access ended. Tap Record new video to reconnect, or upload an existing video."); }
      }, { once: true }));
      stream.current = camera; if (preview.current) preview.current.srcObject = camera; setPhase("ready");
    } catch (cause) {
      // A dismissed permission request may reject after a newer request has already succeeded.
      if (!alive.current || version !== generation.current) return;
      release(); setPhase("idle");
      const name = cause && typeof cause === "object" && "name" in cause && typeof cause.name === "string" ? cause.name : "";
      setError(name === "NotAllowedError" || name === "PermissionDeniedError"
        ? "Camera or microphone permission was denied. Allow both in your browser’s site settings, then try again. You can also upload an existing video."
        : name === "NotReadableError" || name === "TrackStartError"
          ? "The camera is being used by another app. Close it, then try again or upload an existing video."
          : name === "NotFoundError" || name === "DevicesNotFoundError"
            ? "No camera or microphone was found. Check your phone’s camera access, or upload an existing video."
            : cause instanceof Error ? cause.message : "Camera permission was not available. Try again or upload an existing video.");
    }
  }
  function start() {
    if (!landscape || disabled || !stream.current) return;
    const video = preview.current;
    if (!video || !video.videoWidth || video.videoWidth <= video.videoHeight) { setError("Wait for a landscape camera preview before recording. Keep your phone sideways."); return; }
    const mime = ["video/mp4", "video/webm;codecs=vp8,opus", "video/webm"].find(t => MediaRecorder.isTypeSupported(t));
    if (!mime) { setError("This browser cannot record a supported video. Upload a clip instead."); return; }
    try {
      const version = generation.current;
      const device = new MediaRecorder(stream.current, { mimeType: mime, videoBitsPerSecond: 1800000, audioBitsPerSecond: 64000 });
      recorder.current = device; const chunks: BlobPart[] = []; let bytes = 0;
      device.ondataavailable = e => { if (version === generation.current && e.data.size) { bytes += e.data.size; chunks.push(e.data); if (bytes > 200 * 1024 * 1024 && device.state !== "inactive") device.stop(); } };
      device.onerror = () => {
        if (!alive.current || version !== generation.current) return;
        stopCamera(); setError("Recording failed. Please try again or upload a clip.");
      };
      device.onstop = () => {
        if (!alive.current || version !== generation.current) return;
        release(); recorder.current = null; setPhase("idle");
        if (!bytes || bytes > 200 * 1024 * 1024) { setError("The recording could not be saved. Try again."); return; }
        const type = mime.startsWith("video/mp4") ? "video/mp4" : "video/webm";
        const file = new File(chunks, `walkaround.${type === "video/mp4" ? "mp4" : "webm"}`, { type });
        const url = URL.createObjectURL(file); clipUrl.current = url; setClip({ file, url });
      };
      elapsed.current = 0; began.current = Date.now(); setSeconds(0); setError(""); setPauseReason("");
      device.start(250); setPhase("recording");
      // Count recorded time only; pauses do not consume the allowance. Leave headroom for encoder rounding.
      timer.current = setInterval(() => {
        const ms = elapsed.current + (device.state === "recording" ? Date.now() - began.current : 0);
        setSeconds(Math.min(30, Math.floor(ms / 1000)));
        if (ms >= 29000 && device.state !== "inactive") device.stop();
      }, 100);
    } catch { release(); setPhase("idle"); setError("Recording could not start. Please try again."); }
  }
  function resume() {
    if (!landscape || document.hidden || disabled || recorder.current?.state !== "paused") return;
    if (!preview.current?.videoWidth || preview.current.videoWidth <= preview.current.videoHeight) { setError("Wait for a landscape camera preview before resuming."); return; }
    try {
      recorder.current.resume(); began.current = Date.now(); setError(""); setPauseReason(""); setPhase("recording");
    } catch { setError("The camera could not resume. Finish this clip, then record another if needed."); }
  }
  async function useRecording() {
    if (!clip || disabled || savingRef.current) return;
    savingRef.current = true; setSaving(true); setError("");
    try {
      const saved = await onRecorded(clip.file);
      if (!alive.current) return;
      if (saved === false) setError("Your recording is still here. Check the upload message, then tap Use recording to retry.");
      else discardClip();
    } catch {
      if (alive.current) setError("Upload failed. Your recording is still here. Tap Use recording to retry.");
    } finally {
      savingRef.current = false; if (alive.current) setSaving(false);
    }
  }
  if (!phone) return null;
  return <div className="video-recorder">
    {error && <p role="alert">{error}</p>}
    {!active && !clip && <div className="video-camera-placeholder"><Camera aria-hidden="true" /><h4>Record a walkaround</h4><p>{landscape ? "Your camera opens when you tap Record new video." : "Turn your phone sideways to get started."}</p></div>}
    {!landscape && !clip && active && <p role="status" className="video-orientation">Turn your phone sideways. Recording is landscape only.{phase === "paused" ? " Recording paused — rotate back, then tap Resume." : ""}</p>}
    {active && <>
      <video ref={preview} autoPlay muted playsInline aria-label="Camera preview" />
      <p role="timer" aria-label="Recording time" className="video-recording-timer">{String(Math.floor(seconds / 60)).padStart(2,"0")}:{String(seconds % 60).padStart(2,"0")} / 00:30 <span>{phase === "paused" ? "Paused" : phase === "recording" ? "Recording" : phase === "opening" ? "Waiting for camera permission…" : "Ready"}</span></p>
      {phase === "paused" && landscape && <p role="status" className="video-recorder-hint">{pauseReason}</p>}
      <div className="vehicle-video-actions">
        {phase === "ready" && <Button disabled={!landscape || disabled} onClick={start}>Start recording</Button>}
        {phase === "recording" && <Button onClick={() => pause()}>Pause recording</Button>}
        {phase === "paused" && <Button disabled={!landscape || disabled} onClick={resume}>Resume recording</Button>}
        {(phase === "recording" || phase === "paused") && <Button onClick={() => recorder.current?.stop()}>Finish recording</Button>}
        <Button variant="outline" onClick={cancel}>Cancel recording</Button>
      </div>
    </>}
    {clip && <><h4>Recorded clip</h4><video src={clip.url} controls playsInline aria-label="Recorded clip preview" /><p>Review your clip, then upload it for compression. It stays a draft until staff publish it.</p>{saving && <p role="status">Saving your recording… Keep this page open.</p>}<div className="vehicle-video-actions"><Button disabled={disabled || saving} onClick={() => void useRecording()}>{saving ? "Saving recording…" : "Use recording"}</Button><Button variant="outline" disabled={disabled || saving} onClick={cancel}>Discard recording</Button></div></>}
    {!active && !clip && <Button variant="outline" disabled={disabled || !landscape} onClick={() => void open()}>Record new video</Button>}
  </div>;
}
