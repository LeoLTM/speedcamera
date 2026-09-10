import { useState, useEffect, useRef, useCallback } from "react";
import { toast } from "sonner";
import { getRpc } from "@/lib/rpc";
import type { SystemNetworkSummary, WifiScanResult } from "@/shared/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Wifi,
  WifiOff,
  Lock,
  Unlock,
  RefreshCw,
  Router,
  Cable,
  Globe,
  Radio,
  Eye,
  EyeOff,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  SignalHigh,
  SignalMedium,
  SignalLow,
  Plus,
} from "lucide-react";
import { WifiConnectDialog } from "@/components/WifiConnectDialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function NetworkTab() {
  const [network, setNetwork] = useState<SystemNetworkSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [networks, setNetworks] = useState<WifiScanResult[]>([]);

  // Selected Network for inline connection
  const [expandedSsid, setExpandedSsid] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // Manual Network Entry
  const [showManual, setShowManual] = useState(false);
  const [manualSsid, setManualSsid] = useState("");
  const [manualPassword, setManualPassword] = useState("");

  // Dialogs
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [connectDialogData, setConnectDialogData] = useState<{
    ssid: string;
    password?: string;
    security?: string;
    assignedIp?: string | null;
  }>({ ssid: "" });
  const [forgetDialogOpen, setForgetDialogOpen] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [switchingEth, setSwitchingEth] = useState(false);

  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchNetworkSummary = useCallback(async () => {
    try {
      const summary = await getRpc().request.getNetworkInfo({});
      setNetwork(summary);
    } catch (e) {
      console.error("Failed to fetch network summary", e);
    }
  }, []);

  const scanWifi = useCallback(async (isSilent = false) => {
    if (!isSilent) setScanning(true);
    try {
      const list = await getRpc().request.scanWifiNetworks({});
      setNetworks(list);
      if (!isSilent && list.length > 0) {
        toast.success(`Found ${list.length} Wi-Fi networks`);
      }
    } catch {
      if (!isSilent) toast.error("Failed to scan Wi-Fi networks");
    } finally {
      if (!isSilent) setScanning(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchNetworkSummary(), scanWifi(true)]).finally(() => setLoading(false));

    // Auto-rescan every 12 seconds
    scanIntervalRef.current = setInterval(() => {
      scanWifi(true);
      fetchNetworkSummary();
    }, 12000);

    // Listen to real-time network state machine transitions
    const unbind = (getRpc() as any).on?.("networkStatusChanged", () => {
      fetchNetworkSummary();
    });

    return () => {
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
      if (unbind) unbind();
    };
  }, [fetchNetworkSummary, scanWifi]);

  const handleConnect = async (targetSsid: string, targetPass: string, targetSec?: string) => {
    if (!targetSsid.trim()) {
      toast.error("Please enter a valid SSID");
      return;
    }

    setConnecting(true);
    setConnectDialogData({
      ssid: targetSsid,
      password: targetPass,
      security: targetSec,
    });
    setConnectDialogOpen(true);

    try {
      const res = await getRpc().request.applyNetworkMode({
        mode: "client",
        ssid: targetSsid.trim(),
        password: targetPass || undefined,
      });

      if (res.success) {
        toast.success(res.message);
        setTimeout(async () => {
          await fetchNetworkSummary();
        }, 4000);
      } else {
        toast.error(res.message || "Failed to connect to network");
      }
    } catch (err: any) {
      toast.error(err?.message || "Error applying Wi-Fi settings");
    } finally {
      setConnecting(false);
    }
  };

  const handleForgetWifi = async () => {
    setForgetting(true);
    try {
      const res = await getRpc().request.forgetWifi({});
      if (res.success) {
        toast.success("Wi-Fi credentials removed. AP Setup Hotspot started.");
        setForgetDialogOpen(false);
        setExpandedSsid(null);
        setPassword("");
        setTimeout(fetchNetworkSummary, 3000);
      } else {
        toast.error(res.message || "Failed to reset network");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to reset network");
    } finally {
      setForgetting(false);
    }
  };

  const handleToggleEthernetMode = async () => {
    if (!network) return;
    const isCameraLan = network.ethernetMode === "camera-lan" || network.cameraLan.status === "ok";
    const targetMode = isCameraLan ? "lan-dhcp" : "camera-lan";

    setSwitchingEth(true);
    try {
      const res = await getRpc().request.setEthernetMode({ mode: targetMode });
      if (res.success) {
        toast.success(res.message);
        setTimeout(fetchNetworkSummary, 3000);
      } else {
        toast.error(res.message || "Failed to change Ethernet configuration");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to change Ethernet configuration");
    } finally {
      setSwitchingEth(false);
    }
  };

  const isApMode = network?.wifiMode === "ap" || network?.mode === "ap" || network?.mode === "field";
  const isClientMode = network?.wifiMode === "client" || network?.mode === "wifi-client" || network?.mode === "client";
  const isConnecting = network?.networkState === "connecting" || network?.networkState === "reconnecting";
  const isFallbackAp = network?.networkState === "fallback_ap";
  const isEthernetCameraLan = network?.ethernetMode === "camera-lan" || network?.cameraLan.status === "ok";

  const getSignalIcon = (signal: number) => {
    if (signal >= 70) return <SignalHigh className="w-4 h-4 text-emerald-500" />;
    if (signal >= 40) return <SignalMedium className="w-4 h-4 text-amber-500" />;
    return <SignalLow className="w-4 h-4 text-rose-500" />;
  };

  return (
    <div className="max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold tracking-tight">Network & Wi-Fi Management</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure standalone AP hotspot onboarding and client Wi-Fi connectivity.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              fetchNetworkSummary();
              scanWifi(false);
            }}
            disabled={scanning || loading}
            className="h-8 gap-1.5 text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${scanning ? "animate-spin" : ""}`} />
            <span>{scanning ? "Scanning..." : "Rescan"}</span>
          </Button>
        </div>
      </div>

      {/* Live Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {/* Wireless Status Card */}
        <div className="p-4 rounded-xl border border-border bg-card shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                {isApMode ? <Router className="w-4 h-4" /> : <Wifi className="w-4 h-4" />}
              </div>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Wireless Interface
              </span>
            </div>
            {isConnecting ? (
              <Badge variant="outline" className="text-amber-500 border-amber-500/30 text-[11px] gap-1 py-0.5">
                <RefreshCw className="w-3 h-3 animate-spin" />
                {network?.networkState === "reconnecting" ? "Reconnecting" : "Connecting"} ({network?.retryAttempt || 1}/{network?.maxAttempts || 6})
              </Badge>
            ) : isFallbackAp ? (
              <Badge variant="outline" className="text-purple-500 border-purple-500/30 text-[11px] gap-1 py-0.5">
                <Radio className="w-3 h-3 animate-pulse" />
                Fallback AP Active
              </Badge>
            ) : isApMode ? (
              <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 text-[11px] gap-1 py-0.5">
                <Radio className="w-3 h-3 animate-pulse" />
                AP Setup Hotspot
              </Badge>
            ) : isClientMode ? (
              <Badge variant="outline" className="text-sky-500 border-sky-500/30 text-[11px] gap-1 py-0.5">
                <CheckCircle2 className="w-3 h-3" />
                Client Connected
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-[11px] py-0.5">
                Disconnected
              </Badge>
            )}
          </div>

          <div className="space-y-1.5 text-xs font-mono">
            {isConnecting ? (
              <>
                <div className="flex justify-between py-0.5 border-b border-border/50">
                  <span className="text-muted-foreground font-sans">Target SSID:</span>
                  <span className="font-semibold text-foreground">{network?.wifiClient?.ssid || "External Wi-Fi"}</span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-border/50">
                  <span className="text-muted-foreground font-sans">Attempt:</span>
                  <span className="text-amber-500 font-semibold">{network?.retryAttempt || 1} of {network?.maxAttempts || 6}</span>
                </div>
                {network?.timeToNextAction != null && network.timeToNextAction > 0 && (
                  <div className="flex justify-between py-0.5 border-b border-border/50">
                    <span className="text-muted-foreground font-sans">Fallback AP in:</span>
                    <span className="text-amber-500 font-semibold">{network.timeToNextAction}s</span>
                  </div>
                )}
              </>
            ) : isFallbackAp ? (
              <>
                <div className="flex justify-between py-0.5 border-b border-border/50">
                  <span className="text-muted-foreground font-sans">Fallback SSID:</span>
                  <span className="font-semibold text-foreground">speedcamera (Open)</span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-border/50">
                  <span className="text-muted-foreground font-sans">Static IP:</span>
                  <span className="text-primary font-semibold">192.168.4.1</span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-border/50">
                  <span className="text-muted-foreground font-sans">Connected Devices:</span>
                  <span className="font-semibold">{network?.connectedStations ?? 0} client(s)</span>
                </div>
                {network?.timeToNextAction != null && network.timeToNextAction > 0 && !network?.connectedStations && (
                  <div className="flex justify-between py-0.5 border-b border-border/50">
                    <span className="text-muted-foreground font-sans">Auto-Reconnect:</span>
                    <span className="text-muted-foreground">Probe in {network.timeToNextAction}s</span>
                  </div>
                )}
              </>
            ) : isClientMode && network?.wifiClient ? (
              <>
                <div className="flex justify-between py-0.5 border-b border-border/50">
                  <span className="text-muted-foreground font-sans">SSID:</span>
                  <span className="font-semibold text-foreground">{network.wifiClient.ssid || "Unknown"}</span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-border/50">
                  <span className="text-muted-foreground font-sans">IP Address:</span>
                  <span className="text-primary font-semibold">{network.wifiClient.ip || "Waiting DHCP..."}</span>
                </div>
                {network.wifiClient.gateway && (
                  <div className="flex justify-between py-0.5 border-b border-border/50">
                    <span className="text-muted-foreground font-sans">Gateway:</span>
                    <span>{network.wifiClient.gateway}</span>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex justify-between py-0.5 border-b border-border/50">
                  <span className="text-muted-foreground font-sans">Hotspot SSID:</span>
                  <span className="font-semibold text-foreground">speedcamera (Open)</span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-border/50">
                  <span className="text-muted-foreground font-sans">Static IP:</span>
                  <span className="text-primary font-semibold">{network?.hotspotAp.ip || "192.168.4.1"}</span>
                </div>
                <div className="flex justify-between py-0.5 border-b border-border/50">
                  <span className="text-muted-foreground font-sans">Band / Channel:</span>
                  <span>5 GHz • Channel 36</span>
                </div>
              </>
            )}

            {network?.wifiMac && (
              <div className="flex justify-between py-0.5">
                <span className="text-muted-foreground font-sans">Wi-Fi MAC:</span>
                <span className="text-[11px] text-muted-foreground">{network.wifiMac}</span>
              </div>
            )}
          </div>

          {isClientMode && (
            <div className="pt-1">
              <Button
                variant="outline"
                size="xs"
                className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30 gap-1.5 h-7"
                onClick={() => setForgetDialogOpen(true)}
              >
                <RotateCcw className="w-3 h-3" />
                Forget Network & Return to AP Mode
              </Button>
            </div>
          )}
        </div>

        {/* Ethernet LAN Status Card */}
        <div className="p-4 rounded-xl border border-border bg-card shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-lg bg-primary/10 text-primary">
                <Cable className="w-4 h-4" />
              </div>
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Ethernet Interface
              </span>
            </div>
            {isEthernetCameraLan ? (
              <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 text-[11px] py-0.5">
                Camera LAN
              </Badge>
            ) : (
              <Badge variant="outline" className="text-sky-500 border-sky-500/30 text-[11px] py-0.5">
                Standard DHCP
              </Badge>
            )}
          </div>

          <div className="space-y-1.5 text-xs font-mono">
            <div className="flex justify-between py-0.5 border-b border-border/50">
              <span className="text-muted-foreground font-sans">Interface:</span>
              <span className="font-semibold text-foreground">
                {network?.cameraLan.interfaceName || "eth0"}
              </span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-border/50">
              <span className="text-muted-foreground font-sans">IP Address:</span>
              <span className="font-semibold text-foreground">
                {network?.cameraLan.ip || "Unassigned"}
              </span>
            </div>
            <div className="flex justify-between py-0.5 border-b border-border/50">
              <span className="text-muted-foreground font-sans">Config:</span>
              <span>
                {isEthernetCameraLan ? "Static 192.168.1.100 (MTU 9000)" : "Auto DHCP (Internet/Updates)"}
              </span>
            </div>
            {network?.ethernetMac && (
              <div className="flex justify-between py-0.5">
                <span className="text-muted-foreground font-sans">Ethernet MAC:</span>
                <span className="text-[11px] text-muted-foreground">{network.ethernetMac}</span>
              </div>
            )}
          </div>

          <div className="pt-1">
            <Button
              variant="outline"
              size="xs"
              className="w-full gap-1.5 h-7 text-xs"
              onClick={handleToggleEthernetMode}
              disabled={switchingEth}
            >
              {isEthernetCameraLan ? (
                <>
                  <Globe className="w-3 h-3" />
                  {switchingEth ? "Switching..." : "Switch to DHCP (Wired Internet)"}
                </>
              ) : (
                <>
                  <Cable className="w-3 h-3" />
                  {switchingEth ? "Switching..." : "Switch to Camera LAN (192.168.1.100)"}
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Available Wi-Fi Networks */}
      <div className="space-y-3">
        <div className="flex items-center justify-between border-b pb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold">Available Wi-Fi Networks</h3>
            <Badge variant="secondary" className="text-xs">
              {networks.length}
            </Badge>
          </div>
          <Button
            variant="ghost"
            size="xs"
            onClick={() => setShowManual(!showManual)}
            className="text-xs text-primary gap-1"
          >
            <Plus className="w-3 h-3" />
            {showManual ? "Hide Manual" : "Add Hidden Network"}
          </Button>
        </div>

        {/* Manual Hidden Network Form */}
        {showManual && (
          <div className="p-4 rounded-lg border border-border bg-muted/20 space-y-3 animate-in fade-in">
            <div className="text-xs font-semibold">Connect to Hidden Network</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs">Network Name (SSID)</Label>
                <Input
                  className="h-8 text-xs font-mono"
                  placeholder="e.g. CorporateWiFi"
                  value={manualSsid}
                  onChange={(e) => setManualSsid(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Password</Label>
                <Input
                  type="password"
                  className="h-8 text-xs"
                  placeholder="Network password"
                  value={manualPassword}
                  onChange={(e) => setManualPassword(e.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={() => handleConnect(manualSsid, manualPassword, "WPA2")}
                disabled={connecting || !manualSsid.trim()}
              >
                Connect to Hidden Network
              </Button>
            </div>
          </div>
        )}

        {/* Networks List */}
        <div className="rounded-xl border border-border overflow-hidden divide-y divide-border bg-card">
          {networks.length === 0 ? (
            <div className="p-8 text-center space-y-2">
              <WifiOff className="w-8 h-8 text-muted-foreground mx-auto" />
              <p className="text-xs font-medium text-muted-foreground">
                {scanning ? "Scanning for nearby networks..." : "No Wi-Fi networks found."}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => scanWifi(false)}
                className="text-xs h-7 mt-2"
              >
                Scan Again
              </Button>
            </div>
          ) : (
            networks.map((net) => {
              const isExpanded = expandedSsid === net.ssid;
              const isConnected = net.inUse || (isClientMode && network?.wifiClient?.ssid === net.ssid);
              const isSecured = net.security && net.security !== "Open";

              return (
                <div key={`${net.ssid}-${net.bssid || ""}`} className="transition-colors">
                  {/* Network Header Row */}
                  <div
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedSsid(null);
                      } else {
                        setExpandedSsid(net.ssid);
                        setPassword("");
                      }
                    }}
                    className={`flex items-center justify-between p-3.5 cursor-pointer hover:bg-accent/40 transition-colors ${
                      isConnected ? "bg-primary/5" : ""
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="p-1.5 rounded-md bg-muted/80 shrink-0">
                        {isSecured ? (
                          <Lock className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <Unlock className="w-4 h-4 text-emerald-500" />
                        )}
                      </div>

                      <div className="min-w-0 space-y-0.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground truncate">
                            {net.ssid}
                          </span>
                          {isConnected && (
                            <Badge variant="outline" className="text-emerald-500 border-emerald-500/30 text-[10px] py-0">
                              Active
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>{net.security}</span>
                          {net.channel ? <span>• Ch {net.channel}</span> : null}
                          {net.bssid ? <span className="font-mono text-[10px] opacity-70">({net.bssid})</span> : null}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <div className="flex items-center gap-1.5 text-xs font-mono text-muted-foreground">
                        {getSignalIcon(net.signal)}
                        <span>{net.signal}%</span>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="w-4 h-4 text-muted-foreground" />
                      )}
                    </div>
                  </div>

                  {/* Expanded Connect Form */}
                  {isExpanded && (
                    <div className="p-4 bg-muted/30 border-t border-border space-y-3 animate-in fade-in">
                      {isConnected ? (
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-emerald-500 font-medium flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4" />
                            Connected to this network.
                          </span>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-destructive border-destructive/30 hover:bg-destructive/10"
                            onClick={() => setForgetDialogOpen(true)}
                          >
                            Forget
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {isSecured ? (
                            <div className="space-y-1.5">
                              <Label className="text-xs font-medium">Wi-Fi Password</Label>
                              <div className="relative">
                                <Input
                                  type={showPassword ? "text" : "password"}
                                  className="h-8 text-xs pr-9"
                                  placeholder="Enter password..."
                                  value={password}
                                  onChange={(e) => setPassword(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      handleConnect(net.ssid, password, net.security);
                                    }
                                  }}
                                  autoFocus
                                />
                                <button
                                  type="button"
                                  onClick={() => setShowPassword(!showPassword)}
                                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                                >
                                  {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              This is an open network. No password required.
                            </p>
                          )}

                          <div className="flex justify-end gap-2 pt-1">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => setExpandedSsid(null)}
                            >
                              Cancel
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => handleConnect(net.ssid, password, net.security)}
                              disabled={connecting}
                            >
                              {connecting ? "Connecting..." : "Connect"}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* QR Code & Connect Guidance Modal */}
      <WifiConnectDialog
        open={connectDialogOpen}
        onOpenChange={setConnectDialogOpen}
        ssid={connectDialogData.ssid}
        password={connectDialogData.password}
        security={connectDialogData.security}
        connecting={connecting}
        assignedIp={network?.wifiClient?.ip}
      />

      {/* Confirmation Dialog: Forget Network & Return to AP Mode */}
      <Dialog open={forgetDialogOpen} onOpenChange={setForgetDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="space-y-2">
            <div className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="w-5 h-5" />
              <DialogTitle className="text-base">Reset Wi-Fi Connection?</DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              This will remove all saved Wi-Fi credentials and immediately revert the Raspberry Pi to the standalone
              open <strong>speedcamera</strong> Setup Hotspot.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="gap-2 sm:gap-0 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setForgetDialogOpen(false)}
              disabled={forgetting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleForgetWifi}
              disabled={forgetting}
            >
              {forgetting ? "Resetting..." : "Forget & Switch to AP Mode"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
