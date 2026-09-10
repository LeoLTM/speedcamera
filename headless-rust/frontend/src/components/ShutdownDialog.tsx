import { useState } from "react";
import { toast } from "sonner";
import { getRpc } from "@/lib/rpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle, Power, Loader2, CheckCircle2 } from "lucide-react";

interface ShutdownDialogProps {
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function ShutdownDialog({ trigger, open: controlledOpen, onOpenChange }: ShutdownDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;

  const setOpen = (next: boolean) => {
    if (!next) {
      // Reset state when closing
      setPassword("");
      setErrorMessage(null);
      setCompleted(false);
    }
    if (isControlled) {
      onOpenChange?.(next);
    } else {
      setInternalOpen(next);
    }
  };

  const [password, setPassword] = useState("");
  const [shuttingDown, setShuttingDown] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [completed, setCompleted] = useState(false);
  const [simulated, setSimulated] = useState(false);

  const handleShutdown = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setShuttingDown(true);
    setErrorMessage(null);
    try {
      const res = await getRpc().request.shutdownHost({
        password: password.trim() ? password.trim() : undefined,
      });
      setCompleted(true);
      setSimulated(Boolean(res?.simulated));
      toast.success(res?.simulated ? "Shutdown simulated (mock mode)" : "Host system is shutting down...");
    } catch (err: any) {
      const msg = err?.message || String(err);
      setErrorMessage(msg);
      toast.error(`Shutdown failed: ${msg}`);
    } finally {
      setShuttingDown(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="gap-2">
          <div className="flex items-center gap-2.5 text-rose-500">
            <div className="p-2 rounded-full bg-rose-500/10 border border-rose-500/20">
              <Power className="w-5 h-5 text-rose-500" />
            </div>
            <DialogTitle className="text-base font-bold">Shut Down Raspberry Pi Host</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground leading-relaxed pt-1">
            This will cleanly shut down the Raspberry Pi operating system and stop all background camera services.
            You will need to power cycle the hardware to turn it back on.
          </DialogDescription>
        </DialogHeader>

        {completed ? (
          <div className="py-4 space-y-3 text-center">
            <div className="inline-flex p-3 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
              <CheckCircle2 className="w-8 h-8" />
            </div>
            <h4 className="text-sm font-semibold text-foreground">
              {simulated ? "Shutdown Simulated (Mock Mode)" : "System Powering Off"}
            </h4>
            <p className="text-xs text-muted-foreground max-w-xs mx-auto">
              {simulated
                ? "Mock hardware mode is enabled. No actual machine shutdown was initiated."
                : "The host Raspberry Pi has received the shutdown command and will power down shortly. You can safely disconnect power once the activity LED stops blinking."}
            </p>
            <DialogFooter className="pt-2 sm:justify-center">
              <DialogClose asChild>
                <Button variant="outline" size="sm">
                  Close
                </Button>
              </DialogClose>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={handleShutdown} className="space-y-4 pt-1">
            {errorMessage && (
              <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-xs flex items-start gap-2 break-words">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <span className="font-semibold block">Shutdown request failed:</span>
                  <span className="text-[11px] opacity-90">{errorMessage}</span>
                  <span className="block text-[11px] text-muted-foreground mt-1">
                    If your Pi user requires a sudo password, please enter it below.
                  </span>
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="sudo-password" className="text-xs font-semibold">
                Sudo Password (optional)
              </Label>
              <Input
                id="sudo-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Leave empty if passwordless sudo is enabled"
                className="font-mono text-xs"
                disabled={shuttingDown}
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">
                Leave empty if passwordless sudo is configured on your Raspberry Pi.
              </p>
            </div>

            <DialogFooter className="gap-2 sm:gap-0 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={shuttingDown}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="destructive"
                size="sm"
                disabled={shuttingDown}
                className="gap-1.5"
              >
                {shuttingDown ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Shutting down...
                  </>
                ) : (
                  <>
                    <Power className="w-3.5 h-3.5" />
                    Yes, Shut Down Now
                  </>
                )}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
