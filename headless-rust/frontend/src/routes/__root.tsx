import { useEffect, useState } from "react";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { NavigationMenu } from "@/components/NavigationMenu";
import { MobileNav } from "@/components/MobileNav";
import { MobileMenuSheet } from "@/components/MobileMenuSheet";
import { ConnectionIndicator } from "@/components/ConnectionIndicator";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSystemStateSync } from "@/hooks/useSystemStateSync";
import { useAppStore } from "@/stores/useAppStore";
import { getRpc } from "@/lib/rpc";

export const RootRoute = createRootRoute({
  component: Root,
});

function Root() {
  useSystemStateSync();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

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
    <div className="flex flex-col h-[100dvh] overflow-hidden bg-background text-foreground">
      {/* Desktop navigation bar */}
      <header className="hidden md:flex items-center justify-between border-b border-border shrink-0">
        <NavigationMenu />
        <div className="px-2">
          <ThemeToggle />
        </div>
      </header>

      {/* Mobile top bar */}
      <header className="flex md:hidden items-center justify-between px-3 py-2 border-b border-border bg-background/90 backdrop-blur-md shrink-0 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className="flex items-center gap-2 font-bold tracking-tight text-sm focus:outline-none"
        >
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span>Speedcamera</span>
        </button>
        <div className="flex items-center gap-2">
          <ConnectionIndicator />
          <ThemeToggle />
        </div>
      </header>

      {/* Page content */}
      <main className="flex-1 overflow-hidden pb-14 md:pb-0">
        <Outlet />
      </main>

      {/* Mobile bottom navigation bar */}
      <MobileNav onOpenMenu={() => setMobileMenuOpen(true)} />

      {/* Mobile slide-over drawer */}
      <MobileMenuSheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen} />
    </div>
  );
}
