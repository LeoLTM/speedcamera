import { HugeiconsIcon } from "@hugeicons/react";
import { FilterIcon } from "@hugeicons/core-free-icons";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import type { Violation } from "@/shared/types";
import { ViolationGridTile } from "./ViolationGridTile";

interface ViolationsGridProps {
  violations: Violation[];
  loading: boolean;
  limit: number;
  skinEnabled: boolean;
  selected: Set<number>;
  selectedCount: number;
  allSelected: boolean;
  someSelected: boolean;
  onToggleSelect: (id: number) => void;
  onToggleSelectAll: () => void;
  onDelete: (id: number) => void;
  onImageClick: (url: string) => void;
}

export function ViolationsGrid(props: ViolationsGridProps) {
  if (props.loading) {
    return (
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 p-4">
        {Array.from({ length: props.limit > 25 ? 12 : 8 }).map((_, i) => (
          <div key={i} className="flex flex-col rounded-xl border border-border bg-card overflow-hidden">
            <Skeleton className="w-full h-52 rounded-none" />
            <div className="p-3 space-y-2">
              <div className="flex justify-between">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-4 w-16" />
              </div>
              <Skeleton className="h-3 w-32" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (props.violations.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
        <div className="flex items-center justify-center size-16 rounded-2xl bg-muted text-muted-foreground/40">
          <HugeiconsIcon icon={FilterIcon} strokeWidth={1.5} className="size-8" />
        </div>
        <p className="text-lg font-medium text-muted-foreground">No violations found</p>
        <p className="text-sm text-muted-foreground/60 max-w-xs">
          Speed violations will appear here once the camera detects them, or try adjusting your filters.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 bg-muted/10 border-b border-border text-xs text-muted-foreground shrink-0">
        <div className="flex items-center gap-2">
          <Checkbox
            checked={props.allSelected || (props.someSelected ? "indeterminate" : false)}
            onCheckedChange={props.onToggleSelectAll}
            id="grid-select-all"
          />
          <label htmlFor="grid-select-all" className="cursor-pointer select-none font-medium">
            Select All ({props.selectedCount} selected)
          </label>
        </div>
        <span>{props.violations.length} items on page</span>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4 p-4 overflow-auto flex-1">
        {props.violations.map((v) => (
          <ViolationGridTile
            key={v.id}
            violation={v}
            selected={props.selected.has(v.id)}
            skinEnabled={props.skinEnabled}
            onToggleSelect={() => props.onToggleSelect(v.id)}
            onDelete={() => props.onDelete(v.id)}
            onImageClick={props.onImageClick}
          />
        ))}
      </div>
    </div>
  );
}
