import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { getRpc } from "@/lib/rpc";
import { useAppStore } from "@/stores/useAppStore";
import type { PortInfo, EspPongConfig } from "@/shared/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  RefreshIcon,
  LinkSquare02Icon,
  Unlink04Icon,
  FilterIcon,
} from "@hugeicons/core-free-icons";
import { FirmwareFlasher } from "@/components/FirmwareFlasher";

export function DeviceTab() {
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

  useEffect(() => {
    getRpc()
      .request.getSettings({})
      .then((settings) => {
        if (settings.selectedPort) setSelectedPort(settings.selectedPort);
      })
      .catch(() => {});
    void refreshPorts();
  }, [refreshPorts, setSelectedPort]);

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

      {connectedPort && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold">Device Config</h2>
            <Button
              variant="ghost"
              size="icon"
              onClick={sendPing}
              disabled={pinging}
              aria-label="Refresh ESP config"
            >
              <HugeiconsIcon icon={RefreshIcon} strokeWidth={2} className={pinging ? "animate-spin" : ""} />
            </Button>
          </div>
          {lastPongConfig ? (
            <PongConfigDisplay config={lastPongConfig} />
          ) : (
            <p className="text-xs text-muted-foreground">
              {pinging ? "Fetching config…" : "No config yet — click refresh"}
            </p>
          )}
        </section>
      )}

      <FirmwareFlasher />
    </div>
  );
}

function PongConfigDisplay({ config }: { config: EspPongConfig }) {
  const rows: [string, string][] = [
    ["Speed limit", `${config.maxSpeed} km/h`],
    ["Flash delay", `${config.flashDelay} ms`],
    ["Flash duration", `${config.flashDuration} ms`],
    ["Sensor distance", `${config.sensorDistance} mm`],
    ["Debug output", config.debugEnabled ? "On" : "Off"],
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
