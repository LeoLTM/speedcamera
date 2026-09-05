import { useEffect } from "react";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { NavigationMenu } from "@/components/NavigationMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSystemStateSync } from "@/hooks/useSystemStateSync";
import { useAppStore } from "@/stores/useAppStore";
import { getRpc } from "@/lib/rpc";

export const RootRoute = createRootRoute({
  component: Root,
});

function Root() {
  useSystemStateSync();
  const loadTeableState = useAppStore((s) => s.loadTeableState);
  const refreshCameraStatus = useAppStore((s) => s.refreshCameraStatus);
  const refreshSerialStatus = useAppStore((s) => s.refreshSerialStatus);
  const refreshArmedStatus = useAppStore((s) => s.refreshArmedStatus);
  const loadCameraSettings = useAppStore((s) => s.loadCameraSettings);
  const setSelectedPort = useAppStore((s) => s.setSelectedPort);
  const setMaxSpeed = useAppStore((s) => s.setMaxSpeed);
  const setLastViolation = useAppStore((s) => s.setLastViolation);

  useEffect(() => {
    // 1. Load full persistent settings from database
    getRpc()
      .request.getSettings({})
      .then((settings) => {
        loadCameraSettings(settings);
        if (settings.selectedPort) setSelectedPort(settings.selectedPort);
        if (settings.maxSpeed) setMaxSpeed(settings.maxSpeed);
      })
      .catch((err) => console.warn("[root] Failed to load settings:", err));

    // 2. Hydrate hardware and system armed states
    void refreshCameraStatus();
    void refreshSerialStatus();
    void refreshArmedStatus();
    void loadTeableState();

    // 3. Hydrate latest violation for instant preview on home screen
    getRpc()
      .request.getViolations({ page: 1, limit: 1 })
      .then((res) => {
        if (res.violations && res.violations.length > 0) {
          setLastViolation(res.violations[0]);
        }
      })
      .catch(() => {});
  }, [
    loadCameraSettings,
    setSelectedPort,
    setMaxSpeed,
    refreshCameraStatus,
    refreshSerialStatus,
    refreshArmedStatus,
    loadTeableState,
    setLastViolation,
  ]);

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-background text-foreground">
      {/* App-level navigation bar */}
      <div className="flex items-center justify-between border-b border-border">
        <NavigationMenu />
        <div className="px-2">
          <ThemeToggle />
        </div>
      </div>

      {/* Page content */}
      <main className="flex-1 overflow-hidden">
        <Outlet />
      </main>
    </div>
  );
}
