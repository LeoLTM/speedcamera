import { useState, useEffect } from "react";
import type { ChangeEvent } from "react";
import { toast } from "sonner";
import { useAppStore } from "@/stores/useAppStore";
import type { HwControl, SystemNetworkSummary, WifiScanResult } from "@/shared/types";
import { getRpc } from "@/lib/rpc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Upload, CheckCircle2, XCircle, ChevronDown, Network } from "lucide-react";

export function CameraTab() {
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

  const handleMfsUpload = async (e: ChangeEvent<HTMLInputElement>) => {
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
      e.target.value = "";
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

      <NetworkStatusSection />

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
                <input
                  type="file"
                  accept=".mfs"
                  className="hidden"
                  onChange={handleMfsUpload}
                  disabled={!connected || mfsLoading}
                />
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
                    {mfsResult.applied.map((f) => (
                      <div key={f}>{f}</div>
                    ))}
                    {mfsResult.applied.length === 0 && <div>No features applied</div>}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Collapsible className="rounded-md border px-4 py-2">
                <CollapsibleTrigger className="flex w-full items-center justify-between">
                  <div className="flex items-center gap-2">
                    <XCircle className="h-4 w-4 text-destructive" />
                    <span>Failed Features</span>
                    <Badge variant={mfsResult.failed.length > 0 ? "destructive" : "secondary"}>
                      {mfsResult.failed.length}
                    </Badge>
                  </div>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2 text-xs text-muted-foreground">
                  <div className="max-h-40 overflow-y-auto space-y-1 bg-muted/50 p-2 rounded">
                    {mfsResult.failed.map((f) => (
                      <div key={f}>{f}</div>
                    ))}
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
          <span className="text-sm font-mono text-muted-foreground w-10 text-right">{draft}</span>
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

function NetworkStatusSection() {
  const [network, setNetwork] = useState<SystemNetworkSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [showConfig, setShowConfig] = useState(false);

  // Network Switcher State
  const [targetMode, setTargetMode] = useState<"field" | "wifi-client" | "dhcp">("wifi-client");
  const [scannedNetworks, setScannedNetworks] = useState<WifiScanResult[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedSsid, setSelectedSsid] = useState("");
  const [manualSsid, setManualSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [applying, setApplying] = useState(false);

  const fetchNetwork = () => {
    setLoading(true);
    getRpc()
      .request.getNetworkInfo({})
      .then(setNetwork)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const handleScanWifi = async () => {
    setScanning(true);
    try {
      const list = await getRpc().request.scanWifiNetworks({});
      setScannedNetworks(list);
      if (list.length > 0 && !selectedSsid) {
        setSelectedSsid(list[0].ssid);
      }
      toast.success(`Found ${list.length} Wi-Fi networks`);
    } catch {
      toast.error("Failed to scan Wi-Fi networks");
    } finally {
      setScanning(false);
    }
  };

  const handleApplyMode = async () => {
    setApplying(true);
    const effectiveSsid = selectedSsid === "__manual__" ? manualSsid : selectedSsid;

    if (targetMode === "wifi-client" && !effectiveSsid.trim()) {
      toast.error("Please select or enter a Wi-Fi SSID to connect.");
      setApplying(false);
      return;
    }

    try {
      const res = await getRpc().request.applyNetworkMode({
        mode: targetMode,
        ssid: effectiveSsid,
        password: wifiPassword,
      });

      if (res.success) {
        toast.success(res.message);
        if (targetMode === "field") {
          toast.info("Switched to Field Mode: Connect Wi-Fi to 'speedcamera' at http://192.168.4.1:3000");
        } else if (targetMode === "wifi-client") {
          toast.info(`Switched to Wi-Fi Client: Connected to '${effectiveSsid}'. Check router for assigned IP.`);
        }
        setTimeout(fetchNetwork, 3000);
      } else {
        toast.error(res.message);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to switch network mode");
    } finally {
      setApplying(false);
    }
  };

  useEffect(() => {
    fetchNetwork();
  }, []);

  if (!network) return null;

  const activeMode = network.mode || (network.wifiClient ? "wifi-client" : "field");

  return (
    <div className="space-y-3 rounded-lg border border-border p-4 bg-muted/20">
      <div className="flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-2">
          <Network className="h-3.5 w-3.5 text-primary" />
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Network Architecture
          </h3>
          {activeMode === "field" ? (
            <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 text-[10px] py-0">
              ⚡ Field AP Mode
            </Badge>
          ) : activeMode === "wifi-client" ? (
            <Badge variant="outline" className="text-sky-500 border-sky-500/30 text-[10px] py-0">
              📶 Wi-Fi Client Mode
            </Badge>
          ) : (
            <Badge variant="outline" className="text-amber-500 border-amber-500/30 text-[10px] py-0">
              🌐 Standard DHCP
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="xs" onClick={() => setShowConfig(!showConfig)}>
            {showConfig ? "Hide Config" : "Change Mode"}
          </Button>
          <Button variant="ghost" size="xs" onClick={fetchNetwork} disabled={loading}>
            {loading ? "…" : "Refresh"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        {/* Camera LAN */}
        <div className="p-3 rounded-md border border-border/70 bg-card space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground flex items-center gap-1.5">
              Camera LAN (eth0)
            </span>
            {network.cameraLan.status === "ok" ? (
              <Badge variant="outline" className="text-green-500 border-green-500/30 text-[10px] py-0">
                192.168.1.100 OK
              </Badge>
            ) : network.cameraLan.status === "ip_mismatch" ? (
              <Badge variant="destructive" className="text-[10px] py-0">
                {network.cameraLan.ip || "Mismatch"}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] py-0">
                Not Found
              </Badge>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground space-y-0.5 font-mono">
            <div>IP: {network.cameraLan.ip || "Unassigned"}</div>
            <div>Subnet: {network.cameraLan.subnet} (MTU 9000)</div>
          </div>
          <p className="text-[10px] text-muted-foreground/80 leading-tight pt-1 border-t border-border/40">
            Dedicated high-throughput interface for GigE Vision camera streaming.
          </p>
        </div>

        {/* Wi-Fi Interface */}
        <div className="p-3 rounded-md border border-border/70 bg-card space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-foreground">
              {network.wifiClient ? "Wi-Fi Client (wlan0)" : "Hotspot AP (wlan0)"}
            </span>
            {network.wifiClient ? (
              <Badge variant="outline" className="text-sky-500 border-sky-500/30 text-[10px] py-0">
                STA Connected
              </Badge>
            ) : network.hotspotAp.status === "ok" ? (
              <Badge variant="outline" className="text-green-500 border-green-500/30 text-[10px] py-0">
                192.168.4.1 AP
              </Badge>
            ) : network.hotspotAp.status === "ip_mismatch" ? (
              <Badge variant="outline" className="text-blue-500 border-blue-500/30 text-[10px] py-0">
                {network.hotspotAp.ip}
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[10px] py-0">
                Inactive
              </Badge>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground space-y-0.5 font-mono">
            {network.wifiClient ? (
              <>
                <div>SSID: {network.wifiClient.ssid || "Connected"}</div>
                <div>IP: {network.wifiClient.ip || "Waiting DHCP"}</div>
                {network.wifiClient.gateway && <div>Gateway: {network.wifiClient.gateway}</div>}
              </>
            ) : (
              <>
                <div>SSID: speedcamera (5GHz)</div>
                <div>IP: {network.hotspotAp.ip || "192.168.4.1"}</div>
                <div>Web UI: :3000</div>
              </>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground/80 leading-tight pt-1 border-t border-border/40">
            {network.wifiClient
              ? "Pi connected to home/lab router in Station mode (avoids AP firmware drops)."
              : "Wi-Fi access point for remote browser controller."}
          </p>
        </div>
      </div>

      {/* Mode Switcher Collapsible */}
      <Collapsible open={showConfig} onOpenChange={setShowConfig} className="border-t pt-3">
        <CollapsibleContent className="space-y-3 pt-1">
          <div className="space-y-2 bg-background/60 p-3 rounded-md border">
            <h4 className="text-xs font-semibold text-foreground">Switch Network Mode</h4>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Select an operating mode. <strong>Wi-Fi Client Mode</strong> connects the Pi to your external Wi-Fi router while keeping Camera LAN active on 192.168.1.100.
            </p>

            <div className="grid grid-cols-3 gap-2 pt-1">
              <Button
                size="xs"
                variant={targetMode === "wifi-client" ? "default" : "outline"}
                onClick={() => {
                  setTargetMode("wifi-client");
                  if (scannedNetworks.length === 0) handleScanWifi();
                }}
              >
                Wi-Fi Client Mode
              </Button>
              <Button
                size="xs"
                variant={targetMode === "field" ? "default" : "outline"}
                onClick={() => setTargetMode("field")}
              >
                Field Hotspot AP
              </Button>
              <Button
                size="xs"
                variant={targetMode === "dhcp" ? "default" : "outline"}
                onClick={() => setTargetMode("dhcp")}
              >
                Standard DHCP
              </Button>
            </div>

            {targetMode === "wifi-client" && (
              <div className="space-y-2.5 pt-2 border-t mt-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-medium">Wi-Fi Network (SSID)</Label>
                  <Button variant="ghost" size="xs" onClick={handleScanWifi} disabled={scanning}>
                    {scanning ? "Scanning…" : "Scan Networks"}
                  </Button>
                </div>

                {scannedNetworks.length > 0 ? (
                  <Select value={selectedSsid} onValueChange={setSelectedSsid}>
                    <SelectTrigger className="h-8 text-xs">
                      <SelectValue placeholder="Select visible Wi-Fi network" />
                    </SelectTrigger>
                    <SelectContent>
                      {scannedNetworks.map((net) => (
                        <SelectItem key={net.ssid} value={net.ssid} className="text-xs">
                          {net.ssid} ({net.signal}% signal {net.security !== "Open" ? `• ${net.security}` : ""})
                          {net.inUse ? " [Current]" : ""}
                        </SelectItem>
                      ))}
                      <SelectItem value="__manual__" className="text-xs font-medium text-primary">
                        + Enter SSID Manually
                      </SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    className="h-8 text-xs"
                    placeholder="e.g. MyHomeWiFi"
                    value={manualSsid}
                    onChange={(e) => setManualSsid(e.target.value)}
                  />
                )}

                {selectedSsid === "__manual__" && (
                  <Input
                    className="h-8 text-xs"
                    placeholder="Enter manual SSID"
                    value={manualSsid}
                    onChange={(e) => setManualSsid(e.target.value)}
                  />
                )}

                <div className="space-y-1">
                  <Label className="text-xs font-medium">Password (WPA/WPA2/WPA3)</Label>
                  <Input
                    type="password"
                    className="h-8 text-xs"
                    placeholder="Leave empty for open networks"
                    value={wifiPassword}
                    onChange={(e) => setWifiPassword(e.target.value)}
                  />
                </div>
              </div>
            )}

            {targetMode === "field" && (
              <div className="p-2 rounded bg-muted/40 text-[11px] text-muted-foreground space-y-1 border">
                <div>• Creates 5GHz Wi-Fi Hotspot: <strong>speedcamera</strong></div>
                <div>• Static Hotspot IP: <strong>192.168.4.1</strong></div>
                <div>• Camera LAN Static IP: <strong>192.168.1.100</strong> (Jumbo MTU 9000)</div>
              </div>
            )}

            {targetMode === "dhcp" && (
              <div className="p-2 rounded bg-muted/40 text-[11px] text-muted-foreground border">
                Resets both Ethernet and Wi-Fi interfaces to standard DHCP.
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button size="xs" variant="outline" onClick={() => setShowConfig(false)}>
                Cancel
              </Button>
              <Button size="xs" onClick={handleApplyMode} disabled={applying}>
                {applying ? "Applying…" : "Apply Network Mode"}
              </Button>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
