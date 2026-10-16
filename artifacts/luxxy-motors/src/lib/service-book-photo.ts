export type PreparedPhoto = { base64: string; preview: string; bytes: number };
/** Canvas re-encodes pixels only: camera EXIF/location and original filenames are not sent. */
export async function prepareServicePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith("image/") || file.size > 20 * 1024 * 1024)
    throw new Error("Choose a photo smaller than 20 MB.");
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(
          new Error(
            "This photo format could not be opened. Choose JPEG or PNG, or take a new photo.",
          ),
        );
      image.src = url;
    });
    if (
      !image.naturalWidth ||
      image.naturalWidth * image.naturalHeight > 60000000
    )
      throw new Error("Choose a smaller photo.");
    const scale = Math.min(
        1,
        1600 / Math.max(image.naturalWidth, image.naturalHeight),
      ),
      canvas = document.createElement("canvas");
    canvas.width = Math.round(image.naturalWidth * scale);
    canvas.height = Math.round(image.naturalHeight * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx)
      throw new Error("Photo preparation is unavailable on this browser.");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.72, 0.62, 0.52]) {
      const preview = canvas.toDataURL("image/jpeg", quality),
        base64 = preview.split(",")[1],
        bytes =
          Math.floor((base64.length * 3) / 4) -
          (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);
      if (bytes <= 512000) return { base64, preview, bytes };
    }
    throw new Error(
      "This photo could not be reduced below 500 KB. Try photographing one page at a time.",
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}
