import { useEffect } from "react";
import { createRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { RootRoute } from "./__root";
import { LastCapturedImage } from "@/components/LastCapturedImage";
import { StatusBadge } from "@/components/StatusBadge";
import { ViolationCard } from "@/components/ViolationCard";
import { ArmingButton } from "@/components/ArmingButton";
import { useAppStore } from "@/stores/useAppStore";
import { useLapStore } from "@/plugins/laptimer/store";
import { pluginRegistry } from "@/plugins";
import { getRpc } from "@/lib/rpc";
import { HugeiconsIcon } from "@hugeicons/react";
import { ArrowUpBigIcon, ArrowDownBigIcon, DashboardCircleIcon, Timer01Icon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

export const IndexRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/",
  component: HomePage,
});

function HomePage() {
  const connectedPort = useAppStore((s) => s.connectedPort);
  const cameraConnected = useAppStore((s) => s.cameraConnected);
  const lastSpeed = useAppStore((s) => s.lastSpeed);
  const lastDirection = useAppStore((s) => s.lastDirection);
  const lastViolation = useAppStore((s) => s.lastViolation);
  const setMaxSpeed = useAppStore((s) => s.setMaxSpeed);
  const appMode = useAppStore((s) => s.appMode);
  const setAppMode = useAppStore((s) => s.setAppMode);

  const lapState = useLapStore((s) => s.lapState);
  const isLapActive = lapState !== "idle";

  const SidePanel = pluginRegistry.getSidePanel(appMode);

  const serialStatus = connectedPort ? "connected" : "disconnected";
  const cameraStatus = cameraConnected ? "connected" : "unknown";

  // Load relevant settings into the store on mount
  useEffect(() => {
    getRpc()
      .request.getSettings({})
      .then((settings) => {
        setMaxSpeed(settings.maxSpeed);
      })
      .catch(() => toast.error("Failed to load settings"));
  }, [setMaxSpeed]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Top Header: Status Badges & Home Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b border-border/50 bg-muted/30 shrink-0">
        <div className="hidden sm:flex items-center gap-3">
          <StatusBadge
            status={serialStatus}
            label={connectedPort ? `Serial: ${connectedPort}` : "Serial: disconnected"}
          />
          <StatusBadge
            status={cameraStatus}
            label={cameraConnected ? "Camera: connected" : "Camera: disconnected"}
          />
        </div>

        {/* Home Mode Switcher */}
        <div className="flex items-center gap-1 rounded-lg border border-border bg-background/80 p-1 shadow-sm overflow-x-auto no-scrollbar w-full sm:w-auto">
          <button
            type="button"
            onClick={() => setAppMode("speedcamera")}
            className={cn(
              "flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all shrink-0 flex-1 sm:flex-initial",
              appMode === "speedcamera"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
            )}
          >
            <HugeiconsIcon icon={DashboardCircleIcon} strokeWidth={2} className="w-4 h-4" />
            <span>Speed Camera</span>
          </button>

          {pluginRegistry.getModes().map((m) => {
            const isCurrent = appMode === m.id;
            const Icon = m.icon as any;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setAppMode(m.id)}
                className={cn(
                  "flex items-center justify-center gap-2 px-3 py-1.5 rounded-md text-xs font-semibold transition-all relative shrink-0 flex-1 sm:flex-initial",
                  isCurrent
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
                )}
              >
                {Array.isArray(Icon) ? (
                  <HugeiconsIcon icon={Icon} strokeWidth={2} className="w-4 h-4" />
                ) : (
                  <Icon className="w-4 h-4" />
                )}
                <span>{m.label}</span>
                {m.id === "laptimer" && isLapActive && (
                  <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" title="Lap timer session running" />
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main workspace */}
      <div className="flex flex-col md:flex-row flex-1 overflow-y-auto md:overflow-hidden gap-0">
        {/* Camera feed */}
        <div className="w-full md:flex-1 h-64 sm:h-80 md:h-auto shrink-0 flex items-center justify-center p-2 sm:p-4 overflow-hidden bg-black/5 dark:bg-black/20 border-b md:border-b-0 border-border">
          <LastCapturedImage />
        </div>

        {/* Contextual side panel */}
        <div
          className={cn(
            "w-full shrink-0 flex flex-col gap-4 p-3 sm:p-4 md:border-l border-border md:overflow-y-auto transition-all duration-200",
            appMode !== "speedcamera" ? "md:w-[480px] lg:w-[540px]" : "md:w-80",
          )}
        >
          {SidePanel ? (
            <SidePanel />
          ) : (
            /* ── Speed camera panel ── */
            <>
              {/* Arming control */}
              <ArmingButton />

              {/* Speed reading */}
              <div className="rounded-xl border border-border bg-card p-4 text-center flex flex-row items-center justify-around shadow-sm">
                {lastSpeed !== null && lastDirection !== null && (
                  <p className="flex items-center justify-center gap-1">
                    <HugeiconsIcon
                      icon={lastDirection === "forward" ? ArrowUpBigIcon : ArrowDownBigIcon}
                      size={48}
                      strokeWidth={2}
                    />
                  </p>
                )}
                <div className="flex flex-col items-center">
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}
