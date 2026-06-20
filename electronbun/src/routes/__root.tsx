import { useEffect } from "react";
import { Outlet, createRootRoute } from "@tanstack/react-router";
import { NavigationMenu } from "@/components/NavigationMenu";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useSystemStateSync } from "@/hooks/useSystemStateSync";
import { useAppStore } from "@/stores/useAppStore";

export const RootRoute = createRootRoute({
  component: Root,
});

function Root() {
  useSystemStateSync();
  const loadLapSettings = useAppStore((s) => s.loadLapSettings);
  const loadTeableState = useAppStore((s) => s.loadTeableState);
  const refreshCameraStatus = useAppStore((s) => s.refreshCameraStatus);

  useEffect(() => {
    void loadLapSettings();
    void loadTeableState();
    void refreshCameraStatus();
  }, [loadLapSettings, loadTeableState, refreshCameraStatus]);

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
