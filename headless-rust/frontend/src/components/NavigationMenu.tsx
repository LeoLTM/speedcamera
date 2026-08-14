import { Link } from "@tanstack/react-router";
import { HugeiconsIcon } from "@hugeicons/react";
import { Timer01Icon, DashboardCircleIcon } from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/stores/useAppStore";

const NAV_ITEMS = [
  { label: "Home", to: "/" },
  { label: "Violations", to: "/violations" },
  { label: "Laps", to: "/laps" },
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

  return (
    <nav className={cn("flex items-center gap-0.5 px-2 py-1", className)}>
      {NAV_ITEMS.map((item) => (
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
        <button
          type="button"
          onClick={() => setAppMode("laptimer")}
          title="Lap Timer mode"
          className={cn(
            "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors",
            appMode === "laptimer"
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <HugeiconsIcon icon={Timer01Icon} strokeWidth={2} className="w-3.5 h-3.5" />
          Laps
        </button>
      </div>
    </nav>
  );
}
