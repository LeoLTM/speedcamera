import path from "path";
import { getUserDataDir } from "./database";

function getImageDir(): string {
  return path.join(getUserDataDir(), "images");
}

async function ensureImageDir(): Promise<void> {
  await Bun.write(path.join(getImageDir(), ".keep"), "");
}

/**
 * Save an image from a raw base64 string (no data-URL prefix).
 * Returns the absolute path of the saved file.
 */
export async function saveImage(base64: string): Promise<string> {
  await ensureImageDir();

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const filename = `speed-violation-${timestamp}.png`;
  const filePath = path.join(getImageDir(), filename);

  const buffer = Buffer.from(base64, "base64");
  await Bun.write(filePath, buffer);

  return filePath;
}

/**
 * Read an image from disk and return it as a data-URL.
 * Returns null if the file does not exist.
 */
export async function readImageAsDataUrl(imagePath: string): Promise<string | null> {
  const file = Bun.file(imagePath);
  const exists = await file.exists();
  if (!exists) return null;

  const buffer = await file.arrayBuffer();
  const base64 = Buffer.from(buffer).toString("base64");
  const ext = path.extname(imagePath).toLowerCase();
  const mime = ext === ".png" ? "image/png" : "image/jpeg";

  return `data:${mime};base64,${base64}`;
}

/**
 * Delete an image file from disk. Silently ignores missing files.
 */
export async function deleteImage(imagePath: string): Promise<void> {
  try {
    const file = Bun.file(imagePath);
    const exists = await file.exists();
    if (exists) {
      const { unlink } = await import("fs/promises");
      await unlink(imagePath);
    }
  } catch (err) {
    console.error(`[filestore] Failed to delete image ${imagePath}:`, err);
  }
}
