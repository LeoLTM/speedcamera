// Augments the TypeScript DOM lib to include ImageCapture.grabFrame(), which
// is part of the MediaStream Image Capture API (W3C) but missing from older
// TypeScript DOM typings.
interface ImageCapture {
  grabFrame(): Promise<ImageBitmap>;
}
