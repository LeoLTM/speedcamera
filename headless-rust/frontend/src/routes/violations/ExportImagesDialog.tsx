import { useState } from "react";
import { toast } from "sonner";
import { getRpc } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

interface ExportImagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: number[];
  pageViolationIds: number[];
}

export function ExportImagesDialog({
  open,
  onOpenChange,
  selectedIds,
  pageViolationIds,
}: ExportImagesDialogProps) {
  const selectedCount = selectedIds.length;
  const pageViolationCount = pageViolationIds.length;
  const [exportDir, setExportDir] = useState("");
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    if (!exportDir.trim()) {
      toast.error("Please enter an export directory");
      return;
    }
    setExporting(true);
    try {
      const ids = selectedCount > 0 ? selectedIds : pageViolationIds;
      const result = await getRpc().request.exportSkinnedImages({
        violationIds: ids,
        targetDir: exportDir.trim(),
      });
      toast.success(`Exported ${result.exported} images${result.failed ? `, ${result.failed} failed` : ""}`);
      onOpenChange(false);
    } catch {
      toast.error("Failed to export images");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Export Skinned Images</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {selectedCount > 0
            ? `Export ${selectedCount} selected violation(s) with Poliscan skin.`
            : `Export all ${pageViolationCount} violations on this page with Poliscan skin.`}
        </p>
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Export Directory</label>
          <input
            type="text"
            value={exportDir}
            onChange={(e) => setExportDir(e.target.value)}
            placeholder="/home/user/exports"
            className="w-full h-8 px-3 text-sm rounded-lg border border-input bg-input/30 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={exporting || !exportDir.trim()}>
            {exporting ? "Exporting…" : "Export"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
