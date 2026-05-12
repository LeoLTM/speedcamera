import { useState, useRef, useCallback, useEffect } from "react";
import { useAppStore } from "@/stores/useAppStore";
import { getRpc } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { grabFrame, bitmapToObjectUrl } from "../utils/captureUtils";
import { detectDominantBrightColor } from "../utils/colorDetect";
import type { FlashColor } from "../types";
import { cn } from "@/lib/utils";

interface Step3ColorDetectProps {
  originalFlashDuration: number;
  onNext: (flashColor: FlashColor) => void;
  onBack: () => void;
}

type Phase = "idle" | "flashing" | "detecting" | "preview" | "manual-pick";

/** HSL colour from an ImageData RGBA pixel at (x, y). Returns null for achromatic. */
function sampleHslAt(
  data: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): { h: number; s: number; l: number } {
  const idx = (Math.round(y) * width + Math.round(x)) * 4;
  const r = data[idx] / 255;
  const g = data[idx + 1] / 255;
  const b = data[idx + 2] / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  let h = 0;
  let s = 0;

  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export function Step3ColorDetect({ originalFlashDuration, onNext, onBack }: Step3ColorDetectProps) {
  const cameraStream = useAppStore((s) => s.cameraStream);

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [capturedUrl, setCapturedUrl] = useState<string | null>(null);
  const [flashColor, setFlashColor] = useState<FlashColor | null>(null);
  const [hoverColor, setHoverColor] = useState<{ h: number; s: number; l: number } | null>(null);

  // Refs for the manual-pick canvas
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageDataRef = useRef<{ data: Uint8ClampedArray; width: number } | null>(null);
  const capturedBitmapRef = useRef<ImageBitmap | null>(null);

  // Close the ImageBitmap on unmount to release GPU memory
  useEffect(() => {
    return () => {
      capturedBitmapRef.current?.close();
      capturedBitmapRef.current = null;
    };
  }, []);

  const handleTriggerFlash = useCallback(async () => {
    if (!cameraStream) return;
    setError(null);
    setPhase("flashing");

    try {
      // 1. Override flashDuration to 2000 ms for a highly visible test flash
      await getRpc().request.sendCommand({
        json: JSON.stringify({ command: "setFlashDuration", value: 2000 }),
      });

      // 2. Trigger the flash
      await getRpc().request.sendCommand({
        json: JSON.stringify({ command: "flash" }),
      });

      // 3. Wait 1000 ms so the flash is captured mid-exposure
      await sleep(1000);

      // 4. Grab frame
      setPhase("detecting");
      const bitmap = await grabFrame(cameraStream);
      capturedBitmapRef.current = bitmap;

      // 5. Convert to object URL for display
      const url = await bitmapToObjectUrl(bitmap);
      setCapturedUrl(url);

      // 6. Auto-detect dominant colour
      const detected = detectDominantBrightColor(bitmap);
      setFlashColor(detected);

      setPhase("preview");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error during flash capture");
      setPhase("idle");
    } finally {
      // Always restore original flashDuration
      try {
        await getRpc().request.sendCommand({
          json: JSON.stringify({ command: "setFlashDuration", value: originalFlashDuration }),
        });
      } catch {
        // Best-effort restore; silently ignore if not connected
      }
    }
  }, [cameraStream, originalFlashDuration]);

  const handleConfirm = useCallback(() => {
    if (flashColor) {
      // Revoke URL — caller (index.tsx) owns sweep URLs; this one is colour-detect only
      if (capturedUrl) URL.revokeObjectURL(capturedUrl);
      onNext(flashColor);
    }
  }, [flashColor, capturedUrl, onNext]);

  const handlePickManually = useCallback(() => {
    if (!capturedBitmapRef.current) return;
    setPhase("manual-pick");

    // Draw bitmap to the canvas once it mounts (via ref callback)
  }, []);

  // Called when the canvas element mounts or when switching to manual-pick
  const attachCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    if (!canvas || !capturedBitmapRef.current) return;

    const bitmap = capturedBitmapRef.current;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const imgData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    imageDataRef.current = { data: imgData.data, width: bitmap.width };
  }, []);

  const handleCanvasMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const imgData = imageDataRef.current;
      if (!canvas || !imgData) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      setHoverColor(sampleHslAt(imgData.data, imgData.width, x, y));
    },
    [],
  );

  const handleCanvasClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const canvas = canvasRef.current;
      const imgData = imageDataRef.current;
      if (!canvas || !imgData) return;

      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const x = (e.clientX - rect.left) * scaleX;
      const y = (e.clientY - rect.top) * scaleY;

      const { h, s, l } = sampleHslAt(imgData.data, imgData.width, x, y);
      setFlashColor({ h, s, l, tolerance: 30 });
      setPhase("preview");
    },
    [],
  );

  const retrigger = () => {
    if (capturedUrl) URL.revokeObjectURL(capturedUrl);
    capturedBitmapRef.current?.close();
    capturedBitmapRef.current = null;
    setCapturedUrl(null);
    setFlashColor(null);
    imageDataRef.current = null;
    setHoverColor(null);
    setPhase("idle");
  };

  const isLoading = phase === "flashing" || phase === "detecting";

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Fire a brief 2-second test flash. The wizard will capture a frame and automatically
        detect the flash colour used for scoring.
      </p>

      {/* Idle — trigger button */}
      {phase === "idle" && (
        <Button onClick={handleTriggerFlash} disabled={!cameraStream} className="w-full">
          Trigger Test Flash
        </Button>
      )}

      {/* Loading states */}
      {isLoading && (
        <div className="flex flex-col items-center gap-3 py-6">
          <div className="w-8 h-8 rounded-full border-2 border-primary border-t-transparent animate-spin" />
          <p className="text-sm text-muted-foreground">
            {phase === "flashing" ? "Flashing…" : "Analysing frame…"}
          </p>
        </div>
      )}

      {/* Preview — show captured image + colour swatch */}
      {(phase === "preview" || phase === "manual-pick") && capturedUrl && flashColor && (
        <div className="space-y-3">
          <div className="rounded-xl overflow-hidden bg-muted" style={{ aspectRatio: "16 / 9" }}>
            {phase === "preview" ? (
              <img src={capturedUrl} alt="Captured flash frame" className="w-full h-full object-cover" />
            ) : (
              <canvas
                ref={attachCanvas}
                onMouseMove={handleCanvasMouseMove}
                onClick={handleCanvasClick}
                className="w-full h-full object-cover cursor-crosshair"
                title="Click to pick the flash colour"
              />
            )}
          </div>

          {/* Colour swatch + info */}
          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 p-3">
            <div
              className="w-10 h-10 rounded-lg border border-border shrink-0"
              style={{
                background: `hsl(${(hoverColor ?? flashColor).h}deg ${(hoverColor ?? flashColor).s}% ${(hoverColor ?? flashColor).l}%)`,
              }}
            />
            <div className="text-sm space-y-0.5">
              {phase === "manual-pick" ? (
                hoverColor ? (
                  <>
                    <p className="font-medium">
                      H {hoverColor.h}° · S {hoverColor.s}% · L {hoverColor.l}%
                    </p>
                    <p className="text-xs text-muted-foreground">Click to select this colour</p>
                  </>
                ) : (
                  <p className="text-muted-foreground">Move over the image to sample a colour</p>
                )
              ) : (
                <>
                  <p className="font-medium">
                    H {flashColor.h}° · S {flashColor.s}% · L {flashColor.l}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Auto-detected · tolerance ±{flashColor.tolerance}°
                  </p>
                </>
              )}
            </div>
          </div>

          {phase === "preview" && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={handlePickManually} className="flex-1">
                Pick manually
              </Button>
              <Button onClick={handleConfirm} className="flex-1">
                Looks correct →
              </Button>
            </div>
          )}

          {phase === "manual-pick" && (
            <div className="flex gap-2">
              <Button
                variant="outline"
                onClick={() => setPhase("preview")}
                className="flex-1"
              >
                ← Auto colour
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={!flashColor}
                className="flex-1"
              >
                Use this colour →
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Retrigger / back row */}
      <div className={cn("flex gap-2", phase === "idle" && "hidden")}>
        {!isLoading && (
          <>
            <Button variant="outline" onClick={onBack} className="flex-1">
              ← Back
            </Button>
            {(phase === "preview" || phase === "manual-pick") && (
              <Button variant="ghost" onClick={retrigger} className="flex-1">
                Retake flash
              </Button>
            )}
          </>
        )}
      </div>

      {phase === "idle" && (
        <Button variant="outline" onClick={onBack} className="w-full">
          ← Back
        </Button>
      )}
    </div>
  );
}
