import { Link } from "@tanstack/react-router";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { label: "Home", to: "/" },
  { label: "Violations", to: "/violations" },
  { label: "Settings", to: "/settings" },
  { label: "About", to: "/about" },
] as const;

interface NavigationMenuProps {
  className?: string;
}

export function NavigationMenu({ className }: NavigationMenuProps) {
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
    </nav>
  );
}
