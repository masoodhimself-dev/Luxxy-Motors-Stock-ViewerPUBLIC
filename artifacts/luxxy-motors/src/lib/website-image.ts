export type WebsiteImageKind = 'logo' | 'photo' | 'icon';

export function validateWebsiteImageFile(file: Pick<File, 'type' | 'size'>) {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a PNG, JPEG or WebP image. Export HEIC or SVG files as PNG first.');
  }
  if (!file.size || file.size > 20 * 1024 * 1024) {
    throw new Error('Choose an image smaller than 20 MB.');
  }
}

/** Resize pixels locally; neither the filename nor camera metadata is uploaded. */
export async function prepareWebsiteImage(file: File, kind: WebsiteImageKind): Promise<string> {
  validateWebsiteImageFile(file);
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('This image could not be opened. Try exporting it as PNG or JPEG.'));
      image.src = source;
    });
    const pixels = image.naturalWidth * image.naturalHeight;
    if (!pixels || pixels > 60_000_000) throw new Error('This image is too large. Export a smaller version first.');
    let longestSide = kind === 'photo' ? 1920 : kind === 'icon' ? 256 : 1200;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image preparation is unavailable in this browser.');
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, longestSide / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.clearRect(0, 0, canvas.width, canvas.height);
      if (kind === 'photo') {
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const prepared = canvas.toDataURL(kind === 'photo' ? 'image/jpeg' : 'image/png', 0.84);
      // Keep well below the API's decoded image and JSON request limits.
      if (prepared.length < 1_400_000) return prepared;
      longestSide = Math.floor(longestSide * 0.7);
    }
    throw new Error('This image could not be reduced enough. Export a smaller image and try again.');
  } finally {
    URL.revokeObjectURL(source);
  }
}
