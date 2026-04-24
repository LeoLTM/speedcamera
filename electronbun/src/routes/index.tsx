import { useEffect } from "react";
import { createRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { RootRoute } from "./__root";
import { LiveCamera } from "@/components/LiveCamera";
import { StatusBadge } from "@/components/StatusBadge";
import { ViolationCard } from "@/components/ViolationCard";
import { useAppStore } from "@/stores/useAppStore";
import { getRpc } from "@/lib/rpc";

export const IndexRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/",
  component: HomePage,
});

function HomePage() {
  const connectedPort = useAppStore((s) => s.connectedPort);
  const selectedCameraDeviceId = useAppStore((s) => s.selectedCameraDeviceId);
  const lastSpeed = useAppStore((s) => s.lastSpeed);
  const lastViolation = useAppStore((s) => s.lastViolation);
  const setMaxSpeed = useAppStore((s) => s.setMaxSpeed);
  const setPictureDelay = useAppStore((s) => s.setPictureDelay);

  const serialStatus = connectedPort ? "connected" : "disconnected";
  const cameraStatus = selectedCameraDeviceId ? "connected" : "unknown";

  // Load relevant settings into the store on mount
  useEffect(() => {
    getRpc()
      .request.getSettings({})
      .then((settings) => {
        setMaxSpeed(settings.maxSpeed);
        setPictureDelay(settings.pictureDelay);
      })
      .catch(() => toast.error("Failed to load settings"));
  }, [setMaxSpeed, setPictureDelay]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Status bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border/50 bg-muted/30 shrink-0">
        <StatusBadge
          status={serialStatus}
          label={connectedPort ? `Serial: ${connectedPort}` : "Serial: disconnected"}
        />
        <StatusBadge
          status={cameraStatus}
          label={selectedCameraDeviceId ? "Camera: connected" : "Camera: not selected"}
        />
      </div>

      {/* Content */}
      <div className="flex flex-1 overflow-hidden gap-0">
        {/* Main: camera feed */}
        <div className="flex-1 flex items-center justify-center p-4 overflow-hidden bg-black/5 dark:bg-black/20">
          <LiveCamera className="w-full max-h-full" />
        </div>

        {/* Side panel */}
        <div className="w-72 shrink-0 flex flex-col gap-4 p-4 border-l border-border overflow-y-auto">
          {/* Speed reading */}
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">
              Current Speed
            </p>
            <p
              className={
                lastSpeed !== null
                  ? "text-5xl font-bold tabular-nums"
                  : "text-3xl font-medium text-muted-foreground/50"
              }
            >
              {lastSpeed !== null ? lastSpeed : "—"}
            </p>
            {lastSpeed !== null && (
              <p className="text-xs text-muted-foreground mt-1">km/h</p>
            )}
          </div>

          {/* Last violation */}
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-widest mb-2 px-0.5">
              Last Violation
            </p>
            {lastViolation ? (
              <ViolationCard violation={lastViolation} />
            ) : (
              <div className="rounded-xl border border-border bg-card p-4 text-center">
                <p className="text-sm text-muted-foreground">No violations yet</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
