import { createReadStream } from "node:fs";
import { mkdir, copyFile, stat, open } from "node:fs/promises";
import path from "node:path";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
export function mediaStorageConfigured(env = process.env) {
  return (
    Boolean(
      env.VIDEO_S3_ENDPOINT &&
      env.VIDEO_S3_BUCKET &&
      env.VIDEO_S3_ACCESS_KEY_ID &&
      env.VIDEO_S3_SECRET_ACCESS_KEY,
    ) ||
    (env.NODE_ENV !== "production" && Boolean(env.VIDEO_STORAGE_DIR))
  );
}
let sharedS3Client: S3Client | undefined;
export function videoStorage() {
  if (!mediaStorageConfigured())
    throw new Error("Video storage is not configured.");
  const local =
    process.env.NODE_ENV !== "production" && process.env.VIDEO_STORAGE_DIR;
  const client = local
    ? null
    : (sharedS3Client ??= new S3Client({
        endpoint: process.env.VIDEO_S3_ENDPOINT,
        region: process.env.VIDEO_S3_REGION || "auto",
        forcePathStyle: true,
        credentials: {
          accessKeyId: process.env.VIDEO_S3_ACCESS_KEY_ID!,
          secretAccessKey: process.env.VIDEO_S3_SECRET_ACCESS_KEY!,
        },
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
      }));
  const safe = (key: string) => {
    if (!/^[a-zA-Z0-9_/-]+\.mp4$/.test(key) || key.includes(".."))
      throw new Error("Invalid media key.");
    return key;
  };
  return {
    async put(key: string, file: string) {
      safe(key);
      if (local) {
        const destination = path.join(local, key);
        await mkdir(path.dirname(destination), {
          recursive: true,
          mode: 0o700,
        });
        await copyFile(file, destination);
        return;
      }
      await client!.send(
        new PutObjectCommand({
          Bucket: process.env.VIDEO_S3_BUCKET,
          Key: key,
          Body: createReadStream(file),
          ContentType: "video/mp4",
          ContentLength: (await stat(file)).size,
        }),
        { abortSignal: AbortSignal.timeout(60000) },
      );
    },
    async read(key: string, range?: string) {
      safe(key);
      if (local) {
        const filename = path.join(local, key);
        const size = (await stat(filename)).size;
        const selected = videoRange(range, size);
        const file = await open(filename, "r");
        return {
          body: file.createReadStream({
            ...(selected ? { start: selected.start, end: selected.end } : {}),
            autoClose: true,
          }),
          size,
          selected,
        };
      }
      const object = await client!.send(
        new GetObjectCommand({
          Bucket: process.env.VIDEO_S3_BUCKET,
          Key: key,
          ...(range ? { Range: range } : {}),
        }),
        { abortSignal: AbortSignal.timeout(60000) },
      );
      return {
        body: object.Body as NodeJS.ReadableStream,
        size: Number(
          object.ContentRange?.split("/")[1] ?? object.ContentLength,
        ),
        selected: object.ContentRange
          ? {
              start: Number(object.ContentRange.match(/(\d+)-/)?.[1]),
              end: Number(object.ContentRange.match(/-(\d+)\//)?.[1]),
            }
          : null,
      };
    },
  };
}
export function videoRange(value: string | undefined, size: number) {
  if (!value) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) throw new Error("Invalid range.");
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end = match[1]
    ? match[2]
      ? Math.min(size - 1, Number(match[2]))
      : size - 1
    : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    throw new Error("Invalid range.");
  return { start, end };
}
