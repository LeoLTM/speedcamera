import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CalibrationImage } from "../types";

interface Step5ResultsProps {
  images: CalibrationImage[];
  originalFlashDuration: number;
  originalPictureDelay: number;
  onApply: (flashDuration: number, pictureDelay: number) => void;
  onClose: () => void;
}

export function Step5Results({
  images,
  originalFlashDuration,
  originalPictureDelay,
  onApply,
  onClose,
}: Step5ResultsProps) {
  // Sort by (flashDuration, pictureDelay) for a predictable layout regardless of capture order
  const displayImages = useMemo(
    () =>
      [...images].sort((a, b) =>
        a.flashDuration !== b.flashDuration
          ? a.flashDuration - b.flashDuration
          : a.pictureDelay - b.pictureDelay,
      ),
    [images],
  );

  const bestIndex = useMemo(() => {
    if (displayImages.length === 0) return null;
    return displayImages.reduce(
      (best, img, i) => (img.score > displayImages[best].score ? i : best),
      0,
    );
  }, [displayImages]);

  const [selectedIndex, setSelectedIndex] = useState<number | null>(bestIndex);

  const selected = selectedIndex !== null ? displayImages[selectedIndex] : null;

  // Use full Tailwind class strings (not template literals) so JIT doesn't purge them
  const gridColsClass = displayImages.length > 16 ? "grid-cols-6" : "grid-cols-4";

  const handleApply = () => {
    if (selected) onApply(selected.flashDuration, selected.pictureDelay);
  };

  if (displayImages.length === 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground text-center py-8">
          No images captured. Go back and run the sweep.
        </p>
        <Button variant="outline" onClick={onClose} className="w-full">
          Close
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Click an image to select it, then apply the settings or close without changing anything.
      </p>

      {/* Image grid — 4 cols for ≤16 images (Quick), 6 cols for Fine/Adaptive */}
      <div className={`grid ${gridColsClass} gap-1.5`}>
        {displayImages.map((img, i) => {
          const isBest = i === bestIndex;
          const isSelected = i === selectedIndex;

          return (
            <button
              key={i}
              onClick={() => setSelectedIndex(i)}
              className={cn(
                "relative overflow-hidden rounded-lg border-2 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                isSelected
                  ? "border-primary shadow-md shadow-primary/20"
                  : "border-transparent hover:border-border",
              )}
              style={{ aspectRatio: "4 / 3" }}
              title={`Flash ${img.flashDuration} ms · Delay ${img.pictureDelay} ms · Score ${(img.score * 100).toFixed(1)}%`}
            >
              <img
                src={img.objectUrl}
                alt={`Flash ${img.flashDuration}ms delay ${img.pictureDelay}ms`}
                className="w-full h-full object-cover"
              />

              {/* Score overlay */}
              <div className="absolute bottom-0 inset-x-0 bg-black/60 px-1 py-0.5 flex items-center justify-between gap-1">
                <span className="text-[9px] text-white/80 font-mono leading-none">
                  {img.flashDuration}ms
                </span>
                <span className="text-[9px] text-white font-semibold leading-none">
                  {(img.score * 100).toFixed(0)}%
                </span>
              </div>

              {/* Best badge */}
              {isBest && (
                <div className="absolute top-1 left-1">
                  <Badge className="text-[9px] h-4 px-1 bg-amber-500 border-amber-500 text-white">
                    Best
                  </Badge>
                </div>
              )}

              {/* Selected indicator */}
              {isSelected && (
                <div className="absolute top-1 right-1 w-4 h-4 rounded-full bg-primary flex items-center justify-center">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="white"
                    strokeWidth="3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Selected info panel */}
      {selected ? (
        <div className="rounded-xl border border-border bg-muted/30 p-3 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Selected settings
          </p>
          <div className="grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-xs text-muted-foreground">Flash Duration</p>
              <p className="font-semibold">{selected.flashDuration} ms</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Picture Delay</p>
              <p className="font-semibold">{selected.pictureDelay} ms</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Score</p>
              <p className="font-semibold">{(selected.score * 100).toFixed(1)}%</p>
            </div>
          </div>
          {selectedIndex === bestIndex && (
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
              ★ Highest scoring combination
            </p>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
          No image selected — original settings will be kept
        </div>
      )}

      {/* Original settings reference */}
      <p className="text-xs text-muted-foreground">
        Current settings — Flash Duration: {originalFlashDuration} ms · Picture Delay:{" "}
        {originalPictureDelay} ms
      </p>

      {/* Actions */}
      <div className="flex gap-2">
        <Button variant="outline" onClick={onClose} className="flex-1">
          Close Without Applying
        </Button>
        <Button onClick={handleApply} disabled={selectedIndex === null} className="flex-1">
          Apply These Settings
        </Button>
      </div>
    </div>
  );
}
