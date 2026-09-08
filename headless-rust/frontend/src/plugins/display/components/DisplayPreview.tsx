import { useEffect, useRef } from "react";
import { useDisplayStore } from "../store";
import { Button } from "@/components/ui/button";
import { RefreshCcw, Eye } from "lucide-react";

// ponytail: direct canvas pixel blaster renders 1024-byte 1-bit frame in under 1ms
export function DisplayPreview() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { preview, autoRefresh, setAutoRefresh, fetchPreview } = useDisplayStore();

  useEffect(() => {
    void fetchPreview();
  }, [fetchPreview]);

  // Periodic polling when auto-refresh is active
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = setInterval(() => {
      void fetchPreview();
    }, 1000);
    return () => clearInterval(interval);
  }, [autoRefresh, fetchPreview]);

  // Render pixels onto canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !preview?.bitmapBase64) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    try {
      const binaryString = atob(preview.bitmapBase64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const width = preview.width || 128;
      const height = preview.height || 64;

      const imgData = ctx.createImageData(width, height);
      const data = imgData.data;

      // Row-major: 128 pixels / 8 = 16 bytes per row
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const byteIdx = y * (width / 8) + Math.floor(x / 8);
          const bitIdx = 7 - (x % 8);
          const isOn = byteIdx < bytes.length && ((bytes[byteIdx] >> bitIdx) & 1) === 1;

          const pixelIdx = (y * width + x) * 4;
          if (isOn) {
            // Bright OLED Cyan/Blue-White
            data[pixelIdx] = 56;     // R
            data[pixelIdx + 1] = 189; // G
            data[pixelIdx + 2] = 248; // B
            data[pixelIdx + 3] = 255; // Alpha
          } else {
            // Deep OLED Glass Black
            data[pixelIdx] = 8;
            data[pixelIdx + 1] = 12;
            data[pixelIdx + 2] = 16;
            data[pixelIdx + 3] = 255;
          }
        }
      }

      ctx.putImageData(imgData, 0, 0);
    } catch (e) {
      console.warn("[DisplayPreview] Failed to decode bitmap:", e);
    }
  }, [preview]);

  return (
    <div className="flex flex-col gap-3 p-4 rounded-xl border border-border bg-card/60">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye className="w-4 h-4 text-cyan-400" />
          <span className="text-xs font-semibold tracking-wider text-foreground">
            LIVE OLED SCREEN (128x64)
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`h-7 px-2 text-xs font-mono ${
              autoRefresh ? "text-cyan-400 bg-cyan-950/40 border border-cyan-800/50" : "text-muted-foreground"
            }`}
          >
            {autoRefresh ? "Live: ON" : "Live: OFF"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void fetchPreview()}
            className="h-7 w-7 p-0"
            title="Refresh preview"
          >
            <RefreshCcw className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Retro OLED Screen Bezel */}
      <div className="flex flex-col items-center justify-center p-3 rounded-lg bg-black border-2 border-neutral-800 shadow-inner">
        <div className="relative p-1.5 rounded bg-neutral-950 border border-neutral-800/80 shadow-[0_0_15px_rgba(56,189,248,0.15)]">
          <canvas
            ref={canvasRef}
            width={128}
            height={64}
            className="w-[256px] h-[128px] sm:w-[320px] sm:h-[160px] block"
            style={{ imageRendering: "pixelated" }}
          />
        </div>
        <div className="flex items-center justify-between w-full mt-2 px-2 text-[10px] font-mono text-neutral-500">
          <span>SSD1306 • I²C</span>
          <span className="text-cyan-400/80">Active Screen: {preview?.activeScreen || "SpeedCamera"}</span>
          <span>128x64</span>
        </div>
      </div>
    </div>
  );
}
