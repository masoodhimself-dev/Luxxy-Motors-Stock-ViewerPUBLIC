import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
/** Camera access starts only on a staff click. All tracks stop on stop/cancel/unmount. */
export function VideoRecorder({
  disabled,
  onRecorded,
}: {
  disabled: boolean;
  onRecorded: (file: File) => void;
}) {
  const [active, setActive] = useState(false),
    [recording, setRecording] = useState(false),
    [seconds, setSeconds] = useState(0),
    [error, setError] = useState(""),
    [clip, setClip] = useState<{ file: File; url: string } | null>(null);
  const preview = useRef<HTMLVideoElement>(null),
    stream = useRef<MediaStream | null>(null),
    recorder = useRef<MediaRecorder | null>(null),
    clock = useRef<ReturnType<typeof setInterval> | null>(null),
    deadline = useRef<ReturnType<typeof setTimeout> | null>(null),
    alive = useRef(true),
    generation = useRef(0),
    clipUrl = useRef("");
  function release() {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (clock.current) clearInterval(clock.current);
    if (deadline.current) clearTimeout(deadline.current);
    clock.current = null;
    deadline.current = null;
  }
  function cancel() {
    generation.current++;
    if (recorder.current?.state === "recording") recorder.current.stop();
    release();
    setActive(false);
    setRecording(false);
    if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    clipUrl.current = "";
    setClip(null);
  }
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      generation.current++;
      if (recorder.current?.state === "recording") recorder.current.stop();
      release();
      if (clipUrl.current) URL.revokeObjectURL(clipUrl.current);
    };
  }, []);
  useEffect(() => {
    if (preview.current && stream.current)
      preview.current.srcObject = stream.current;
  }, [active]);
  async function start() {
    const version = ++generation.current;
    setError("");
    if (
      !navigator.mediaDevices?.getUserMedia ||
      typeof MediaRecorder === "undefined"
    ) {
      setError(
        "Recording is unavailable in this browser. Use Upload video, or record a clip with your phone camera.",
      );
      return;
    }
    setActive(true);
    try {
      const camera = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: true,
      });
      if (!alive.current || version !== generation.current) {
        camera.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = camera;
      if (preview.current) preview.current.srcObject = camera;
      const mime = [
        "video/mp4",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      if (!mime)
        throw new Error(
          "This browser cannot record a supported video. Use Upload video instead.",
        );
      const recordingDevice = new MediaRecorder(camera, {
        mimeType: mime,
        videoBitsPerSecond: 1800000,
        audioBitsPerSecond: 64000,
      });
      recorder.current = recordingDevice;
      const chunks: BlobPart[] = [];
      let byteSize = 0;
      recordingDevice.ondataavailable = (event) => {
        if (event.data.size) {
          byteSize += event.data.size;
          chunks.push(event.data);
          if (
            byteSize > 200 * 1024 * 1024 &&
            recordingDevice.state === "recording"
          )
            recordingDevice.stop();
        }
      };
      recordingDevice.onerror = () => {
        generation.current++;
        release();
        if (alive.current) {
          setRecording(false);
          setActive(false);
          setError("Recording failed. Please try again or upload a video.");
        }
      };
      recordingDevice.onstop = () => {
        release();
        if (!alive.current || version !== generation.current) return;
        setRecording(false);
        setActive(false);
        if (!byteSize || byteSize > 200 * 1024 * 1024) {
          setError("The recording could not be saved. Try again.");
          return;
        }
        const type = mime.startsWith("video/mp4") ? "video/mp4" : "video/webm",
          file = new File(
            chunks,
            `walkaround.${type === "video/mp4" ? "mp4" : "webm"}`,
            { type },
          );
        const url = URL.createObjectURL(file);
        clipUrl.current = url;
        setClip({ file, url });
      };
      recordingDevice.start(1000);
      setRecording(true);
      setSeconds(0);
      const began = Date.now();
      clock.current = setInterval(
        () => setSeconds(Math.min(30, Math.floor((Date.now() - began) / 1000))),
        250,
      );
      deadline.current = setTimeout(() => {
        if (recordingDevice.state === "recording") recordingDevice.stop();
      }, 29000);
    } catch (cause) {
      release();
      if (alive.current && version === generation.current) {
        setActive(false);
        setRecording(false);
        setError(
          cause instanceof Error
            ? cause.message
            : "Camera access was not available. Upload an existing clip instead.",
        );
      }
    }
  }
  return (
    <div className="video-recorder">
      {error && <p role="alert">{error}</p>}
      {active && (
        <>
          <video
            ref={preview}
            autoPlay
            muted
            playsInline
            aria-label="Camera preview"
          />
          <p role="status">
            {recording
              ? `Recording ${seconds}s / 30s · stops automatically`
              : "Waiting for camera permission…"}
          </p>
          {recording && (
            <Button onClick={() => recorder.current?.stop()}>
              Stop recording
            </Button>
          )}
          <Button variant="outline" onClick={cancel}>
            Cancel recording
          </Button>
        </>
      )}
      {clip && (
        <>
          <h4>Recorded clip</h4>
          <video src={clip.url} controls playsInline />
          <p>
            Review this recording, then upload it for compression. It is not on
            the website.
          </p>
          <Button
            disabled={disabled}
            onClick={() => {
              onRecorded(clip.file);
              cancel();
            }}
          >
            Use recording
          </Button>
          <Button variant="outline" onClick={cancel}>
            Discard recording
          </Button>
        </>
      )}
      {!active && !clip && (
        <Button
          variant="outline"
          disabled={disabled}
          onClick={() => void start()}
        >
          Record new video
        </Button>
      )}
    </div>
  );
}
