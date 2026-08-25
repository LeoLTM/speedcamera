import { useState, useEffect } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { getRpc } from "@/lib/rpc";
import type { Violation } from "@/shared/types";

interface ViolationCardProps {
  violation: Violation;
  /** Called after successful deletion — use to remove from parent list */
  onDelete?: (id: number) => void;
  /** Called when the thumbnail is clicked — receives the data-URL for a lightbox */
  onImageClick?: (dataUrl: string) => void;
  className?: string;
}

export function ViolationCard({
  violation,
  onDelete,
  onImageClick,
  className,
}: ViolationCardProps) {
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setImageLoading(true);

    // ponytail: 240px thumbnail for dashboard card
    getRpc()
      .request.getImageData({ imagePath: violation.imagePath, width: 240, quality: 75 })
      .then((data) => {
        if (!cancelled) setImageData(data);
      })
      .catch(() => {
        if (!cancelled) setImageData(null);
      })
      .finally(() => {
        if (!cancelled) setImageLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [violation.imagePath]);

  const fullResUrl = `/image?path=${encodeURIComponent(violation.imagePath)}`;

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await getRpc().request.deleteViolation({ id: violation.id });
      onDelete?.(violation.id);
    } catch {
      toast.error("Failed to delete violation");
      setDeleting(false);
    }
  };

  const formattedTime = new Date(violation.timestamp).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const overSpeed = (violation.measuredSpeed - violation.maxSpeed).toFixed(1);

  return (
    <div
      className={cn(
        "group relative flex gap-3 p-3 rounded-lg border border-border bg-card",
        "hover:bg-accent/20 transition-colors",
        className,
      )}
    >
      {/* Thumbnail */}
      <button
        type="button"
        className={cn(
          "relative shrink-0 w-24 h-16 rounded-md overflow-hidden bg-muted",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          onImageClick && imageData ? "cursor-pointer" : "cursor-default",
        )}
        onClick={() => imageData && onImageClick?.(fullResUrl)}
        disabled={!imageData || !onImageClick}
        aria-label="View full violation image"
      >
        {imageLoading ? (
          <div className="w-full h-full animate-pulse bg-muted-foreground/20" />
        ) : imageData ? (
          <img
            src={imageData}
            alt={`Speed violation at ${formattedTime}`}
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-[10px] text-muted-foreground leading-tight text-center px-1">
            No image
          </div>
        )}
      </button>

      {/* Info */}
      <div className="flex flex-col justify-between flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-destructive leading-none">
              {violation.measuredSpeed} km/h
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Limit {violation.maxSpeed} km/h
              <span className="ml-1 text-destructive/70">(+{overSpeed})</span>
            </p>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className={cn(
              "shrink-0 size-7 transition-opacity",
              "opacity-0 group-hover:opacity-100",
              "hover:bg-destructive/10 hover:text-destructive",
            )}
            onClick={handleDelete}
            disabled={deleting}
            aria-label="Delete violation"
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="size-3.5" />
          </Button>
        </div>

        <p className="text-xs text-muted-foreground truncate">{formattedTime}</p>
      </div>
    </div>
  );
}
