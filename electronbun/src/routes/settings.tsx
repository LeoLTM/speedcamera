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
import type { AppSettings, PortInfo, HwControl, CameraInfo } from "@/shared/types";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  RefreshIcon,
  LinkSquare02Icon,
  Unlink04Icon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";

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
          {(["device", "camera-hw", "speed-camera"] as const).map((tab) => (
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
              {tab === "device" ? "Device" : tab === "camera-hw" ? "Camera HW" : "Speed Camera"}
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
  const availableCameras = useAppStore((s) => s.availableCameras);
  const setAvailableCameras = useAppStore((s) => s.setAvailableCameras);
  const selectedCameraDeviceId = useAppStore((s) => s.selectedCameraDeviceId);
  const setSelectedCameraDeviceId = useAppStore((s) => s.setSelectedCameraDeviceId);

  const [loadingPorts, setLoadingPorts] = useState(false);
  const [loadingCameras, setLoadingCameras] = useState(false);
  const [connecting, setConnecting] = useState(false);

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

  const refreshCameras = useCallback(async () => {
    setLoadingCameras(true);
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      // Filter out entries with empty deviceId — these appear before the user
      // grants camera permission and would crash <Select.Item value="">.
      const videoCameras = devices.filter((d) => d.kind === "videoinput" && d.deviceId !== "");
      setAvailableCameras(videoCameras);
    } catch {
      toast.error("Failed to list cameras");
    } finally {
      setLoadingCameras(false);
    }
  }, [setAvailableCameras]);

  // Load settings + refresh on mount
  useEffect(() => {
    getRpc()
      .request.getSettings({})
      .then((settings) => {
        if (settings.selectedPort) setSelectedPort(settings.selectedPort);
        if (settings.selectedCamera) setSelectedCameraDeviceId(settings.selectedCamera);
      })
      .catch(() => {});
    void refreshPorts();
    void refreshCameras();
  }, [refreshPorts, refreshCameras, setSelectedPort, setSelectedCameraDeviceId]);

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

  const handleCameraChange = async (deviceId: string) => {
    setSelectedCameraDeviceId(deviceId);
    try {
      await getRpc().request.saveSetting({ key: "selectedCamera", value: deviceId });
    } catch {
      toast.error("Failed to save camera setting");
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
              {availablePorts.length === 0 ? (
                <SelectItem value="__none" disabled>
                  No ports found
                </SelectItem>
              ) : (
                availablePorts.map((p) => (
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
        {connectedPort && (
          <p className="text-xs text-green-600 dark:text-green-400">
            Connected: {connectedPort}
          </p>
        )}
      </section>

      {/* Camera */}
      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Camera</h2>
        <div className="flex items-center gap-2">
          <Select value={selectedCameraDeviceId} onValueChange={handleCameraChange}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select camera…" />
            </SelectTrigger>
            <SelectContent>
              {availableCameras.length === 0 ? (
                <SelectItem value="__none" disabled>
                  No cameras found
                </SelectItem>
              ) : (
                availableCameras.map((cam) => (
                  <SelectItem key={cam.deviceId} value={cam.deviceId}>
                    {cam.label || `Camera ${cam.deviceId.slice(0, 8)}`}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            onClick={refreshCameras}
            disabled={loadingCameras}
            aria-label="Refresh cameras"
          >
            <HugeiconsIcon
              icon={RefreshIcon}
              strokeWidth={2}
              className={loadingCameras ? "animate-spin" : ""}
            />
          </Button>
        </div>
      </section>
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

function SpeedCameraTab() {
  const setMaxSpeedInStore = useAppStore((s) => s.setMaxSpeed);
  const setPictureDelayInStore = useAppStore((s) => s.setPictureDelay);
  const [values, setValues] = useState<Partial<AppSettings>>({});
  const [saved, setSaved] = useState<Partial<AppSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getRpc()
      .request.getSettings({})
      .then((settings) => {
        setValues(settings);
        setSaved(settings);
      })
      .catch(() => toast.error("Failed to load settings"))
      .finally(() => setLoading(false));
  }, []);

  const isDirty = SPEED_CAMERA_FIELDS.some(
    ({ key }) => values[key] !== saved[key]
  );

  // Serial commands to sync changed values to the ESP32
  const SERIAL_SYNC: Partial<Record<keyof AppSettings, string>> = {
    maxSpeed: "setMaxSpeed",
    flashDelay: "setFlashDelay",
    flashDuration: "setFlashDuration",
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await Promise.all(
        SPEED_CAMERA_FIELDS.map(({ key }) =>
          getRpc().request.saveSetting({ key, value: String(values[key]) })
        )
      );

      // Sync changed values to the ESP32 over serial
      await Promise.all(
        SPEED_CAMERA_FIELDS
          .filter(({ key }) => values[key] !== saved[key] && key in SERIAL_SYNC)
          .map(({ key }) =>
            getRpc().request.sendCommand({
              json: JSON.stringify({ command: SERIAL_SYNC[key], value: values[key] }),
            }).catch(() => {/* not connected — silently ignore */})
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

  return (
    <div className="max-w-lg space-y-6">
      {SPEED_CAMERA_FIELDS.map(({ key, label, unit, min, max, step }) => {
        const val = (values[key] as number) ?? min;
        return (
          <div key={key} className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">{label}</label>
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
              <span>
                {min} {unit}
              </span>
              <span>
                {max} {unit}
              </span>
            </div>
          </div>
        );
      })}

      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={!isDirty || saving}>
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
    </div>
  );
}
