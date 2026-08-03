import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowDownBigIcon,
  ArrowUpBigIcon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Violation } from "@/shared/types";
import { useViolationImage } from "./useViolationImage";

interface ViolationRowProps {
  violation: Violation;
  selected: boolean;
  skinEnabled: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onImageClick: (url: string) => void;
}

export function ViolationRow({
  violation,
  selected,
  skinEnabled,
  onToggleSelect,
  onDelete,
  onImageClick,
}: ViolationRowProps) {
  const { imageData, imageLoading } = useViolationImage(violation, skinEnabled);
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

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <tr className={selected ? "bg-accent/30" : "hover:bg-muted/30 transition-colors"}>
      <td className="px-3 py-2">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggleSelect}
          aria-label="Select row"
        />
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          className="relative w-16 h-10 rounded-md overflow-hidden bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
          onClick={() => imageData && onImageClick(imageData)}
          disabled={!imageData}
          aria-label="View full image"
        >
          {imageLoading ? (
            <div className="w-full h-full animate-pulse bg-muted-foreground/20" />
          ) : imageData ? (
            <img
              src={imageData}
              alt="violation thumbnail"
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="text-[9px] text-muted-foreground">No image</span>
          )}
        </button>
      </td>
      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{formattedTime}</td>
      <td className="px-3 py-2 text-center text-muted-foreground">
        <span title={violation.direction === "forward" ? "Forward (sensor 1 → 2)" : "Reverse (sensor 2 → 1)"}>
          <HugeiconsIcon
            icon={violation.direction === "forward" ? ArrowUpBigIcon : ArrowDownBigIcon}
            size={18}
            strokeWidth={2}
          />
        </span>
      </td>
      <td className="px-3 py-2 text-right font-semibold text-destructive">
        {violation.measuredSpeed}
      </td>
      <td className="px-3 py-2 text-right text-muted-foreground">{violation.maxSpeed}</td>
      <td className="px-3 py-2 text-right text-destructive/70 font-medium">+{over}</td>
      <td className="px-3 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          className="hover:bg-destructive/10 hover:text-destructive"
          onClick={handleDelete}
          disabled={deleting}
          aria-label="Delete violation"
        >
          <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
        </Button>
      </td>
    </tr>
  );
}
