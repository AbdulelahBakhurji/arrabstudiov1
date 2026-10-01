/**
 * Turns a picked file or a live camera frame into a small, square, on-device
 * avatar. Everything happens in a canvas — nothing leaves the machine, and
 * the result is compressed before it ever touches localStorage.
 */

const MAX_SOURCE_BYTES = 20 * 1024 * 1024; // 20MB — generous, still bails before it hangs the tab

export class AvatarImageError extends Error {}

function loadImageBitmapFromFile(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (file.size > MAX_SOURCE_BYTES) {
    return Promise.reject(new AvatarImageError("too-large"));
  }
  if ("createImageBitmap" in window) {
    return createImageBitmap(file).catch(() => {
      throw new AvatarImageError("unreadable");
    });
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new AvatarImageError("unreadable"));
    };
    img.src = url;
  });
}

function drawSquare(
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  size: number,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new AvatarImageError("no-canvas");
  // Center-crop to a square before scaling, so a portrait or landscape photo
  // doesn't get squeezed — it gets framed, the way every avatar picker does.
  const side = Math.min(sourceWidth, sourceHeight);
  const sx = (sourceWidth - side) / 2;
  const sy = (sourceHeight - side) / 2;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL("image/webp", 0.86);
}

/** File the person picked or dropped — cropped to a centered square, ~240px. */
export async function fileToAvatarDataUrl(file: File, size = 240): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new AvatarImageError("not-an-image");
  }
  const bitmap = await loadImageBitmapFromFile(file);
  const w = "width" in bitmap ? bitmap.width : 0;
  const h = "height" in bitmap ? bitmap.height : 0;
  if (!w || !h) throw new AvatarImageError("unreadable");
  try {
    return drawSquare(bitmap, w, h, size);
  } finally {
    if ("close" in bitmap) bitmap.close();
  }
}

/** One frame from a live <video> stream, same centered-square treatment. */
export function videoFrameToAvatarDataUrl(video: HTMLVideoElement, size = 240): string {
  if (!video.videoWidth || !video.videoHeight) {
    throw new AvatarImageError("no-frame");
  }
  return drawSquare(video, video.videoWidth, video.videoHeight, size);
}
