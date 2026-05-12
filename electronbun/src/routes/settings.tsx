import { useState, useEffect, useCallback } from "react";
import { createRoute } from "@tanstack/react-router";
import { Tabs as TabsPrimitive } from "radix-ui";
import { toast } from "sonner";
import { RootRoute } from "./__root";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getRpc } from "@/lib/rpc";
import { useAppStore } from "@/stores/useAppStore";
import type { AppSettings, PortInfo, HwControl, CameraInfo, EspPongConfig } from "@/shared/types";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  RefreshIcon,
  LinkSquare02Icon,
  Unlink04Icon,
  FilterIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { CalibrationWizard } from "@/components/CalibrationWizard";

export const SettingsRoute = createRoute({
  getParentRoute: () => RootRoute,
  path: "/settings",
  component: SettingsPage,
});

function SettingsPage() {
  return (
    <div className="h-full overflow-hidden flex flex-col">
      <TabsPrimitive.Root defaultValue="device" className="flex flex-col h-full">
        {/* Tab list */}
        <TabsPrimitive.List className="flex shrink-0 border-b border-border px-4 gap-0.5">
          {(["device", "camera-hw", "speed-camera", "lap-timer"] as const).map((tab) => (
            <TabsPrimitive.Trigger
              key={tab}
              value={tab}
              className={cn(
                "px-4 py-2.5 text-sm font-medium text-muted-foreground",
                "border-b-2 border-transparent -mb-px transition-colors",
                "hover:text-foreground",
                "data-[state=active]:text-foreground data-[state=active]:border-primary",
              )}
            >
              {tab === "device"
                ? "Device"
                : tab === "camera-hw"
                ? "Camera HW"
                : tab === "speed-camera"
                ? "Speed Camera"
                : "Lap Timer"}
            </TabsPrimitive.Trigger>
          ))}
        </TabsPrimitive.List>

        {/* Tab panels */}
        <TabsPrimitive.Content value="device" className="flex-1 overflow-y-auto p-6">
          <DeviceTab />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="camera-hw" className="flex-1 overflow-y-auto p-6">
          <CameraHwTab />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="speed-camera" className="flex-1 overflow-y-auto p-6">
          <SpeedCameraTab />
        </TabsPrimitive.Content>
        <TabsPrimitive.Content value="lap-timer" className="flex-1 overflow-y-auto p-6">
          <LapTimerTab />
        </TabsPrimitive.Content>
      </TabsPrimitive.Root>
    </div>
  );
}

// ─── Device Tab ───────────────────────────────────────────────────────────────

function DeviceTab() {
  const connectedPort = useAppStore((s) => s.connectedPort);
  const setConnectedPort = useAppStore((s) => s.setConnectedPort);
  const selectedPort = useAppStore((s) => s.selectedPort);
  const setSelectedPort = useAppStore((s) => s.setSelectedPort);
  const availablePorts = useAppStore((s) => s.availablePorts);
  const setAvailablePorts = useAppStore((s) => s.setAvailablePorts);
  const lastPongConfig = useAppStore((s) => s.lastPongConfig);

  const [loadingPorts, setLoadingPorts] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [pinging, setPinging] = useState(false);
  const [showAllPorts, setShowAllPorts] = useState(false);

  // Filter ports to likely ESP/USB serial devices.
  // On Linux: /dev/ttyUSB*, /dev/ttyACM*
  // On Windows: COM* (these are all serial, show them)
  // On macOS: /dev/cu.usbserial*, /dev/cu.usbmodem*, /dev/tty.usbserial*, /dev/tty.usbmodem*
  const filteredPorts = showAllPorts
    ? availablePorts
    : availablePorts.filter((p) =>
        /\/dev\/(ttyUSB|ttyACM)|COM\d|cu\.usb|tty\.usb/i.test(p.path)
      );

  const sendPing = useCallback(async () => {
    setPinging(true);
    try {
      await getRpc().request.sendCommand({ json: JSON.stringify({ command: "ping" }) });
    } catch {
      // silently ignore — port may not be open yet
    } finally {
      setPinging(false);
    }
  }, []);

  const refreshPorts = useCallback(async () => {
    setLoadingPorts(true);
    try {
      const ports: PortInfo[] = await getRpc().request.listPorts({});
      setAvailablePorts(ports);
    } catch {
      toast.error("Failed to list serial ports");
    } finally {
      setLoadingPorts(false);
    }
  }, [setAvailablePorts]);

  // Load settings + refresh ports on mount
  useEffect(() => {
    getRpc()
      .request.getSettings({})
      .then((settings) => {
        if (settings.selectedPort) setSelectedPort(settings.selectedPort);
      })
      .catch(() => {});
    void refreshPorts();
  }, [refreshPorts, setSelectedPort]);

  // Auto-ping whenever the port becomes connected to populate the config card
  useEffect(() => {
    if (connectedPort) void sendPing();
  }, [connectedPort, sendPing]);

  const handleConnect = async () => {
    if (!selectedPort) return;
    setConnecting(true);
    try {
      await getRpc().request.openPort({ path: selectedPort });
      setConnectedPort(selectedPort);
      await getRpc().request.saveSetting({ key: "selectedPort", value: selectedPort });
      toast.success(`Connected to ${selectedPort}`);
    } catch {
      toast.error(`Failed to connect to ${selectedPort}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setConnecting(true);
    try {
      await getRpc().request.closePort({});
      setConnectedPort("");
      toast.success("Disconnected");
    } catch {
      toast.error("Failed to disconnect");
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="max-w-lg space-y-8">
      {/* Serial port */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Serial Port</h2>
        <div className="flex items-center gap-2">
          <Select value={selectedPort} onValueChange={setSelectedPort}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select port…" />
            </SelectTrigger>
            <SelectContent>
              {filteredPorts.length === 0 ? (
                <SelectItem value="__none" disabled>
                  {availablePorts.length === 0 ? "No ports found" : "No ESP/USB ports found"}
                </SelectItem>
              ) : (
                filteredPorts.map((p) => (
                  <SelectItem key={p.path} value={p.path}>
                    {p.path}
                    {p.manufacturer ? ` — ${p.manufacturer}` : ""}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            onClick={refreshPorts}
            disabled={loadingPorts}
            aria-label="Refresh ports"
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              strokeWidth={2}
              className={loadingPorts ? "animate-spin" : ""}
            />
          </Button>
          {connectedPort ? (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDisconnect}
              disabled={connecting}
            >
              <HugeiconsIcon icon={Unlink04Icon} strokeWidth={2} />
              Disconnect
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={!selectedPort || connecting}
            >
              <HugeiconsIcon icon={LinkSquare02Icon} strokeWidth={2} />
              Connect
            </Button>
          )}
        </div>
        {/* Show-all filter toggle */}
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={showAllPorts}
            onChange={(e) => setShowAllPorts(e.target.checked)}
            className="rounded border-input accent-primary"
          />
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <HugeiconsIcon icon={FilterIcon} size={12} strokeWidth={2} />
            Show all ports
          </span>
        </label>
        {connectedPort && (
          <p className="text-xs text-green-600 dark:text-green-400">
            Connected: {connectedPort}
          </p>
        )}
      </section>

      {/* Device config */}
      {connectedPort && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Device Config</h2>
            <Button variant="ghost" size="icon" onClick={sendPing} disabled={pinging} aria-label="Refresh ESP config">
              <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className={pinging ? "animate-spin" : ""} />
            </Button>
          </div>
          {lastPongConfig
            ? <PongConfigDisplay config={lastPongConfig} />
            : <p className="text-xs text-muted-foreground">{pinging ? "Fetching config…" : "No config yet — click refresh"}</p>
          }
        </section>
      )}
    </div>
  );
}

function PongConfigDisplay({ config }: { config: EspPongConfig }) {
  const rows: [string, string][] = [
    ["Speed limit",      `${config.maxSpeed} km/h`],
    ["Flash delay",      `${config.flashDelay} ms`],
    ["Flash duration",   `${config.flashDuration} ms`],
    ["Sensor distance",  `${config.sensorDistance} mm`],
    ["Debug output",     config.debugEnabled ? "On" : "Off"],
  ];
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-1.5">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2">
        ESP Config
      </p>
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between text-xs">
          <span className="text-muted-foreground">{label}</span>
          <span className="font-mono">{value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Camera HW Tab ────────────────────────────────────────────────────────────

function CameraHwTab() {
  const [platform, setPlatform] = useState<string | null>(null);
  const [cameras, setCameras] = useState<CameraInfo[]>([]);
  const [selectedCamId, setSelectedCamId] = useState<number | null>(null);
  const [controls, setControls] = useState<HwControl[]>([]);
  const [localValues, setLocalValues] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<Record<string, boolean>>({});

  useEffect(() => {
    getRpc()
      .request.getPlatform({})
      .then((p) => {
        setPlatform(p);
        if (p === "linux") {
          return getRpc().request.getAvailableCameras({});
        }
        return [];
      })
      .then((cams: CameraInfo[]) => {
        setCameras(cams);
        if (cams.length > 0) {
          setSelectedCamId(cams[0].id);
        }
      })
      .catch(() => toast.error("Failed to load camera hardware info"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedCamId === null) return;
    setLoading(true);
    getRpc()
      .request.getAvailableHwControls({ cameraId: selectedCamId })
      .then((ctrls) => {
        setControls(ctrls);
        const vals: Record<string, number> = {};
        for (const c of ctrls) vals[c.name] = c.value;
        setLocalValues(vals);
      })
      .catch(() => toast.error("Failed to load camera controls"))
      .finally(() => setLoading(false));
  }, [selectedCamId]);

  const handleSetControl = async (name: string, value: number) => {
    if (selectedCamId === null) return;
    setSaving((prev) => ({ ...prev, [name]: true }));
    try {
      await getRpc().request.setHwControl({ cameraId: selectedCamId, name, value });
      setLocalValues((prev) => ({ ...prev, [name]: value }));
    } catch {
      toast.error(`Failed to set ${name}`);
    } finally {
      setSaving((prev) => ({ ...prev, [name]: false }));
    }
  };

  const handleReset = async () => {
    if (selectedCamId === null) return;
    try {
      await getRpc().request.resetHwControls({ cameraId: selectedCamId });
      // Reload controls to get default values
      const ctrls = await getRpc().request.getAvailableHwControls({ cameraId: selectedCamId });
      setControls(ctrls);
      const vals: Record<string, number> = {};
      for (const c of ctrls) vals[c.name] = c.value;
      setLocalValues(vals);
      toast.success("Controls reset to defaults");
    } catch {
      toast.error("Failed to reset controls");
    }
  };

  if (loading) {
    return (
      <div className="max-w-lg space-y-5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-4 w-12 rounded" />
            </div>
            <Skeleton className="h-4 w-full rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (platform !== "linux") {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 text-center">
        <p className="text-muted-foreground text-sm">
          Camera hardware controls (v4l2) are only available on Linux.
        </p>
        <p className="text-xs text-muted-foreground/60">
          Current platform: <code className="font-mono">{platform ?? "unknown"}</code>
        </p>
      </div>
    );
  }

  if (cameras.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No v4l2 cameras detected.</p>
    );
  }

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Select
          value={selectedCamId !== null ? String(selectedCamId) : undefined}
          onValueChange={(v) => setSelectedCamId(Number(v))}
        >
          <SelectTrigger className="w-52">
            <SelectValue placeholder="Select camera" />
          </SelectTrigger>
          <SelectContent>
            {cameras.map((cam) => (
              <SelectItem key={cam.id} value={String(cam.id)}>
                {cam.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" size="sm" onClick={handleReset}>
          Reset to defaults
        </Button>
      </div>

      {controls.length === 0 ? (
        <p className="text-sm text-muted-foreground">No controls available for this camera.</p>
      ) : (
        <div className="grid gap-5">
          {controls.map((ctrl) => (
            <HwControlRow
              key={ctrl.name}
              control={ctrl}
              currentValue={localValues[ctrl.name] ?? ctrl.value}
              saving={!!saving[ctrl.name]}
              onChange={(val) => handleSetControl(ctrl.name, val)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface HwControlRowProps {
  control: HwControl;
  currentValue: number;
  saving: boolean;
  onChange: (value: number) => void;
}

function HwControlRow({ control, currentValue, saving, onChange }: HwControlRowProps) {
  const [draft, setDraft] = useState(currentValue);

  useEffect(() => {
    setDraft(currentValue);
  }, [currentValue]);

  if (control.type === "bool") {
    return (
      <div className="flex items-center justify-between gap-4">
        <label className="text-sm font-medium capitalize">
          {control.name.replace(/_/g, " ")}
        </label>
        <Button
          variant={draft ? "default" : "outline"}
          size="sm"
          disabled={saving}
          onClick={() => {
            const next = draft ? 0 : 1;
            setDraft(next);
            onChange(next);
          }}
        >
          {draft ? "On" : "Off"}
        </Button>
      </div>
    );
  }

  const min = control.min ?? 0;
  const max = control.max ?? 100;
  const step = control.step ?? 1;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-sm font-medium capitalize">
          {control.name.replace(/_/g, " ")}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-muted-foreground w-10 text-right">
            {draft}
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={saving || draft === currentValue}
            onClick={() => onChange(draft)}
          >
            {saving ? "…" : "Apply"}
          </Button>
        </div>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[draft]}
        onValueChange={([v]) => setDraft(v)}
        onValueCommit={([v]) => onChange(v)}
      />
      <div className="flex justify-between text-xs text-muted-foreground/60">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

// ─── Speed Camera Tab ─────────────────────────────────────────────────────────

const SPEED_CAMERA_FIELDS: Array<{
  key: keyof AppSettings;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
}> = [
  { key: "flashDelay", label: "Flash Delay", unit: "ms", min: 0, max: 1000, step: 10 },
  { key: "flashDuration", label: "Flash Duration", unit: "ms", min: 0, max: 500, step: 5 },
  { key: "pictureDelay", label: "Picture Delay", unit: "ms", min: 0, max: 1000, step: 10 },
  { key: "maxSpeed", label: "Max Speed", unit: "km/h", min: 1, max: 200, step: 1 },
];

// Keys that are synced to the ESP and therefore populated from the pong config
const ESP_SYNCED_KEYS = new Set<keyof AppSettings>(["maxSpeed", "flashDelay", "flashDuration"]);

const SERIAL_SYNC: Partial<Record<keyof AppSettings, string>> = {
  maxSpeed: "setMaxSpeed",
  flashDelay: "setFlashDelay",
  flashDuration: "setFlashDuration",
};

function SpeedCameraTab() {
  const setMaxSpeedInStore = useAppStore((s) => s.setMaxSpeed);
  const setPictureDelayInStore = useAppStore((s) => s.setPictureDelay);
  const connectedPort = useAppStore((s) => s.connectedPort);
  const lastPongConfig = useAppStore((s) => s.lastPongConfig);

  const [values, setValues] = useState<Partial<AppSettings>>({});
  const [saved, setSaved] = useState<Partial<AppSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [calibOpen, setCalibOpen] = useState(false);

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

  // When a pong config arrives (on connect or manual refresh), merge the ESP-sourced
  // values into both values and saved so sliders reflect actual device state.
  useEffect(() => {
    if (!lastPongConfig) return;
    const patch: Partial<AppSettings> = {
      maxSpeed: lastPongConfig.maxSpeed,
      flashDelay: lastPongConfig.flashDelay,
      flashDuration: lastPongConfig.flashDuration,
    };
    setValues((prev) => ({ ...prev, ...patch }));
    setSaved((prev) => ({ ...prev, ...patch }));
  }, [lastPongConfig]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      // Reload host-side settings (pictureDelay etc.)
      await loadFromDb();
      // Ping the ESP so pong config arrives and the useEffect above merges it in
      if (connectedPort) {
        await getRpc().request.sendCommand({ json: JSON.stringify({ command: "ping" }) });
      }
    } catch {
      toast.error("Failed to refresh settings");
    } finally {
      setRefreshing(false);
    }
  }, [loadFromDb, connectedPort]);

  const isDirty = SPEED_CAMERA_FIELDS.some(({ key }) => values[key] !== saved[key]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        SPEED_CAMERA_FIELDS.map(({ key }) =>
          getRpc().request.saveSetting({ key, value: String(values[key]) })
        )
      );

      // Sync changed values to the ESP over serial
      await Promise.all(
        SPEED_CAMERA_FIELDS
          .filter(({ key }) => values[key] !== saved[key] && key in SERIAL_SYNC)
          .map(({ key }) =>
            getRpc().request.sendCommand({
              json: JSON.stringify({ command: SERIAL_SYNC[key], value: values[key] }),
            })
          )
      );

      setSaved({ ...values });
      if (values.maxSpeed !== undefined) setMaxSpeedInStore(values.maxSpeed);
      if (values.pictureDelay !== undefined) setPictureDelayInStore(values.pictureDelay);
      toast.success("Settings saved");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
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

  const saveDisabledReason = !connectedPort
    ? "Connect to the ESP before saving"
    : !isDirty
    ? undefined
    : undefined;

  return (
    <div className="max-w-lg space-y-6">
      {/* Header row with refresh button */}
      <div className="flex items-center justify-between -mb-2">
        <p className="text-xs text-muted-foreground">
          {connectedPort
            ? lastPongConfig
              ? "Values synced from device"
              : "Connect to device to sync values"
            : <span className="text-amber-500 dark:text-amber-400">Serial not connected — save disabled</span>
          }
        </p>
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
              onValueChange={([v]) =>
                setValues((prev) => ({ ...prev, [key]: v }))
              }
            />
            <div className="flex justify-between text-xs text-muted-foreground/60">
              <span>{min} {unit}</span>
              <span>{max} {unit}</span>
            </div>
          </div>
        );
      })}

      <div className="flex items-center justify-end gap-2 pt-2">
        <Button variant="outline" onClick={() => setCalibOpen(true)}>
          Auto-Calibrate
        </Button>
        <Button
          onClick={handleSave}
          disabled={!isDirty || saving || !connectedPort}
          title={saveDisabledReason}
        >
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>

      <CalibrationWizard
        open={calibOpen}
        onOpenChange={(open) => {
          setCalibOpen(open);
          if (!open) {
            // Reload settings after wizard closes so sliders reflect any applied values
            loadFromDb().catch(() => {});
          }
        }}
      />
    </div>
  );
}

// ─── Lap Timer Tab ────────────────────────────────────────────────────────────

function LapTimerTab() {
  const lapSettings = useAppStore((s) => s.lapSettings);
  const updateLapSetting = useAppStore((s) => s.updateLapSetting);
  const [saving, setSaving] = useState<string | null>(null);

  const handleUpdate = async (key: keyof AppSettings, value: string) => {
    setSaving(key);
    try {
      await updateLapSetting(key, value);
    } catch {
      toast.error("Failed to save setting");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="max-w-lg space-y-8">
      {/* Lap Mode */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Lap Mode</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Single: one lap per session cycle, resets to waiting after each lap.
            Multi: continuous recording until stopped.
          </p>
        </div>
        <Select
          value={lapSettings.lapMode}
          onValueChange={(v) => handleUpdate("lapMode", v)}
          disabled={saving === "lapMode"}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="single">Single lap</SelectItem>
            <SelectItem value="multi">Multi-lap</SelectItem>
          </SelectContent>
        </Select>
      </section>

      {/* Flash settings */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Flash</h2>
        <ToggleSetting
          label="Flash on session start (first car)"
          description="Trigger the flash when the first car passes at the start of a lap."
          checked={lapSettings.flashOnStart}
          disabled={saving === "lapFlashOnStart"}
          onChange={(v) => handleUpdate("lapFlashOnStart", v ? "true" : "false")}
        />
        <ToggleSetting
          label="Flash on lap end"
          description="Trigger the flash when a lap is completed."
          checked={lapSettings.flashOnLapEnd}
          disabled={saving === "lapFlashOnLapEnd"}
          onChange={(v) => handleUpdate("lapFlashOnLapEnd", v ? "true" : "false")}
        />
      </section>

      {/* Image capture */}
      <section className="space-y-4">
        <h2 className="text-sm font-semibold">Image Capture</h2>
        <ToggleSetting
          label="Save images"
          description="Capture and save a photo at the start and end of each lap."
          checked={lapSettings.saveImages}
          disabled={saving === "lapSaveImages"}
          onChange={(v) => handleUpdate("lapSaveImages", v ? "true" : "false")}
        />
      </section>
    </div>
  );
}

interface ToggleSettingProps {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

function ToggleSetting({ label, description, checked, disabled, onChange }: ToggleSettingProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="flex-1 space-y-0.5">
        <label className="text-sm font-medium">{label}</label>
        {description && (
          <p className="text-xs text-muted-foreground">{description}</p>
        )}
      </div>
      <Button
        variant={checked ? "default" : "outline"}
        size="sm"
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className="shrink-0 w-12"
      >
        {checked ? "On" : "Off"}
      </Button>
    </div>
  );
}
