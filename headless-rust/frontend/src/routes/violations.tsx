import { useState } from "react";
import { createRoute } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowLeft01Icon, ArrowRight01Icon } from "@hugeicons/core-free-icons";
import { RootRoute } from "./__root";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ViolationsToolbar } from "./violations/ViolationsToolbar";
import { ViolationsTable } from "./violations/ViolationsTable";
import { ViolationsGrid } from "./violations/ViolationsGrid";
import { ExportImagesDialog } from "./violations/ExportImagesDialog";
import {
  useViolations,
  readViewMode,
  writeViewMode,
  type ViewMode,
} from "./violations/useViolations";

export const ViolationsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/violations",
  component: ViolationsPage,
});

function ViolationsPage() {
  const v = useViolations();

  const [viewMode, setViewMode] = useState<ViewMode>(readViewMode);
  const handleViewModeChange = (mode: ViewMode) => {
    setViewMode(mode);
    writeViewMode(mode);
  };

  const [skinEnabled, setSkinEnabled] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const handleExportCsv = async () => {
    setExporting(true);
    try {
      await v.exportCsv();
    } finally {
      setExporting(false);
    }
  };

  const handleBulkDelete = async () => {
    setBulkDeleting(true);
    try {
      await v.bulkDelete();
    } finally {
      setBulkDeleting(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <ViolationsToolbar
        dateFrom={v.dateFrom}
        dateTo={v.dateTo}
        minSpeed={v.minSpeed}
        selectedCount={v.selected.size}
        total={v.total}
        exporting={exporting}
        bulkDeleting={bulkDeleting}
        skinEnabled={skinEnabled}
        limit={v.limit}
        viewMode={viewMode}
        onDateFrom={v.setDateFrom}
        onDateTo={v.setDateTo}
        onMinSpeed={v.setMinSpeed}
        onApplyFilters={v.applyFilters}
        onBulkDelete={handleBulkDelete}
        onExportCsv={handleExportCsv}
        onOpenExportImages={() => setExportDialogOpen(true)}
        onSkinToggle={setSkinEnabled}
        onLimitChange={(l) => {
          v.setLimit(l);
          v.setPage(1);
        }}
        onViewModeChange={handleViewModeChange}
      />

      <div className="flex-1 overflow-auto">
        {viewMode === "grid" ? (
          <ViolationsGrid
            violations={v.violations}
            loading={v.loading}
            limit={v.limit}
            skinEnabled={skinEnabled}
            selected={v.selected}
            selectedCount={v.selected.size}
            allSelected={v.allSelected}
            someSelected={v.someSelected}
            onToggleSelect={v.toggleSelect}
            onToggleSelectAll={v.toggleSelectAll}
            onDelete={v.deleteViolation}
            onImageClick={setLightboxUrl}
          />
        ) : (
          <ViolationsTable
            violations={v.violations}
            loading={v.loading}
            limit={v.limit}
            skinEnabled={skinEnabled}
            selected={v.selected}
            allSelected={v.allSelected}
            someSelected={v.someSelected}
            onToggleSelect={v.toggleSelect}
            onToggleSelectAll={v.toggleSelectAll}
            onDelete={v.deleteViolation}
            onImageClick={setLightboxUrl}
          />
        )}
      </div>

      {!v.loading && v.violations.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-muted/20 shrink-0">
          <p className="text-xs text-muted-foreground">
            {(v.page - 1) * v.limit + 1}–{Math.min(v.page * v.limit, v.total)} of {v.total} violations
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={v.page <= 1}
              onClick={() => v.setPage(v.page - 1)}
              aria-label="Previous page"
            >
              <HugeiconsIcon icon={ArrowLeft01Icon} strokeWidth={2} />
            </Button>
            <span className="text-xs px-2 text-muted-foreground">
              {v.page} / {v.totalPages}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={v.page >= v.totalPages}
              onClick={() => v.setPage(v.page + 1)}
              aria-label="Next page"
            >
              <HugeiconsIcon icon={ArrowRight01Icon} strokeWidth={2} />
            </Button>
          </div>
        </div>
      )}

      <Dialog open={lightboxUrl !== null} onOpenChange={(open) => !open && setLightboxUrl(null)}>
        <DialogContent
          className="max-w-[96vw] sm:max-w-[96vw] w-[96vw] sm:w-[96vw] h-[96vh] sm:h-[96vh] max-h-[96vh] sm:max-h-[96vh] p-0 rounded-none bg-black/95 border-none flex items-center justify-center overflow-hidden"
          showCloseButton
        >
          {lightboxUrl && (
            <img
              src={lightboxUrl}
              alt="Violation"
              className="w-full h-full object-contain rounded-none"
            />
          )}
        </DialogContent>
      </Dialog>

      <ExportImagesDialog
        open={exportDialogOpen}
        onOpenChange={setExportDialogOpen}
        selectedIds={[...v.selected]}
        pageViolationIds={v.violations.map((x) => x.id)}
      />
    </div>
  );
}
