import { createRoute } from "@tanstack/react-router";
import { RootRoute } from "./__root";
import { Button } from "@/components/ui/button";
import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  DownloadCircle02Icon,
  RefreshIcon,
  Cancel01Icon,
  Alert02Icon,
  CheckmarkCircle02Icon,
} from "@hugeicons/core-free-icons";
import { getRpc } from "@/lib/rpc";
import { useAppStore } from "@/stores/useAppStore";

const GITHUB_URL = "https://github.com/LeoLTM/speedcamera";

export const AboutRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/about",
  component: AboutPage,
});

function AboutPage() {
  const [localVersion, setLocalVersion] = useState<{
    version: string;
    channel: string;
    hash: string;
  } | null>(null);
  const [versionLoading, setVersionLoading] = useState(true);

  const updatePhase = useAppStore((s) => s.updatePhase);
  const updateMessage = useAppStore((s) => s.updateMessage);
  const updateProgress = useAppStore((s) => s.updateProgress);
  const updateVersion = useAppStore((s) => s.updateVersion);
  const updateError = useAppStore((s) => s.updateError);
  const resetUpdater = useAppStore((s) => s.resetUpdater);
  const setUpdatePhase = useAppStore((s) => s.setUpdatePhase);
  const setUpdateVersion = useAppStore((s) => s.setUpdateVersion);
  const setUpdateError = useAppStore((s) => s.setUpdateError);

  const handleOpenGitHub = () => {
    window.open(GITHUB_URL, "_blank", "noopener,noreferrer");
  };

  // Load local version on mount
  useEffect(() => {
    getRpc()
      .request.getLocalVersion({})
      .then((info) => setLocalVersion(info))
      .catch(() => setLocalVersion(null))
      .finally(() => setVersionLoading(false));
  }, []);

  const handleCheckForUpdate = useCallback(async () => {
    resetUpdater();
    setUpdatePhase("checking");
    try {
      const info = await getRpc().request.checkForUpdate({});
      if (info.error) {
        setUpdateError(info.error);
        setUpdatePhase("error");
        toast.error(info.error);
        return;
      }
      if (info.updateAvailable) {
        setUpdateVersion(info.version);
        toast.info(`Update available: v${info.version}`);
      } else {
        setUpdatePhase("idle");
        toast.success("You're on the latest version");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUpdateError(msg);
      setUpdatePhase("error");
      toast.error(`Update check failed: ${msg}`);
    }
  }, [resetUpdater, setUpdatePhase, setUpdateError, setUpdateVersion]);

  const handleDownloadUpdate = useCallback(async () => {
    setUpdatePhase("downloading");
    setUpdateError(null);
    try {
      const result = await getRpc().request.downloadUpdate({});
      if (!result.ok) {
        setUpdateError(result.error ?? "Download failed");
        setUpdatePhase("error");
        toast.error(result.error ?? "Download failed");
        return;
      }
      setUpdatePhase("ready");
      toast.success("Update downloaded — ready to install");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setUpdateError(msg);
      setUpdatePhase("error");
      toast.error(`Download failed: ${msg}`);
    }
  }, [setUpdatePhase, setUpdateError]);

  const handleApplyUpdate = useCallback(async () => {
    try {
      await getRpc().request.applyUpdate({});
      // App quits + relaunches; this line may not run
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to apply update: ${msg}`);
    }
  }, []);

  const isBusy = updatePhase === "checking" || updatePhase === "downloading";
  const canDownload = updateVersion !== null && updatePhase !== "downloading" && updatePhase !== "ready";
  const canApply = updatePhase === "ready";

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8 text-center overflow-y-auto py-8">
      <div className="space-y-2">
        <div className="flex items-center justify-center size-16 rounded-2xl bg-primary/10 mx-auto mb-2" />
        <h1 className="text-2xl font-bold tracking-tight">Speedcamera</h1>
        <p className="text-sm text-muted-foreground">
          Companion app for the ESP32-based speed camera
        </p>
      </div>

      <div className="rounded-xl border border-border bg-card px-6 py-4 space-y-1 text-sm min-w-70">
        <div className="flex items-center justify-between gap-8">
          <span className="text-muted-foreground">Version</span>
          <span className="font-mono font-medium">
            {versionLoading
              ? "…"
              : localVersion
                ? `v${localVersion.version}`
                : "unknown"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-8">
          <span className="text-muted-foreground">Channel</span>
          <span className="font-mono font-medium">
            {localVersion?.channel ?? "—"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-8">
          <span className="text-muted-foreground">Build hash</span>
          <span className="font-mono font-medium text-xs">
            {localVersion?.hash?.slice(0, 8) ?? "—"}
          </span>
        </div>
        <div className="flex items-center justify-between gap-8">
          <span className="text-muted-foreground">Runtime</span>
          <span className="font-mono font-medium">Rust + Rocket</span>
        </div>
        <div className="flex items-center justify-between gap-8">
          <span className="text-muted-foreground">UI</span>
          <span className="font-mono font-medium">React + Vite + shadcn</span>
        </div>
      </div>

      {/* ── Update controls ─────────────────────────────────────────────────── */}
      <div className="rounded-xl border border-border bg-card px-6 py-4 space-y-3 text-sm min-w-70">
        <h2 className="text-sm font-semibold flex items-center gap-2 justify-center">
          <HugeiconsIcon icon={DownloadCircle02Icon} size={16} strokeWidth={2} />
          App Updates
        </h2>

        {localVersion?.channel === "dev" && (
          <p className="text-xs text-muted-foreground">
            Updates disabled in dev channel.
          </p>
        )}

        {/* Available version badge */}
        {updateVersion && updatePhase !== "idle" && (
          <div className="flex items-center justify-center gap-2 text-xs">
            <span className="text-muted-foreground">Latest:</span>
            <span className="font-mono font-medium">v{updateVersion}</span>
          </div>
        )}

        {/* Progress bar */}
        {(updatePhase === "downloading" || updatePhase === "checking") && (
          <div className="space-y-1">
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary transition-all"
                style={{
                  width: updateProgress != null ? `${updateProgress}%` : "100%",
                  animation: updateProgress == null ? "pulse 1.5s ease-in-out infinite" : undefined,
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground truncate text-center">
              {updateMessage}
              {updateProgress != null ? ` (${updateProgress}%)` : ""}
            </p>
          </div>
        )}

        {/* Error */}
        {updatePhase === "error" && (
          <p className="text-xs text-destructive flex items-center gap-1 justify-center font-medium">
            <HugeiconsIcon icon={Alert02Icon} size={12} strokeWidth={2} />
            {updateError}
          </p>
        )}

        {/* Ready */}
        {updatePhase === "ready" && (
          <p className="text-xs text-green-600 dark:text-green-400 flex items-center gap-1 justify-center font-medium">
            <HugeiconsIcon icon={CheckmarkCircle02Icon} size={12} strokeWidth={2} />
            Update ready — restart to install
          </p>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleCheckForUpdate}
            disabled={isBusy || localVersion?.channel === "dev"}
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              strokeWidth={2}
              className={updatePhase === "checking" ? "animate-spin" : ""}
            />
            Check for updates
          </Button>

          {canDownload && (
            <Button size="sm" onClick={handleDownloadUpdate} disabled={isBusy}>
              <HugeiconsIcon icon={DownloadCircle02Icon} strokeWidth={2} />
              Download
            </Button>
          )}

          {canApply && (
            <Button size="sm" onClick={handleApplyUpdate}>
              <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} />
              Restart &amp; install
            </Button>
          )}

          {isBusy && (
            <Button variant="outline" size="sm" disabled>
              <HugeiconsIcon icon={Cancel01Icon} strokeWidth={2} />
              Working…
            </Button>
          )}
        </div>
      </div>

      <Button variant="outline" onClick={handleOpenGitHub}>
        View on GitHub
      </Button>

      <p className="text-xs text-muted-foreground/50 max-w-xs">
        Built to detect and log speed violations using a webcam and Arduino/ESP32 + light barriers.
      </p>
    </div>
  );
}
