import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Delete02Icon, CheckmarkCircle01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { formatDuration, formatTimestamp } from "@/lib/format";
import { useLapStore } from "../store";
import { LapImageThumbnails } from "../components/LapImageThumbnails";
import type { Lap } from "@/shared/types";

interface LapRowProps {
  lap: Lap;
  isBest: boolean;
  /** Show the hover-revealed delete button. Defaults to false (live session). */
  deletable?: boolean;
  /** Override the default store-based deletion. Falls back to `deleteHistoryLap(lap.id)`. */
  onDelete?: () => Promise<void>;
}

/**
 * Single lap table row used by both the live session table and the history
 * session expansion. `deletable` opts in to the history-only delete affordance.
 */
export function LapRow({ lap, isBest, deletable = false, onDelete }: LapRowProps) {
  const deleteHistoryLap = useLapStore((s) => s.deleteHistoryLap);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    if (!confirm("Delete this lap?")) return;
    setDeleting(true);
    try {
      if (onDelete) {
        await onDelete();
      } else {
        await deleteHistoryLap(lap.id);
      }
    } catch {
      toast.error("Failed to delete lap");
      setDeleting(false);
    }
  };

  const deleteButton = deletable && (
    <button
      type="button"
      onClick={handleDelete}
      disabled={deleting}
      className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-destructive"
      title="Delete lap"
    >
      <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} className="w-3.5 h-3.5" />
    </button>
  );

  return (
    <tr
      className={cn(
        "border-b border-border/50 last:border-0 transition-colors hover:bg-muted/30",
        deletable && "group",
        isBest && "bg-green-500/5",
      )}
    >
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <span className="font-mono font-medium">{lap.lapNumber}</span>
          {isBest && (
            <HugeiconsIcon
              icon={CheckmarkCircle01Icon}
              strokeWidth={2}
              className="w-3.5 h-3.5 text-green-500 dark:text-green-400"
            />
          )}
        </div>
      </td>
      <td className="px-4 py-2.5">
        <span
          className={cn(
            "font-mono text-sm",
            isBest && "text-green-600 dark:text-green-400 font-semibold",
          )}
        >
          {formatDuration(lap.durationMs)}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
        {lap.speedAtStart} <span className="text-xs">km/h</span>
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-muted-foreground">
        {lap.speedAtEnd} <span className="text-xs">km/h</span>
      </td>
      <td className="px-4 py-2.5 text-right text-xs text-muted-foreground tabular-nums">
        {formatTimestamp(lap.startTimestamp)}
      </td>
      <td className="px-4 py-2.5">
        <LapImageThumbnails
          startImagePath={lap.startImagePath}
          endImagePath={lap.endImagePath}
          trailing={deleteButton}
        />
      </td>
    </tr>
  );
}
