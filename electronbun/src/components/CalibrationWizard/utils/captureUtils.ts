/**
 * Grabs a single frame from a MediaStream and returns it as an ImageBitmap.
 * The caller is responsible for closing the bitmap when done.
 */
export async function grabFrame(stream: MediaStream): Promise<ImageBitmap> {
  const track = stream.getVideoTracks()[0];
  if (!track) {
    throw new Error("No video track found in stream");
  }
  // ImageCapture API is available in Chromium-based renderers (Electron/Electrobun)
  const imageCapture = new ImageCapture(track);
  return imageCapture.grabFrame();
}

/**
 * Like grabFrame, but retries on transient failures (e.g. camera not ready between frames).
 * @param stream   The MediaStream to capture from.
 * @param retries  Number of extra attempts after the first failure (default 3).
 * @param retryDelay  Milliseconds to wait between attempts (default 250 ms).
 */
export async function grabFrameWithRetry(
  stream: MediaStream,
  retries = 3,
  retryDelay = 250,
): Promise<ImageBitmap> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await grabFrame(stream);
    } catch (err) {
      lastErr = err;
      if (attempt < retries) {
        await new Promise<void>((resolve) => setTimeout(resolve, retryDelay));
      }
    }
  }
  throw lastErr;
}

/**
 * Converts an ImageBitmap to an object URL (PNG blob).
 * The caller must call URL.revokeObjectURL() on the returned URL when done.
 */
export async function bitmapToObjectUrl(bitmap: ImageBitmap): Promise<string> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Failed to get 2D context from OffscreenCanvas");
  }
  ctx.drawImage(bitmap, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return URL.createObjectURL(blob);
}
