import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  Download01Icon,
  FilterIcon,
  GridViewIcon,
  Image01Icon,
  LayoutList,
} from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { PAGE_SIZE_OPTIONS, type PageSize, type ViewMode } from "./useViolations";

interface ViolationsToolbarProps {
  dateFrom: string;
  dateTo: string;
  minSpeed: string;
  selectedCount: number;
  total: number;
  exporting: boolean;
  bulkDeleting: boolean;
  skinEnabled: boolean;
  limit: PageSize;
  viewMode: ViewMode;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
  onMinSpeed: (v: string) => void;
  onApplyFilters: () => void;
  onBulkDelete: () => void;
  onExportCsv: () => void;
  onOpenExportImages: () => void;
  onSkinToggle: (v: boolean) => void;
  onLimitChange: (l: PageSize) => void;
  onViewModeChange: (m: ViewMode) => void;
}

export function ViolationsToolbar(props: ViolationsToolbarProps) {
  return (
    <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-border bg-muted/20 shrink-0">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">From</label>
        <input
          type="datetime-local"
          value={props.dateFrom}
          onChange={(e) => props.onDateFrom(e.target.value)}
          className="h-8 px-2 text-sm rounded-lg border border-input bg-input/30 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">To</label>
        <input
          type="datetime-local"
          value={props.dateTo}
          onChange={(e) => props.onDateTo(e.target.value)}
          className="h-8 px-2 text-sm rounded-lg border border-input bg-input/30 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs text-muted-foreground">Min speed (km/h)</label>
        <input
          type="number"
          min={0}
          value={props.minSpeed}
          onChange={(e) => props.onMinSpeed(e.target.value)}
          placeholder="e.g. 50"
          className="h-8 w-28 px-2 text-sm rounded-lg border border-input bg-input/30 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
        />
      </div>
      <Button variant="outline" size="sm" onClick={props.onApplyFilters}>
        <HugeiconsIcon icon={FilterIcon} strokeWidth={2} />
        Apply
      </Button>
      <div className="ml-auto flex items-center gap-2">
        {props.selectedCount > 0 && (
          <Button
            variant="destructive"
            size="sm"
            onClick={props.onBulkDelete}
            disabled={props.bulkDeleting}
          >
            <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
            Delete {props.selectedCount}
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={props.onExportCsv}
          disabled={props.exporting || props.total === 0}
        >
          <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
          {props.exporting ? "Exporting…" : "Export CSV"}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={props.onOpenExportImages}
          disabled={props.total === 0}
        >
          <HugeiconsIcon icon={Image01Icon} strokeWidth={2} />
          Export Images
        </Button>
        <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-border">
          <Switch
            checked={props.skinEnabled}
            onCheckedChange={props.onSkinToggle}
            aria-label="Toggle Poliscan skin"
          />
          <span className="text-xs text-muted-foreground whitespace-nowrap">Poliscan Skin</span>
        </div>
        <Select
          value={String(props.limit)}
          onValueChange={(v) => props.onLimitChange(Number(v) as PageSize)}
        >
          <SelectTrigger size="sm" className="w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} / page
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center rounded-lg border border-border bg-background p-0.5 ml-1">
          <Button
            variant={props.viewMode === "list" ? "secondary" : "ghost"}
            size="icon-sm"
            className="h-7 w-7"
            onClick={() => props.onViewModeChange("list")}
            title="List View"
          >
            <HugeiconsIcon icon={LayoutList} strokeWidth={2} className="size-4" />
          </Button>
          <Button
            variant={props.viewMode === "grid" ? "secondary" : "ghost"}
            size="icon-sm"
            className="h-7 w-7"
            onClick={() => props.onViewModeChange("grid")}
            title="Grid View"
          >
            <HugeiconsIcon icon={GridViewIcon} strokeWidth={2} className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
