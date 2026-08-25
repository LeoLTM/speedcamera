import { useState } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import { Folder01Icon, Download01Icon } from "@hugeicons/core-free-icons";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { Violation } from "@/shared/types";

interface ExportImagesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedIds: number[];
  pageViolationIds: number[];
  violations?: Violation[];
}

export function ExportImagesDialog({
  open,
  onOpenChange,
  selectedIds,
  pageViolationIds,
  violations = [],
}: ExportImagesDialogProps) {
  const selectedCount = selectedIds.length;
  const pageViolationCount = pageViolationIds.length;
  const targetIds = selectedCount > 0 ? selectedIds : pageViolationIds;
  const totalCount = targetIds.length;

  const [exporting, setExporting] = useState(false);
  const [exportedCount, setExportedCount] = useState(0);

  const supportsDirectoryPicker =
    typeof window !== "undefined" && "showDirectoryPicker" in window;

  const handleExport = async () => {
    if (totalCount === 0) {
      toast.error("No violations selected to export");
      return;
    }

    let dirHandle: any = null;

    if (supportsDirectoryPicker) {
      try {
        dirHandle = await (window as any).showDirectoryPicker({
          mode: "readwrite",
          startIn: "downloads",
        });
      } catch (err: any) {
        if (err?.name === "AbortError") {
          // User closed/cancelled the native folder picker
          return;
        }
        console.warn("[export] Directory picker failed, falling back to download:", err);
      }
    }

    setExporting(true);
    setExportedCount(0);

    let successCount = 0;
    let failedCount = 0;

    try {
      for (let i = 0; i < targetIds.length; i++) {
        const id = targetIds[i];
        try {
          const res = await fetch(`/skinned-image?violationId=${id}`);
          if (!res.ok) {
            throw new Error(`Server returned ${res.status}`);
          }
          const blob = await res.blob();
          const isPng = blob.type.includes("png");
          const ext = isPng ? "png" : "jpg";

          const violation = violations.find((v) => v.id === id);
          const timePart = violation?.timestamp
            ? violation.timestamp.replace(/[:.]/g, "-")
            : new Date().toISOString().replace(/[:.]/g, "-");
          const fileName = `violation-${id}-${timePart}.${ext}`;

          if (dirHandle) {
            // Native File System Access API
            const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
          } else {
            // Fallback direct browser download
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            // Delay slightly between multi-downloads in fallback mode
            if (targetIds.length > 1) {
              await new Promise((r) => setTimeout(r, 150));
            }
          }

          successCount++;
        } catch (err) {
          console.error(`[export] Failed to export violation #${id}:`, err);
          failedCount++;
        }

        setExportedCount(i + 1);
      }

      if (successCount > 0) {
        toast.success(
          `Successfully exported ${successCount} image${successCount > 1 ? "s" : ""}${
            failedCount > 0 ? ` (${failedCount} failed)` : ""
          } to your device.`
        );
        onOpenChange(false);
      } else {
        toast.error("Failed to export images.");
      }
    } catch (err: any) {
      toast.error(`Export failed: ${err?.message || "Unknown error"}`);
    } finally {
      setExporting(false);
    }
  };

  const handleDialogChange = (nextOpen: boolean) => {
    if (!exporting) {
      onOpenChange(nextOpen);
    }
  };

  const progressPercent = totalCount > 0 ? (exportedCount / totalCount) * 100 : 0;

  return (
    <Dialog open={open} onOpenChange={handleDialogChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HugeiconsIcon icon={Folder01Icon} className="size-5 text-primary" strokeWidth={2} />
            Export Skinned Images
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <p className="text-sm text-muted-foreground">
            {selectedCount > 0
              ? `Export ${selectedCount} selected violation(s) with Poliscan overlay to your device.`
              : `Export all ${pageViolationCount} violation(s) on this page with Poliscan overlay to your device.`}
          </p>

          {exporting ? (
            <div className="space-y-2 p-3 rounded-lg bg-muted/40 border border-border">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Exporting images…</span>
                <span>
                  {exportedCount} / {totalCount}
                </span>
              </div>
              <Progress value={progressPercent} className="h-2" />
            </div>
          ) : (
            <div className="text-xs text-muted-foreground/80 bg-muted/30 rounded-lg p-3 border border-border/50">
              {supportsDirectoryPicker
                ? "Clicking export will prompt your device's native folder picker to select a destination directory."
                : "Images will be saved directly into your browser's default downloads location."}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={exporting}>
            Cancel
          </Button>
          <Button onClick={handleExport} disabled={exporting || totalCount === 0} className="gap-2">
            <HugeiconsIcon
              icon={supportsDirectoryPicker ? Folder01Icon : Download01Icon}
              className="size-4"
              strokeWidth={2}
            />
            {exporting
              ? `Exporting (${exportedCount}/${totalCount})…`
              : supportsDirectoryPicker
              ? "Select Folder & Export"
              : "Download Images"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
