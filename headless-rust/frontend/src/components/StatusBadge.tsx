import { cn } from "@/lib/utils";

export type ConnectionStatus = "connected" | "disconnected" | "unknown";

interface StatusBadgeProps {
  status: ConnectionStatus;
  label: string;
  className?: string;
}

const STATUS_STYLES: Record<ConnectionStatus, { dot: string; label: string }> = {
  connected: {
    dot: "bg-green-500",
    label: "text-green-600 dark:text-green-400",
  },
  disconnected: {
    dot: "bg-red-500",
    label: "text-red-600 dark:text-red-400",
  },
  unknown: {
    dot: "bg-muted-foreground/40",
    label: "text-muted-foreground",
  },
};

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const { dot, label: labelClass } = STATUS_STYLES[status];

  return (
    <div
      className={cn("inline-flex items-center gap-1.5 text-xs font-medium", className)}
      role="status"
      aria-label={`${label}: ${status}`}
    >
      <span
        className={cn(
          "size-2 rounded-full shrink-0",
          dot,
          status === "connected" && "animate-pulse",
        )}
        aria-hidden="true"
      />
      <span className={labelClass}>{label}</span>
    </div>
  );
}
