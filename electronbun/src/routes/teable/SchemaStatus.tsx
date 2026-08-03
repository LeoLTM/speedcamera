import { Button } from "@/components/ui/button";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  RefreshIcon,
  CheckmarkCircle02Icon,
  Alert01Icon,
  PlusSignSquareIcon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";

interface SchemaStatusProps {
  status: "unchecked" | "valid" | "missing";
  missingFields: string[];
  isLoading: boolean;
  onVerify: () => void;
  onPatch: () => void;
  onCreateNew: () => void;
}

export function SchemaStatus({
  status,
  missingFields,
  isLoading,
  onVerify,
  onPatch,
  onCreateNew,
}: SchemaStatusProps) {
  if (status === "unchecked") {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={onVerify}
        disabled={isLoading}
        className="gap-2 w-full"
      >
        {isLoading ? (
          <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="h-4 w-4 animate-spin" />
        ) : (
          <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className="h-4 w-4" />
        )}
        Check Table Schema
      </Button>
    );
  }

  if (status === "valid") {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400 bg-green-500/10 rounded-lg px-3 py-2">
        <HugeiconsIcon icon={CheckmarkCircle02Icon} strokeWidth={2} className="h-4 w-4 shrink-0" />
        All required columns are present
      </div>
    );
  }

  // status === "missing"
  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 space-y-2">
        <div className="flex items-center gap-2 text-sm font-medium text-amber-600 dark:text-amber-400">
          <HugeiconsIcon icon={Alert01Icon} strokeWidth={2} className="h-4 w-4 shrink-0" />
          Missing {missingFields.length} required column{missingFields.length > 1 ? "s" : ""}
        </div>
        <ul className="text-xs text-muted-foreground space-y-0.5 pl-6 list-disc">
          {missingFields.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={onPatch}
          disabled={isLoading}
          className="flex-1 gap-2"
        >
          {isLoading ? (
            <HugeiconsIcon icon={Loading03Icon} strokeWidth={2} className="h-4 w-4 animate-spin" />
          ) : (
            <HugeiconsIcon icon={PlusSignSquareIcon} strokeWidth={2} className="h-4 w-4" />
          )}
          Add Missing Columns
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onCreateNew}
          disabled={isLoading}
          className="flex-1 gap-2"
        >
          <HugeiconsIcon icon={PlusSignSquareIcon} strokeWidth={2} className="h-4 w-4" />
          Create New Table
        </Button>
      </div>
    </div>
  );
}
