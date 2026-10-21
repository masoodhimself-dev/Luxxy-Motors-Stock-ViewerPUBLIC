import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { stat } from "node:fs/promises";
const require = createRequire(import.meta.url);
const exec = promisify(execFile);
export const videoLimits = {
  seconds: 20,
  sourceBytes: 200 * 1024 * 1024,
  outputBytes: 5 * 1024 * 1024,
  dailyUploads: 40,
  storedBytes: 2 * 1024 * 1024 * 1024,
  storedUploads: 1000,
};
export class VideoError extends Error {
  constructor(
    message: string,
    readonly status = 422,
  ) {
    super(message);
  }
}
export function videoBinaries() {
  return {
    ffmpeg: process.env.FFMPEG_PATH || (require("ffmpeg-static") as string),
    ffprobe:
      process.env.FFPROBE_PATH ||
      (require("ffprobe-static") as { path: string }).path,
  };
}
export function validateVideoProbe(raw: unknown) {
  const result = raw as {
    format?: { duration?: string };
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      duration?: string;
      avg_frame_rate?: string;
    }>;
  };
  const videos =
    result.streams?.filter((stream) => stream.codec_type === "video") ?? [];
  const video = videos[0];
  const duration = Math.max(
    Number(result.format?.duration ?? 0),
    Number(video?.duration ?? 0),
  );
  if (
    videos.length !== 1 ||
    !video ||
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > videoLimits.seconds
  )
    throw new VideoError(
      "Choose a video no longer than 20 seconds. Trim a longer clip before uploading.",
    );
  if (
    !video.width ||
    !video.height ||
    video.width < 16 ||
    video.height < 16 ||
    Math.max(video.width, video.height) > 4096 ||
    video.width * video.height > 9_000_000
  )
    throw new VideoError("Choose a video up to 4K resolution.");
  return { duration, width: video.width, height: video.height };
}
export async function probeVideo(filename: string) {
  const { ffprobe } = videoBinaries();
  try {
    const { stdout } = await exec(
      ffprobe,
      [
        "-v",
        "error",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "mov,matroska,webm",
        "-show_entries",
        "format=duration:stream=codec_type,width,height,duration,avg_frame_rate",
        "-of",
        "json",
        filename,
      ],
      { timeout: 15000, maxBuffer: 64 * 1024, windowsHide: true },
    );
    return validateVideoProbe(JSON.parse(stdout));
  } catch (error) {
    if (error instanceof VideoError) throw error;
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT")
      throw new VideoError(
        "The video encoder is not installed on this server.",
        503,
      );
    throw new VideoError("This video could not be read. Try an MP4 clip.");
  }
}
export async function compressVehicleVideo(input: string, output: string) {
  const source = await probeVideo(input);
  const { ffmpeg } = videoBinaries();
  await exec(
    ffmpeg,
    [
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-protocol_whitelist",
      "file,pipe",
      "-format_whitelist",
      "mov,matroska,webm",
      "-threads",
      "1",
      "-i",
      input,
      "-map",
      "0:v:0",
      "-map",
      "0:a:0?",
      "-map_metadata",
      "-1",
      "-map_chapters",
      "-1",
      "-t",
      String(source.duration),
      "-vf",
      "scale='min(720,iw)':'min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1",
      "-r",
      "30",
      "-c:v",
      "libx264",
      "-threads",
      "1",
      "-preset",
      "veryfast",
      "-profile:v",
      "main",
      "-pix_fmt",
      "yuv420p",
      "-b:v",
      "1100k",
      "-maxrate",
      "1300k",
      "-bufsize",
      "2200k",
      "-c:a",
      "aac",
      "-b:a",
      "64k",
      "-ac",
      "2",
      "-movflags",
      "+faststart",
      "-y",
      output,
    ],
    {
      timeout: 90000,
      killSignal: "SIGKILL",
      maxBuffer: 128 * 1024,
      windowsHide: true,
    },
  );
  const size = (await stat(output)).size;
  // AAC/container rounding may add a fraction of a frame. The source is strictly <=20s.
  if (!size || size > videoLimits.outputBytes)
    throw new VideoError(
      "The compressed clip is too large. Try a shorter clip.",
    );
  return { ...(await probeVideo(output)), byteSize: size };
}
