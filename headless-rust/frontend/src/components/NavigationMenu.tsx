import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";
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
  const pluginNavItems = pluginRegistry.getNavItems();

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

      <div className="ml-auto flex items-center">
        <ConnectionIndicator />
      </div>
    </nav>
  );
}
