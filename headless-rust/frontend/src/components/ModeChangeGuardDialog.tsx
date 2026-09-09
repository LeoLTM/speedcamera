import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import { Alert02Icon, SecurityCheckIcon } from "@hugeicons/core-free-icons";

interface ModeChangeGuardDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetMode: string;
  onConfirm: () => void;
  onCancel: () => void;
  message?: string;
  isArmed?: boolean;
}

export function ModeChangeGuardDialog({
  open,
  onOpenChange,
  targetMode,
  onConfirm,
  onCancel,
  message,
  isArmed = true,
}: ModeChangeGuardDialogProps) {
  const modeLabels: Record<string, string> = {
    speedcamera: "Speed Camera",
    laptimer: "Lap Timer",
    alignment: "Sensor Alignment",
    setup: "Setup Wizard",
  };

  const targetLabel = modeLabels[targetMode] || targetMode;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
              <HugeiconsIcon icon={isArmed ? SecurityCheckIcon : Alert02Icon} size={22} />
            </div>
            <div>
              <DialogTitle className="text-base font-bold">
                {isArmed ? "System Is Currently Armed" : "Safeguard Confirmation"}
              </DialogTitle>
              <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                Mode transition safeguard triggered
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="py-2 text-sm text-foreground/90 space-y-2">
          <p>
            {message ||
              `The speed camera is currently active and armed. To switch to ${targetLabel}, the system must disarm.`}
          </p>
          <p className="text-xs text-muted-foreground">
            Violations will not be captured while in {targetLabel} mode.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={onCancel}>
            Abort Switch
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={onConfirm}
            className="font-medium"
          >
            {isArmed ? "Disarm & Continue" : "Confirm Switch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
