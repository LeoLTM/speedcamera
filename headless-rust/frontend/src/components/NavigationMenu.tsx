import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
import { pluginRegistry } from "@/plugins";
import { useAppStore } from "@/stores/useAppStore";
import { ConnectionIndicator } from "./ConnectionIndicator";

const CORE_NAV_ITEMS = [
  { label: "Home", to: "/" },
  { label: "Violations", to: "/violations" },
  { label: "Settings", to: "/settings" },
  { label: "Setup", to: "/setup" },
  { label: "Teable", to: "/teable" },
] as const;

const MODE_META: Record<string, { label: string; badgeClass: string }> = {
  speedcamera: {
    label: "Speed Camera",
    badgeClass: "bg-blue-500/10 text-blue-400 border-blue-500/25",
  },
  laptimer: {
    label: "Lap Timer",
    badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  },
  alignment: {
    label: "Alignment",
    badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  },
  setup: {
    label: "Setup",
    badgeClass: "bg-purple-500/10 text-purple-400 border-purple-500/25",
  },
};

interface NavigationMenuProps {
  className?: string;
}

export function NavigationMenu({ className }: NavigationMenuProps) {
  const pluginNavItems = pluginRegistry.getNavItems();
  const operatingMode = useAppStore((s) => s.operatingMode);
  const currentModeMeta = MODE_META[operatingMode] ?? {
    label: operatingMode,
    badgeClass: "bg-muted text-muted-foreground border-border",
  };

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

      <div className="ml-auto flex items-center gap-2">
        <span
          className={cn(
            "text-xs px-2.5 py-0.5 rounded-full border font-medium transition-colors",
            currentModeMeta.badgeClass
          )}
          title={`Active Operating Mode: ${currentModeMeta.label}`}
        >
          {currentModeMeta.label}
        </span>
        <ConnectionIndicator />
      </div>
    </nav>
  );
}
