const MAX_SIDE = 1000;
const KEEP_BYTES = 350_000;

/**
 * Downscale large card images so decks stay small enough to store and send to the
 * opponent, while keeping card text readable in the zoom preview.
 */
export async function processImage(blob: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bmp = await createImageBitmap(blob);
  const { width, height } = bmp;
  const longest = Math.max(width, height);
  if (longest <= MAX_SIDE && blob.size <= KEEP_BYTES) {
    bmp.close();
    return { blob, width, height };
  }
  const scale = Math.min(1, MAX_SIDE / longest);
  const w = Math.round(width * scale);
  const hgt = Math.round(height * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = hgt;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, hgt);
  bmp.close();
  let out = await toBlob(canvas, 'image/webp', 0.88);
  if (!out || out.type !== 'image/webp') out = await toBlob(canvas, 'image/jpeg', 0.9);
  if (!out) return { blob, width, height };
  return { blob: out, width: w, height: hgt };
}

function toBlob(canvas: HTMLCanvasElement, type: string, q: number): Promise<Blob | null> {
  return new Promise((r) => canvas.toBlob(r, type, q));
}

export function mimeFromName(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png': return 'image/png';
    case 'jpg':
    case 'jpeg': return 'image/jpeg';
    case 'webp': return 'image/webp';
    case 'gif': return 'image/gif';
    case 'bmp': return 'image/bmp';
    case 'avif': return 'image/avif';
    default: return 'application/octet-stream';
  }
}
