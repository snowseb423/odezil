/**
 * Prépare une photo de bon avant envoi : redimensionnée (1600 px max) et
 * recompressée en JPEG, pour un envoi rapide depuis le téléphone. Si le
 * navigateur ne sait pas décoder l'image (ex. HEIC hors Safari), l'original
 * est conservé.
 */
const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.8;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
};

export type PreparedPhoto = { blob: Blob; contentType: string; extension: string };

export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("canvas indisponible");
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY));
    if (!blob) throw new Error("compression impossible");
    return { blob, contentType: "image/jpeg", extension: "jpg" };
  } catch {
    const extension = EXTENSIONS[file.type];
    if (!extension) {
      throw new Error("Format de photo non pris en charge (JPEG, PNG, WebP ou HEIC).");
    }
    return { blob: file, contentType: file.type, extension };
  }
}
