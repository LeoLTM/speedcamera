import { useState, useEffect, useCallback } from "react";
import { createRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { RootRoute } from "./__root";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getRpc } from "@/lib/rpc";
import { Skeleton } from "@/components/ui/skeleton";
import type { Violation, ViolationQuery } from "@/shared/types";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Delete02Icon,
  FilterIcon,
  Download01Icon,
  ArrowLeft01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";

export const ViolationsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/violations",
  component: ViolationsPage,
});

const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

function ViolationsPage() {
  const [violations, setViolations] = useState<Violation[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState<PageSize>(25);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [minSpeed, setMinSpeed] = useState("");
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const fetchViolations = useCallback(async () => {
    setLoading(true);
    setSelected(new Set());
    try {
      const query: ViolationQuery = {
        page,
        limit,
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        ...(minSpeed ? { minSpeed: Number(minSpeed) } : {}),
      };
      const result = await getRpc().request.getViolations(query);
      setViolations(result.violations);
      setTotal(result.total);
    } catch {
      toast.error("Failed to load violations");
    } finally {
      setLoading(false);
    }
  }, [page, limit, dateFrom, dateTo, minSpeed]);

  useEffect(() => {
    void fetchViolations();
  }, [fetchViolations]);

  const handleDelete = async (id: number) => {
    try {
      await getRpc().request.deleteViolation({ id });
      setViolations((prev) => prev.filter((v) => v.id !== id));
      setTotal((prev) => prev - 1);
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    } catch {
      toast.error("Failed to delete violation");
    }
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    try {
      await Promise.all(
        [...selected].map((id) => getRpc().request.deleteViolation({ id }))
      );
      await fetchViolations();
      toast.success(`Deleted ${selected.size} violations`);
    } catch {
      toast.error("Failed to delete some violations");
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      const csv = await getRpc().request.exportViolationsCsv({
        ...(dateFrom ? { dateFrom } : {}),
        ...(dateTo ? { dateTo } : {}),
        ...(minSpeed ? { minSpeed: Number(minSpeed) } : {}),
      });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `violations-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to export CSV");
    } finally {
      setExporting(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allSelected = violations.length > 0 && violations.every((v) => selected.has(v.id));
  const someSelected = violations.some((v) => selected.has(v.id));

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(violations.map((v) => v.id)));
    }
  };

  const applyFilters = () => {
    setPage(1);
    void fetchViolations();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Filter toolbar */}
      <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-border bg-muted/20 shrink-0">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">From</label>
          <input
            type="datetime-local"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-8 px-2 text-sm rounded-lg border border-input bg-input/30 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">To</label>
          <input
            type="datetime-local"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-8 px-2 text-sm rounded-lg border border-input bg-input/30 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">Min speed (km/h)</label>
          <input
            type="number"
            min={0}
            value={minSpeed}
            onChange={(e) => setMinSpeed(e.target.value)}
            placeholder="e.g. 50"
            className="h-8 w-28 px-2 text-sm rounded-lg border border-input bg-input/30 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
          />
        </div>
        <Button variant="outline" size="sm" onClick={applyFilters}>
          <HugeiconsIcon icon={FilterIcon} strokeWidth={2} />
          Apply
        </Button>
        <div className="ml-auto flex items-center gap-2">
          {selected.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleBulkDelete}
              disabled={bulkDeleting}
            >
              <HugeiconsIcon icon={Delete02Icon} strokeWidth={2} />
              Delete {selected.size}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportCsv}
            disabled={exporting || total === 0}
          >
            <HugeiconsIcon icon={Download01Icon} strokeWidth={2} />
            {exporting ? "Exporting…" : "Export CSV"}
          </Button>
          <Select
            value={String(limit)}
            onValueChange={(v) => {
              setLimit(Number(v) as PageSize);
              setPage(1);
            }}
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
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-background border-b border-border z-10">
              <tr>
                <th className="w-10 px-3 py-2" />
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Image</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Timestamp</th>
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
                  <td className="px-3 py-2 text-right"><Skeleton className="h-4 w-10 rounded ml-auto" /></td>
                  <td className="px-3 py-2 text-right"><Skeleton className="h-4 w-10 rounded ml-auto" /></td>
                  <td className="px-3 py-2 text-right"><Skeleton className="h-4 w-10 rounded ml-auto" /></td>
                  <td className="px-3 py-2"><Skeleton className="size-7 rounded-md ml-auto" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : violations.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-8">
            <div className="flex items-center justify-center size-16 rounded-2xl bg-muted text-muted-foreground/40">
              <HugeiconsIcon icon={FilterIcon} strokeWidth={1.5} className="size-8" />
            </div>
            <p className="text-lg font-medium text-muted-foreground">No violations found</p>
            <p className="text-sm text-muted-foreground/60 max-w-xs">
              Speed violations will appear here once the camera detects them, or try adjusting your filters.
            </p>
          </div>
        ) : (
          <table className="w-full text-sm border-collapse">
            <thead className="sticky top-0 bg-background border-b border-border z-10">
              <tr>
                <th className="w-10 px-3 py-2 text-left">
                  <Checkbox
                    checked={allSelected || (someSelected ? "indeterminate" : false)}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">Image</th>
                <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                  Timestamp
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Speed (km/h)
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">
                  Limit (km/h)
                </th>
                <th className="px-3 py-2 text-right font-medium text-muted-foreground">Over</th>
                <th className="w-12 px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {violations.map((v) => (
                <ViolationRow
                  key={v.id}
                  violation={v}
                  selected={selected.has(v.id)}
                  onToggleSelect={() => toggleSelect(v.id)}
                  onDelete={() => handleDelete(v.id)}
                  onImageClick={(url) => setLightboxUrl(url)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {!loading && violations.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/20 shrink-0">
          <p className="text-xs text-muted-foreground">
            {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total} violations
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Previous page"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
            </Button>
            <span className="text-xs px-2 text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
            </Button>
          </div>
        </div>
      )}

      {/* Lightbox */}
      <Dialog open={lightboxUrl !== null} onOpenChange={(open) => !open && setLightboxUrl(null)}>
        <DialogContent
          className="max-w-3xl w-full p-2 rounded-2xl"
          showCloseButton
        >
          {lightboxUrl && (
            <img
              src={lightboxUrl}
              alt="Violation"
              className="w-full rounded-xl object-contain max-h-[80vh]"
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── ViolationRow ─────────────────────────────────────────────────────────────

interface ViolationRowProps {
  violation: Violation;
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: () => void;
  onImageClick: (url: string) => void;
}

function ViolationRow({
  violation,
  selected,
  onToggleSelect,
  onDelete,
  onImageClick,
}: ViolationRowProps) {
  const [imageData, setImageData] = useState<string | null>(null);
  const [imageLoading, setImageLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getRpc()
      .request.getImageData({ imagePath: violation.imagePath })
      .then((data) => { if (!cancelled) setImageData(data); })
      .catch(() => { if (!cancelled) setImageData(null); })
      .finally(() => { if (!cancelled) setImageLoading(false); });
    return () => { cancelled = true; };
  }, [violation.imagePath]);

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
