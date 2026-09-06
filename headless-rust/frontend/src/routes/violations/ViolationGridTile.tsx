import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDownBigIcon,
  ArrowUpBigIcon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { Violation } from "@/shared/types";
import { useViolationImage } from "./useViolationImage";

interface ViolationGridTileProps {
  violation: Violation;
  selected: boolean;
  skinEnabled: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onImageClick: (url: string) => void;
}

export function ViolationGridTile({
  violation,
  selected,
  skinEnabled,
  onToggleSelect,
  onDelete,
  onImageClick,
}: ViolationGridTileProps) {
  // ponytail: 400px compressed thumbnail for fast grid rendering over Wi-Fi
  const { imageData, imageLoading } = useViolationImage(violation, skinEnabled, { width: 400, quality: 80 });
  const [deleting, setDeleting] = useState(false);

  const over = (violation.measuredSpeed - violation.maxSpeed).toFixed(1);
  const formattedTime = new Date(violation.timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const fullResUrl = skinEnabled
    ? `/skinned-image?violationId=${violation.id}`
    : `/image?path=${encodeURIComponent(violation.imagePath)}`;

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div
      className={cn(
        "group relative flex rounded-xl border border-border bg-card overflow-hidden transition-all duration-150 shadow-xs hover:shadow-md shrink-0 w-full",
        selected ? "border-primary ring-2 ring-primary/40 bg-primary/5" : "hover:border-border/80",
        // On mobile (< sm): horizontal card row. On tablet/desktop (>= sm): vertical column tile
        "flex-row sm:flex-col min-h-[92px] sm:min-h-[260px]"
      )}
    >
      {/* ── Mobile Layout (< sm): Horizontal Compact Card ─────────── */}
      <div className="flex sm:hidden w-full items-center p-2.5 gap-3">
        {/* Left Thumbnail (Tap for fullscreen) */}
        <div
          className="relative w-28 h-20 bg-black/60 rounded-lg overflow-hidden cursor-pointer shrink-0 flex items-center justify-center border border-border/50"
          onClick={() => onImageClick(fullResUrl)}
        >
          {imageLoading ? (
            <div className="w-full h-full animate-pulse bg-muted-foreground/20" />
          ) : imageData ? (
            <img
              src={imageData}
              alt={`Violation at ${formattedTime}`}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-[9px] text-muted-foreground">No image</span>
          )}

          {/* Direction indicator badge on thumbnail */}
          <div className="absolute bottom-1 left-1 bg-black/70 backdrop-blur-xs px-1.5 py-0.5 rounded text-[10px] text-white flex items-center gap-1 font-mono">
            <HugeiconsIcon
              icon={violation.direction === "forward" ? ArrowUpBigIcon : ArrowDownBigIcon}
              size={12}
              strokeWidth={2}
            />
          </div>
        </div>

        {/* Center Details */}
        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
          <div className="flex items-baseline justify-between gap-1">
            <div className="flex items-baseline gap-1">
              <span className="text-lg font-bold font-mono text-destructive tracking-tight">
                {violation.measuredSpeed}
              </span>
              <span className="text-[10px] text-muted-foreground">km/h</span>
            </div>
            <span className="text-[11px] font-semibold text-destructive bg-destructive/15 px-1.5 py-0.5 rounded font-mono">
              +{over}
            </span>
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
            <span>Limit: {violation.maxSpeed} km/h</span>
          </div>

          <div className="text-[11px] text-muted-foreground/80 font-mono truncate mt-1">
            {formattedTime}
          </div>
        </div>

        {/* Right Actions */}
        <div className="flex flex-col items-center justify-between self-stretch shrink-0 pl-1">
          <div
            className="p-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={onToggleSelect}
              aria-label="Select violation"
            />
          </div>

          <Button
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/15"
            onClick={handleDelete}
            disabled={deleting}
            aria-label="Delete violation"
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-4" />
          </Button>
        </div>
      </div>

      {/* ── Tablet & Desktop Layout (>= sm): Vertical Card Tile ──── */}
      <div className="hidden sm:flex sm:flex-col w-full">
        {/* Full Image Area */}
        <div
          className="relative w-full h-48 sm:h-52 bg-black/60 overflow-hidden cursor-pointer flex items-center justify-center shrink-0"
          onClick={() => onImageClick(fullResUrl)}
        >
          <div
            className="absolute top-2.5 left-2.5 z-10 p-2 rounded-lg bg-background/85 backdrop-blur-md border border-border/60 shadow-sm"
            onClick={(e) => e.stopPropagation()}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={onToggleSelect}
              aria-label="Select violation"
            />
          </div>

          <div
            className="absolute top-2.5 right-2.5 z-10"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-9 w-9 rounded-lg bg-background/85 backdrop-blur-md border border-border/60 text-muted-foreground hover:text-destructive hover:bg-destructive/20 transition-colors shadow-sm"
              onClick={handleDelete}
              disabled={deleting}
              aria-label="Delete violation"
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-4" />
            </Button>
          </div>

          {imageLoading ? (
            <div className="w-full h-full animate-pulse bg-muted-foreground/20" />
          ) : imageData ? (
            <img
              src={imageData}
              alt={`Violation at ${formattedTime}`}
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-200"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-1 text-muted-foreground">
              <span className="text-xs">No image available</span>
            </div>
          )}

          <div className="absolute bottom-2.5 left-2.5 z-10 px-2.5 py-1 rounded-lg bg-background/90 backdrop-blur-md border border-border/60 shadow-sm flex items-center gap-2">
            <span title={violation.direction === "forward" ? "Forward (sensor 1 → 2)" : "Reverse (sensor 2 → 1)"} className="text-muted-foreground">
              <HugeiconsIcon
                icon={violation.direction === "forward" ? ArrowUpBigIcon : ArrowDownBigIcon}
                size={16}
                strokeWidth={2}
              />
            </span>
            <span className="text-base font-bold text-destructive tracking-tight">
              {violation.measuredSpeed} <span className="text-xs font-normal text-muted-foreground">km/h</span>
            </span>
          </div>
        </div>

        {/* Details Footer */}
        <div className="p-3 flex flex-col gap-2 flex-1 justify-between">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground font-medium">Limit: {violation.maxSpeed} km/h</span>
            <span className="font-semibold text-destructive bg-destructive/10 px-2 py-0.5 rounded-md">
              +{over} km/h
            </span>
          </div>
          <div className="text-xs text-muted-foreground/80 truncate font-mono">
            {formattedTime}
          </div>
        </div>
      </div>
    </div>
  );
}
