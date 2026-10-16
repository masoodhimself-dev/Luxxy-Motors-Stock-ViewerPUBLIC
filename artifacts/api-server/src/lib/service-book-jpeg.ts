/** Only small JPEGs. Remove all APP/EXIF/XMP/COM segments before private storage. */
export function serviceBookJpeg(encoded: string) {
  if (
    !encoded ||
    encoded.length > 690000 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
  )
    throw new Error("Choose a compressed JPEG photo under 500 KB.");
  const input = Buffer.from(encoded, "base64");
  if (
    input.length > 512000 ||
    input.length < 12 ||
    input[0] !== 255 ||
    input[1] !== 216
  )
    throw new Error("Choose a JPEG photo under 500 KB.");
  const parts = [input.subarray(0, 2)];
  let offset = 2,
    width = 0,
    height = 0,
    scan = false;
  while (offset < input.length) {
    const start = offset;
    if (input[offset++] !== 255) throw new Error("Invalid JPEG photo.");
    while (input[offset] === 255) offset++;
    const marker = input[offset++];
    if (marker === 217) break;
    if (marker === 0 || marker === 216 || (marker >= 208 && marker <= 215))
      throw new Error("Invalid JPEG photo.");
    if (offset + 2 > input.length) throw new Error("Invalid JPEG photo.");
    const length = input.readUInt16BE(offset),
      end = offset + length;
    if (length < 2 || end > input.length)
      throw new Error("Invalid JPEG photo.");
    if (marker === 192) {
      if (length < 8) throw new Error("Invalid JPEG photo.");
      height = input.readUInt16BE(offset + 3);
      width = input.readUInt16BE(offset + 5);
    }
    if (marker === 218) {
      if (input[input.length - 2] !== 255 || input[input.length - 1] !== 217)
        throw new Error("Invalid JPEG photo.");
      for (let i = end; i < input.length - 2; i++) {
        if (input[i] !== 255) continue;
        const next = input[++i];
        if (next !== 0 && !(next >= 208 && next <= 215))
          throw new Error(
            "Choose a standard JPEG photo without extra scan metadata.",
          );
      }
      parts.push(input.subarray(start));
      scan = true;
      break;
    }
    if (!(marker >= 224 && marker <= 239) && marker !== 254)
      parts.push(input.subarray(start, end));
    offset = end;
  }
  if (!scan || !width || !height || width > 2000 || height > 2000)
    throw new Error("Resize photos to at most 2000 pixels before uploading.");
  return { bytes: Buffer.concat(parts), width, height };
}
