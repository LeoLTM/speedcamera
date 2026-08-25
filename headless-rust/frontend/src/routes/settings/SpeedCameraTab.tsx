import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { getRpc } from "@/lib/rpc";
import { useAppStore } from "@/stores/useAppStore";
import type { AppSettings } from "@/shared/types";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { HugeiconsIcon } from "@hugeicons/react";
import { RefreshIcon } from "@hugeicons/core-free-icons";

const SPEED_CAMERA_FIELDS: Array<{
  key: keyof AppSettings;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: "maxSpeed", label: "Max Speed", unit: "km/h", min: 1, max: 200, step: 1 },
  { key: "strobeLineDuration", label: "Strobe Duration", unit: "ms", min: 10, max: 20000, step: 10 },
];

const ESP_SYNCED_KEYS = new Set<keyof AppSettings>(["maxSpeed"]);

const SERIAL_SYNC: Partial<Record<keyof AppSettings, string>> = {
  maxSpeed: "setMaxSpeed",
};

export function SpeedCameraTab() {
  const setMaxSpeedInStore = useAppStore((s) => s.setMaxSpeed);
  const connectedPort = useAppStore((s) => s.connectedPort);
  const lastPongConfig = useAppStore((s) => s.lastPongConfig);

  const [values, setValues] = useState<Partial<AppSettings>>({});
  const [saved, setSaved] = useState<Partial<AppSettings>>({});
  const [loading, setLoading] = useState(true);
  const [savingHw, setSavingHw] = useState(false);
  const [savingCosmetic, setSavingCosmetic] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadFromDb = useCallback(async () => {
    const settings = await getRpc().request.getSettings({});
    setValues(settings);
    setSaved(settings);
    return settings;
  }, []);

  useEffect(() => {
    loadFromDb()
      .catch(() => toast.error("Failed to load settings"))
      .finally(() => setLoading(false));
  }, [loadFromDb]);

  useEffect(() => {
    if (!lastPongConfig) return;
    const patch: Partial<AppSettings> = {
      maxSpeed: lastPongConfig.maxSpeed,
    };
    setValues((prev) => ({ ...prev, ...patch }));
    setSaved((prev) => ({ ...prev, ...patch }));
  }, [lastPongConfig]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadFromDb();
      if (connectedPort) {
        await getRpc().request.sendCommand({ json: JSON.stringify({ command: "ping" }) });
      }
    } catch {
      toast.error("Failed to refresh settings");
    } finally {
      setRefreshing(false);
    }
  }, [loadFromDb, connectedPort]);

  const isHwDirty = SPEED_CAMERA_FIELDS.some(({ key }) => values[key] !== saved[key]);
  const isCosmeticDirty =
    (values.skinMeasuringLocation ?? "") !== (saved.skinMeasuringLocation ?? "");

  const handleSaveHw = async () => {
    setSavingHw(true);
    try {
      await Promise.all(
        SPEED_CAMERA_FIELDS.map(({ key }) =>
          getRpc().request.saveSetting({ key, value: String(values[key]) })
        )
      );

      await Promise.all(
        SPEED_CAMERA_FIELDS.filter(({ key }) => values[key] !== saved[key] && key in SERIAL_SYNC).map(
          ({ key }) =>
            getRpc().request.sendCommand({
              json: JSON.stringify({ command: SERIAL_SYNC[key], value: values[key] }),
            })
        )
      );

      setSaved((prev) => {
        const next = { ...prev };
        for (const { key } of SPEED_CAMERA_FIELDS) {
          next[key] = values[key] as never;
        }
        return next;
      });
      if (values.maxSpeed !== undefined) setMaxSpeedInStore(values.maxSpeed);
      toast.success("Hardware settings saved");
    } catch {
      toast.error("Failed to save hardware settings");
    } finally {
      setSavingHw(false);
    }
  };

  const handleSaveCosmetic = async () => {
    setSavingCosmetic(true);
    try {
      await getRpc().request.saveSetting({
        key: "skinMeasuringLocation",
        value: String(values.skinMeasuringLocation ?? ""),
      });

      setSaved((prev) => ({
        ...prev,
        skinMeasuringLocation: values.skinMeasuringLocation,
      }));
      toast.success("Display settings saved");
    } catch {
      toast.error("Failed to save display settings");
    } finally {
      setSavingCosmetic(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg space-y-6">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-24 rounded" />
              <Skeleton className="h-7 w-20 rounded-lg" />
            </div>
            <Skeleton className="h-4 w-full rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  const hwSaveDisabledReason = !connectedPort
    ? "Connect to the ESP before saving hardware settings"
    : undefined;

  return (
    <div className="max-w-lg space-y-8">
      <section className="space-y-6">
        <div className="flex items-center justify-between border-b pb-2">
          <div>
            <h2 className="text-sm font-semibold">Speed Camera Hardware Settings</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {connectedPort
                ? lastPongConfig
                  ? "Values synced from device"
                  : "Connect to device to sync values"
                : <span className="text-amber-500 dark:text-amber-400">Serial not connected — hardware save disabled</span>}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh settings from device"
          >
            <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className={refreshing ? "animate-spin" : ""} />
          </Button>
        </div>

        {SPEED_CAMERA_FIELDS.map(({ key, label, unit, min, max, step }) => {
          const val = (values[key] as number) ?? min;
          const isEspSynced = ESP_SYNCED_KEYS.has(key);
          return (
            <div key={key} className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  {label}
                  {isEspSynced && (
                    <span className="text-[10px] text-muted-foreground/50 font-normal">ESP</span>
                  )}
                </label>
                <div className="flex items-center gap-1.5">
                  <input
                    type="number"
                    min={min}
                    max={max}
                    step={step}
                    value={val}
                    onChange={(e) =>
                      setValues((prev) => ({
                        ...prev,
                        [key]: Math.min(max, Math.max(min, Number(e.target.value))),
                      }))
                    }
                    className="w-20 h-7 px-2 text-sm text-right rounded-lg border border-input bg-input/30 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
                  />
                  <span className="text-xs text-muted-foreground w-8">{unit}</span>
                </div>
              </div>
              <Slider
                min={min}
                max={max}
                step={step}
                value={[val]}
                onValueChange={([v]) => setValues((prev) => ({ ...prev, [key]: v }))}
              />
              <div className="flex justify-between text-xs text-muted-foreground/60">
                <span>{min} {unit}</span>
                <span>{max} {unit}</span>
              </div>
            </div>
          );
        })}

        <div className="flex items-center justify-end pt-2">
          <Button
            onClick={handleSaveHw}
            disabled={!isHwDirty || savingHw || !connectedPort}
            title={hwSaveDisabledReason}
          >
            {savingHw ? "Saving…" : "Save Hardware Settings"}
          </Button>
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold border-b pb-2">Display & Cosmetic Options</h2>
        <div className="space-y-2">
          <label className="text-sm font-medium">Measuring Location (Messort)</label>
          <p className="text-xs text-muted-foreground -mt-1">
            Shown in Poliscan skin bottom bar. e.g. &quot;BAB 2 Km 81,2, Ri. Hannover&quot;
          </p>
          <input
            type="text"
            value={(values.skinMeasuringLocation as string) ?? ""}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, skinMeasuringLocation: e.target.value }))
            }
            placeholder="e.g. BAB 2 Km 81,2, Ri. Hannover"
            className="w-full h-8 px-3 text-sm rounded-lg border border-input bg-input/30 focus:outline-none focus:ring-2 focus:ring-ring/50 focus:border-ring"
          />
        </div>

        <div className="flex items-center justify-end pt-2">
          <Button onClick={handleSaveCosmetic} disabled={!isCosmeticDirty || savingCosmetic}>
            {savingCosmetic ? "Saving…" : "Save Display Settings"}
          </Button>
        </div>
      </section>
    </div>
  );
}
