import { HugeiconsIcon } from "@hugeicons/react";
import { FilterIcon } from "@hugeicons/core-free-icons";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import type { Violation } from "@/shared/types";
import { ViolationRow } from "./ViolationRow";

interface ViolationsTableProps {
  violations: Violation[];
  loading: boolean;
  limit: number;
  skinEnabled: boolean;
  selected: Set<number>;
  allSelected: boolean;
  someSelected: boolean;
  onToggleSelect: (id: number) => void;
  onToggleSelectAll: () => void;
  onDelete: (id: number) => void;
  onImageClick: (url: string) => void;
}

export function ViolationsTable(props: ViolationsTableProps) {
  if (props.loading) {
    return (
      <table className="w-full text-sm border-collapse">
        <thead className="sticky top-0 bg-background border-b border-border z-10">
          <tr>
            <th className="w-10 px-3 py-2" />
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Image</th>
            <th className="px-3 py-2 text-left font-medium text-muted-foreground">Timestamp</th>
            <th className="px-3 py-2 text-center font-medium text-muted-foreground">Dir</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Speed (km/h)</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Limit (km/h)</th>
            <th className="px-3 py-2 text-right font-medium text-muted-foreground">Over</th>
            <th className="w-12 px-3 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {Array.from({ length: 8 }).map((_, i) => (
            <tr key={i}>
              <td className="px-3 py-2"><Skeleton className="size-4 rounded" /></td>
              <td className="px-3 py-2"><Skeleton className="w-16 h-10 rounded-md" /></td>
              <td className="px-3 py-2"><Skeleton className="h-4 w-36 rounded" /></td>
              <td className="px-3 py-2"><Skeleton className="h-4 w-5 rounded mx-auto" /></td>
              <td className="px-3 py-2 text-right"><Skeleton className="h-4 w-10 rounded ml-auto" /></td>
              <td className="px-3 py-2 text-right"><Skeleton className="h-4 w-10 rounded ml-auto" /></td>
              <td className="px-3 py-2 text-right"><Skeleton className="h-4 w-10 rounded ml-auto" /></td>
              <td className="px-3 py-2"><Skeleton className="size-7 rounded-md ml-auto" /></td>
            </tr>
          ))}
        </tbody>
      </table>
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
    <table className="w-full text-sm border-collapse">
      <thead className="sticky top-0 bg-background border-b border-border z-10">
        <tr>
          <th className="w-10 px-3 py-2 text-left">
            <Checkbox
              checked={props.allSelected || (props.someSelected ? "indeterminate" : false)}
              onCheckedChange={props.onToggleSelectAll}
              aria-label="Select all"
            />
          </th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Image</th>
          <th className="px-3 py-2 text-left font-medium text-muted-foreground">Timestamp</th>
          <th className="px-3 py-2 text-center font-medium text-muted-foreground">Dir</th>
          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Speed (km/h)</th>
          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Limit (km/h)</th>
          <th className="px-3 py-2 text-right font-medium text-muted-foreground">Over</th>
          <th className="w-12 px-3 py-2" />
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {props.violations.map((v) => (
          <ViolationRow
            key={v.id}
            violation={v}
            selected={props.selected.has(v.id)}
            skinEnabled={props.skinEnabled}
            onToggleSelect={() => props.onToggleSelect(v.id)}
            onDelete={() => props.onDelete(v.id)}
            onImageClick={props.onImageClick}
          />
        ))}
      </tbody>
    </table>
  );
}
