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
    year: "numeric",
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
        "group relative flex flex-col rounded-xl border border-border bg-card overflow-hidden transition-all duration-150 shadow-xs hover:shadow-md",
        selected ? "border-primary ring-2 ring-primary/40 bg-primary/5" : "hover:border-border/80",
      )}
    >
      <div
        className="relative w-full h-52 bg-black/60 overflow-hidden cursor-pointer flex items-center justify-center"
        onClick={() => onImageClick(fullResUrl)}
      >
        <div
          className="absolute top-2.5 left-2.5 z-10 p-1.5 rounded-lg bg-background/80 backdrop-blur-md border border-border/60 shadow-sm"
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
            className="h-8 w-8 rounded-lg bg-background/80 backdrop-blur-md border border-border/60 text-muted-foreground hover:text-destructive hover:bg-destructive/20 transition-colors shadow-sm"
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

      <div className="p-3 flex flex-col gap-2">
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
  );
}
