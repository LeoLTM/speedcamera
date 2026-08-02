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
import type { AppSettings, PortInfo, HwControl, EspPongConfig } from "@/shared/types";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  RefreshIcon,
  LinkSquare02Icon,
  Unlink04Icon,
  FilterIcon,
} from "@hugeicons/core-free-icons";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, CheckCircle2, XCircle, Upload } from "lucide-react";

import { FirmwareFlasher } from "@/components/FirmwareFlasher";

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
          {(["device", "camera", "speed-camera", "lap-timer"] as const).map((tab) => (
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
                : tab === "camera"
                ? "Camera"
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
        <TabsPrimitive.Content value="camera" className="flex-1 overflow-y-auto p-6">
          <CameraTab />
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

      {/* Firmware update */}
      <FirmwareFlasher />
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


function CameraTab() {
  const connected = useAppStore((s) => s.cameraConnected);
  const vendor = useAppStore((s) => s.cameraVendor);
  const model = useAppStore((s) => s.cameraModel);
  const serial = useAppStore((s) => s.cameraSerial);
  
  const connectCamera = useAppStore((s) => s.connectCamera);
  const disconnectCamera = useAppStore((s) => s.disconnectCamera);
  const applyMfsConfig = useAppStore((s) => s.applyMfsConfig);
  const clearMfsResult = useAppStore((s) => s.clearMfsResult);
  const mfsResult = useAppStore((s) => s.mfsResult);
  const setCameraFeature = useAppStore((s) => s.setCameraFeature);

  const exposure = useAppStore((s) => s.cameraExposure);
  const gain = useAppStore((s) => s.cameraGain);
  const pixelFormat = useAppStore((s) => s.pixelFormat);
  const exposureAuto = useAppStore((s) => s.exposureAuto);
  const gainAuto = useAppStore((s) => s.gainAuto);
  const frameRate = useAppStore((s) => s.frameRate);
  const cameraWidth = useAppStore((s) => s.cameraWidth);
  const cameraHeight = useAppStore((s) => s.cameraHeight);
  const blackLevel = useAppStore((s) => s.blackLevel);
  const strobeLineDuration = useAppStore((s) => s.strobeLineDuration);

  const [saveAsDefault, setSaveAsDefault] = useState(true);
  const [mfsLoading, setMfsLoading] = useState(false);

  const handleMfsUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setMfsLoading(true);
    clearMfsResult();
    try {
      const text = await file.text();
      await applyMfsConfig(text, saveAsDefault);
    } catch {
      toast.error("Failed to apply config file");
    } finally {
      setMfsLoading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="max-w-lg space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold">Industrial Camera</h2>
          {connected ? (
            <p className="text-xs text-muted-foreground mt-0.5">
              Connected to {vendor} {model} ({serial})
            </p>
          ) : (
            <p className="text-xs text-muted-foreground mt-0.5">
              No camera connected.
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={connectCamera} disabled={connected}>
            Connect
          </Button>
          <Button variant="outline" size="sm" onClick={disconnectCamera} disabled={!connected}>
            Disconnect
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold border-b pb-2">Load .mfs Config</h3>
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Checkbox id="saveAsDefault" checked={saveAsDefault} onCheckedChange={(c) => setSaveAsDefault(!!c)} />
            <Label htmlFor="saveAsDefault">Save as default (persist to camera NVRAM)</Label>
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" className="cursor-pointer" disabled={!connected || mfsLoading}>
              <label>
                <Upload className="mr-2 h-4 w-4" />
                {mfsLoading ? "Applying..." : "Select & Apply .mfs File"}
                <input type="file" accept=".mfs" className="hidden" onChange={handleMfsUpload} disabled={!connected || mfsLoading} />
              </label>
            </Button>
          </div>

          {mfsResult && (
            <div className="space-y-2 mt-4 text-sm">
              <Collapsible className="rounded-md border px-4 py-2">
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-500" />
                    <span>Applied Features</span>
                    <Badge variant="secondary">{mfsResult.applied.length}</Badge>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 text-xs text-muted-foreground">
                  <div className="max-h-40 overflow-y-auto space-y-1 bg-muted/50 p-2 rounded">
                    {mfsResult.applied.map(f => <div key={f}>{f}</div>)}
                    {mfsResult.applied.length === 0 && <div>No features applied</div>}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible className="rounded-md border px-4 py-2">
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-destructive" />
                    <span>Failed Features</span>
                    <Badge variant={mfsResult.failed.length > 0 ? "destructive" : "secondary"}>{mfsResult.failed.length}</Badge>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 text-xs text-muted-foreground">
                  <div className="max-h-40 overflow-y-auto space-y-1 bg-muted/50 p-2 rounded">
                    {mfsResult.failed.map(f => <div key={f}>{f}</div>)}
                    {mfsResult.failed.length === 0 && <div>No failures</div>}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            </div>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <h3 className="text-sm font-semibold border-b pb-2">Camera Settings</h3>
        <div className="grid gap-5">
          <div className="space-y-2">
            <Label className="text-sm font-medium">Pixel Format</Label>
            <Select value={pixelFormat} onValueChange={(v) => setCameraFeature("pixelFormat", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select Pixel Format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Mono">Mono (Mono8)</SelectItem>
                <SelectItem value="Color">Color (RGB8)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-sm font-medium">Exposure Auto</Label>
            <Select value={exposureAuto} onValueChange={(v) => setCameraFeature("exposureAuto", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select Exposure Auto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Off">Off</SelectItem>
                <SelectItem value="Once">Once</SelectItem>
                <SelectItem value="Continuous">Continuous</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <HwControlRow
            control={{ name: "ExposureTime", type: "int", min: 10, max: 200000, step: 100, default: 5000, value: exposure }}
            currentValue={exposure}
            saving={false}
            onChange={(v) => setCameraFeature("cameraExposure", v)}
          />

          <div className="space-y-2">
            <Label className="text-sm font-medium">Gain Auto</Label>
            <Select value={gainAuto} onValueChange={(v) => setCameraFeature("gainAuto", v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select Gain Auto" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Off">Off</SelectItem>
                <SelectItem value="Once">Once</SelectItem>
                <SelectItem value="Continuous">Continuous</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <HwControlRow
            control={{ name: "Gain", type: "int", min: 0, max: 24, step: 1, default: 0, value: gain }}
            currentValue={gain}
            saving={false}
            onChange={(v) => setCameraFeature("cameraGain", v)}
          />

          <HwControlRow
            control={{ name: "Frame Rate", type: "int", min: 1, max: 120, step: 1, default: 30, value: frameRate }}
            currentValue={frameRate}
            saving={false}
            onChange={(v) => setCameraFeature("frameRate", v)}
          />

          <HwControlRow
            control={{ name: "Width", type: "int", min: 16, max: 4096, step: 8, default: 1280, value: cameraWidth }}
            currentValue={cameraWidth}
            saving={false}
            onChange={(v) => setCameraFeature("cameraWidth", v)}
          />

          <HwControlRow
            control={{ name: "Height", type: "int", min: 16, max: 4096, step: 8, default: 1024, value: cameraHeight }}
            currentValue={cameraHeight}
            saving={false}
            onChange={(v) => setCameraFeature("cameraHeight", v)}
          />

          <HwControlRow
            control={{ name: "Black Level", type: "int", min: 0, max: 4095, step: 1, default: 0, value: blackLevel }}
            currentValue={blackLevel}
            saving={false}
            onChange={(v) => setCameraFeature("blackLevel", v)}
          />

          <HwControlRow
            control={{ name: "Strobe Duration", type: "int", min: 100, max: 50000, step: 100, default: 5000, value: strobeLineDuration }}
            currentValue={strobeLineDuration}
            saving={false}
            onChange={(v) => setCameraFeature("strobeLineDuration", v)}
          />

        </div>
      </div>
    </div>
  );
}

interface HwControlRowProps {
  control: HwControl;
  currentValue: number;
  saving: boolean;
  onChange: (value: number) => Promise<void> | void;
}

function HwControlRow({ control, currentValue, saving, onChange }: HwControlRowProps) {
  const [draft, setDraft] = useState(currentValue);
  const [showCheck, setShowCheck] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  useEffect(() => {
    setDraft(currentValue);
  }, [currentValue]);

  const handleApply = async (value: number) => {
    setIsApplying(true);
    try {
      await onChange(value);
      setShowCheck(true);
      setTimeout(() => setShowCheck(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setIsApplying(false);
    }
  };

  const isBusy = saving || isApplying;

  if (control.type === "bool") {
    return (
      <div className="flex items-center justify-between gap-4">
        <label className="text-sm font-medium capitalize flex items-center gap-2">
          {control.name.replace(/_/g, " ")}
          {showCheck && <CheckCircle2 className="h-4 w-4 text-green-500 animate-in fade-in" />}
        </label>
        <Button
          variant={draft ? "default" : "outline"}
          size="sm"
          disabled={isBusy}
          onClick={() => {
            const next = draft ? 0 : 1;
            setDraft(next);
            handleApply(next);
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
        <label className="text-sm font-medium capitalize flex items-center gap-2">
          {control.name.replace(/_/g, " ")}
          {showCheck && <CheckCircle2 className="h-4 w-4 text-green-500 animate-in fade-in" />}
        </label>
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-muted-foreground w-10 text-right">
            {draft}
          </span>
          <Button
            size="xs"
            variant="outline"
            disabled={isBusy || draft === currentValue}
            onClick={() => handleApply(draft)}
          >
            {isBusy ? "…" : "Apply"}
          </Button>
        </div>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={[draft]}
        onValueChange={([v]) => setDraft(v)}
        onValueCommit={([v]) => handleApply(v)}
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
  { key: "maxSpeed", label: "Max Speed", unit: "km/h", min: 1, max: 200, step: 1 },
  { key: "strobeLineDuration", label: "Strobe Duration", unit: "ms", min: 10, max: 20000, step: 10 },
];

// Keys that are synced to the ESP and therefore populated from the pong config
const ESP_SYNCED_KEYS = new Set<keyof AppSettings>(["maxSpeed"]);

const SERIAL_SYNC: Partial<Record<keyof AppSettings, string>> = {
  maxSpeed: "setMaxSpeed",
};

function SpeedCameraTab() {
  const setMaxSpeedInStore = useAppStore((s) => s.setMaxSpeed);
  const connectedPort = useAppStore((s) => s.connectedPort);
  const lastPongConfig = useAppStore((s) => s.lastPongConfig);

  const [values, setValues] = useState<Partial<AppSettings>>({});
  const [saved, setSaved] = useState<Partial<AppSettings>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
        <Button
          onClick={handleSave}
          disabled={!isDirty || saving || !connectedPort}
          title={saveDisabledReason}
        >
          {saving ? "Saving…" : "Save Settings"}
        </Button>
      </div>
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

      {/* Direction filter */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold">Direction Filter</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Which direction a car must pass the sensors to start or end a lap.
            Use this when cars always travel the same way past the device.
          </p>
        </div>
        <Select
          value={lapSettings.dirFilter}
          onValueChange={(v) => handleUpdate("lapDirFilter", v)}
          disabled={saving === "lapDirFilter"}
        >
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="both">Both directions</SelectItem>
            <SelectItem value="forward">Forward only (sensor 1 → sensor 2)</SelectItem>
            <SelectItem value="reverse">Reverse only (sensor 2 → sensor 1)</SelectItem>
          </SelectContent>
        </Select>
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
