import { Link } from "@tanstack/react-router";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { pluginRegistry } from "@/plugins";
import { useAppStore } from "@/stores/useAppStore";
import { ThemeToggle } from "./ThemeToggle";
import { StatusBadge } from "./StatusBadge";
import {
  Home,
  AlertOctagon,
  Settings,
  Sliders,
  Database,
  Layers,
  ChevronRight,
  Power,
} from "lucide-react";
import { ShutdownDialog } from "./ShutdownDialog";
import { cn } from "@/lib/utils";

interface MobileMenuSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const CORE_NAV_LINKS = [
  { label: "Dashboard / Home", to: "/", icon: Home },
  { label: "Violations Log", to: "/violations", icon: AlertOctagon },
  { label: "Camera Setup", to: "/setup", icon: Sliders },
  { label: "System Settings", to: "/settings", icon: Settings },
  { label: "Teable Sync", to: "/teable", icon: Database },
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

export function MobileMenuSheet({ open, onOpenChange }: MobileMenuSheetProps) {
  const connectedPort = useAppStore((s) => s.connectedPort);
  const cameraConnected = useAppStore((s) => s.cameraConnected);
  const systemState = useAppStore((s) => s.systemState);
  const operatingMode = useAppStore((s) => s.operatingMode);

  const currentModeMeta = MODE_META[operatingMode] ?? {
    label: operatingMode,
    badgeClass: "bg-muted text-muted-foreground border-border",
  };

  const pluginNavItems = pluginRegistry.getNavItems();

  const handleNavigate = () => {
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[85vw] max-w-xs flex flex-col p-0 gap-0">
        {/* Header with Title */}
        <SheetHeader className="p-4 border-b border-border bg-muted/20">
          <div className="flex items-center justify-between pr-8">
            <SheetTitle className="text-base font-bold tracking-tight">Speedcamera</SheetTitle>
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "text-[10px] font-semibold px-2 py-0.5 rounded-full border",
                  currentModeMeta.badgeClass
                )}
              >
                {currentModeMeta.label}
              </span>
              <span
                className={cn(
                  "text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border",
                  systemState === "ARMED"
                    ? "bg-red-500/20 text-red-400 border-red-500/40"
                    : systemState === "DISARMED"
                      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                      : "bg-muted text-muted-foreground border-border"
                )}
              >
                {systemState}
              </span>
            </div>
          </div>
          <SheetDescription className="sr-only">Mobile Navigation Menu</SheetDescription>

          {/* Quick Hardware Status */}
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <StatusBadge
              status={connectedPort ? "connected" : "disconnected"}
              label={connectedPort ? `Serial: ${connectedPort}` : "Serial: disconnected"}
            />
            <StatusBadge
              status={cameraConnected ? "connected" : "unknown"}
              label={cameraConnected ? "Camera: connected" : "Camera: disconnected"}
            />
          </div>
        </SheetHeader>

        {/* Navigation Links */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-2 py-1">
            Menu
          </p>

          {CORE_NAV_LINKS.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={handleNavigate}
                className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/60"
                activeProps={{
                  className: "text-foreground bg-accent font-semibold",
                }}
                activeOptions={{ exact: item.to === "/" }}
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                  <span>{item.label}</span>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
              </Link>
            );
          })}

          {pluginNavItems.length > 0 && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground px-2 pt-4 pb-1">
                Plugins
              </p>
              {pluginNavItems.map((item) => (
                <Link
                  key={item.to}
                  to={item.to}
                  onClick={handleNavigate}
                  className="flex items-center justify-between px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-muted-foreground hover:text-foreground hover:bg-accent/60"
                  activeProps={{
                    className: "text-foreground bg-accent font-semibold",
                  }}
                >
                  <div className="flex items-center gap-3">
                    <Layers className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span>{item.label}</span>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                </Link>
              ))}
            </>
          )}
        </div>

        {/* Footer with Host Shutdown and Theme Toggle */}
        <div className="p-3 border-t border-border bg-muted/20 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Appearance</span>
            <ThemeToggle />
          </div>
          <ShutdownDialog
            trigger={
              <button
                type="button"
                className="w-full flex items-center justify-center gap-2 px-3 py-2 text-xs font-semibold text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/25 rounded-lg transition-colors cursor-pointer"
              >
                <Power className="w-3.5 h-3.5 text-rose-500" />
                <span>Shut Down Host (Pi)</span>
              </button>
            }
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
