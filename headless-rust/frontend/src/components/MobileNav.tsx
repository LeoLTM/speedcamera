import { Link } from "@tanstack/react-router";
import { Home, AlertOctagon, Settings, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

interface MobileNavProps {
  onOpenMenu: () => void;
  className?: string;
}

export function MobileNav({ onOpenMenu, className }: MobileNavProps) {
  return (
    <nav
      className={cn(
        "fixed bottom-0 left-0 right-0 z-40 bg-background/95 backdrop-blur-md border-t border-border pb-[env(safe-area-inset-bottom)] md:hidden",
        className
      )}
    >
      <div className="flex items-center justify-around h-14 px-2">
        {/* Home */}
        <Link
          to="/"
          className="flex flex-col items-center justify-center flex-1 h-full py-1 text-muted-foreground transition-colors hover:text-foreground"
          activeProps={{
            className: "text-primary font-semibold",
          }}
          activeOptions={{ exact: true }}
        >
          <Home className="size-5" />
          <span className="text-[10px] mt-0.5 tracking-tight">Home</span>
        </Link>

        {/* Violations */}
        <Link
          to="/violations"
          className="flex flex-col items-center justify-center flex-1 h-full py-1 text-muted-foreground transition-colors hover:text-foreground"
          activeProps={{
            className: "text-primary font-semibold",
          }}
        >
          <AlertOctagon className="size-5" />
          <span className="text-[10px] mt-0.5 tracking-tight">Violations</span>
        </Link>

        {/* Settings */}
        <Link
          to="/settings"
          className="flex flex-col items-center justify-center flex-1 h-full py-1 text-muted-foreground transition-colors hover:text-foreground"
          activeProps={{
            className: "text-primary font-semibold",
          }}
        >
          <Settings className="size-5" />
          <span className="text-[10px] mt-0.5 tracking-tight">Settings</span>
        </Link>

        {/* More Button */}
        <button
          type="button"
          onClick={onOpenMenu}
          className="flex flex-col items-center justify-center flex-1 h-full py-1 text-muted-foreground transition-colors hover:text-foreground focus:outline-none"
          aria-label="Open full menu"
        >
          <Menu className="size-5" />
          <span className="text-[10px] mt-0.5 tracking-tight">More</span>
        </button>
      </div>
    </nav>
  );
}
