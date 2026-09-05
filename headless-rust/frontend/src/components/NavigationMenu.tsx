import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { DashboardCircleIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";
import { pluginRegistry } from "@/plugins";
import { ConnectionIndicator } from "./ConnectionIndicator";

const CORE_NAV_ITEMS = [
  { label: "Home", to: "/" },
  { label: "Violations", to: "/violations" },
  { label: "Settings", to: "/settings" },
  { label: "Setup", to: "/setup" },
  { label: "Teable", to: "/teable" },
  { label: "About", to: "/about" },
] as const;

interface NavigationMenuProps {
  className?: string;
}

export function NavigationMenu({ className }: NavigationMenuProps) {
  const appMode = useAppStore((s) => s.appMode);
  const setAppMode = useAppStore((s) => s.setAppMode);

  const pluginNavItems = pluginRegistry.getNavItems();
  const pluginModes = pluginRegistry.getModes();

  const allNavItems = [
    CORE_NAV_ITEMS[0], // Home
    CORE_NAV_ITEMS[1], // Violations
    ...pluginNavItems, // Dynamic plugin routes (e.g. Laps)
    ...CORE_NAV_ITEMS.slice(2), // Settings, Setup, Teable, About
  ];

  return (
    <nav className={cn("flex items-center gap-0.5 px-2 py-1", className)}>
      {allNavItems.map((item) => (
        <Link
          key={item.to}
          to={item.to}
          className="px-3 py-1.5 text-sm font-medium transition-colors rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/50"
          activeProps={{ className: "text-foreground bg-accent hover:bg-accent" }}
          inactiveProps={{}}
          activeOptions={{ exact: item.to === "/" }}
        >
          {item.label}
        </Link>
      ))}

      {/* Mode toggle */}
      <div className="ml-2 flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-0.5">
        <button
          type="button"
          onClick={() => setAppMode("speedcamera")}
          title="Speed Camera mode"
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            appMode === "speedcamera"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <HugeiconsIcon icon={DashboardCircleIcon} strokeWidth={2} className="w-3.5 h-3.5" />
          Speed
        </button>
        {pluginModes.map((m) => {
          const Icon = m.icon;
          const isActive = appMode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setAppMode(m.id as any)}
              title={`${m.label} mode`}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
                isActive
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <HugeiconsIcon icon={Icon as any} strokeWidth={2} className="w-3.5 h-3.5" />
              {m.label}
            </button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center">
        <ConnectionIndicator />
      </div>
    </nav>
  );
}
