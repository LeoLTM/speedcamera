import { Switch } from "@/components/ui/switch";
import { useAppStore } from "@/stores/useAppStore";

export function SyncToggleSection() {
  const teableConnected = useAppStore((s) => s.teableConnected);
  const teableTableId = useAppStore((s) => s.teableTableId);
  const teableSchemaStatus = useAppStore((s) => s.teableSchemaStatus);
  const teableSyncEnabled = useAppStore((s) => s.teableSyncEnabled);
  const setTeableSyncEnabled = useAppStore((s) => s.setTeableSyncEnabled);

  const canSync = teableConnected && !!teableTableId && teableSchemaStatus === "valid";

  if (!canSync) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
        Sync Settings
      </h2>

      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Enable Teable Sync</p>
            <p className="text-xs text-muted-foreground">
              Each completed lap will be saved to Teable in the background. Local storage is
              always used regardless of this setting.
            </p>
          </div>
          <Switch
            checked={teableSyncEnabled}
            onCheckedChange={(checked) => void setTeableSyncEnabled(checked)}
            aria-label="Enable Teable sync"
          />
        </div>
      </div>
    </section>
  );
}
