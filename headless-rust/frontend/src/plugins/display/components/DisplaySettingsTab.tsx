import { useEffect } from "react";
import { useDisplayStore } from "../store";
import { DisplayPreview } from "./DisplayPreview";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Monitor, Cpu, Sparkles } from "lucide-react";

export function DisplaySettingsTab() {
  const { config, status, loading, saving, loadConfig, updateConfig, togglePower, setMode } = useDisplayStore();

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  if (loading && !config) {
    return (
      <div className="p-6 text-sm font-mono text-muted-foreground animate-pulse">
        Loading display hardware configuration...
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="max-w-3xl space-y-6">
      {/* Top Title & Quick Power Status */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-base sm:text-lg font-bold tracking-tight flex items-center gap-2">
            <Monitor className="w-5 h-5 text-primary shrink-0" />
            <span>OLED Monochrome Display (SSD1306)</span>
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure the Raspberry Pi 5 I²C OLED screen, live telemetry layouts, and power modes.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {status?.mockMode ? (
            <Badge variant="secondary" className="text-xs font-mono border-amber-500/30 text-amber-500 bg-amber-500/10">
              Mock Mode
            </Badge>
          ) : status?.connected ? (
            <Badge variant="default" className="text-xs font-mono bg-emerald-600 hover:bg-emerald-600 text-white">
              I²C Connected
            </Badge>
          ) : (
            <Badge variant="destructive" className="text-xs font-mono">
              Disconnected
            </Badge>
          )}
          <Badge variant="outline" className="text-xs font-mono">
            {config.enabled ? "Power: ON" : "Power: OFF"}
          </Badge>
        </div>
      </div>

      {/* Hardware Disconnected / Error Diagnostic Banner */}
      {!status?.connected && !status?.mockMode && (
        <div className="p-3 rounded-lg border border-rose-500/30 bg-rose-500/10 text-xs font-mono text-rose-400 flex flex-col sm:flex-row sm:items-center justify-between gap-2 break-words">
          <div>
            <span className="font-semibold">OLED Hardware: Disconnected</span>
            {status?.error && (
              <span className="block text-[11px] text-rose-300/80 mt-0.5 break-all">
                Reason: {status.error}
              </span>
            )}
          </div>
          <span className="text-[10px] text-rose-400/70 shrink-0">
            Auto-reconnecting every 2s...
          </span>
        </div>
      )}

      {/* Live Screen Preview */}
      <DisplayPreview />

      {/* Main Hardware Settings */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Cpu className="w-4 h-4 text-primary" />
            Hardware & Display Controls
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Master Power */}
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5 flex-1 min-w-0 pr-2">
              <Label className="text-xs font-semibold">Display Power</Label>
              <p className="text-xs text-muted-foreground">
                Turn the OLED panel on or sleep the controller hardware.
              </p>
            </div>
            <Switch
              className="shrink-0"
              checked={config.enabled}
              onCheckedChange={() => void togglePower()}
              disabled={saving}
            />
          </div>

          {/* Operating Mode Selector */}
          <div className="space-y-2">
            <div className="space-y-0.5">
              <Label className="text-xs font-semibold">Operating Mode</Label>
              <p className="text-xs text-muted-foreground">
                Automatic switching transitions between screens based on speedcamera events and web dashboard mode.
              </p>
            </div>
            <Select
              value={config.mode}
              onValueChange={(val) => void setMode(val)}
              disabled={saving}
            >
              <SelectTrigger className="w-full sm:w-64 font-mono text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Auto (Smart Event Switching)</SelectItem>
                <SelectItem value="speedcamera">Locked: Speed Camera</SelectItem>
                <SelectItem value="laptimer">Locked: Lap Timer</SelectItem>
                <SelectItem value="alignment">Locked: Sensor Alignment</SelectItem>
                <SelectItem value="system">Locked: System Info</SelectItem>
                <SelectItem value="off">Display Off</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Contrast / Brightness */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs font-semibold">Display Contrast / Brightness</Label>
              <span className="text-xs font-mono text-muted-foreground">{config.contrast} / 255</span>
            </div>
            <Slider
              min={10}
              max={255}
              step={5}
              value={[config.contrast]}
              onValueChange={([val]) => void updateConfig({ contrast: val })}
              disabled={saving}
            />
          </div>

          {/* Screen Rotation */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">Screen Rotation</Label>
              <Select
                value={String(config.rotation)}
                onValueChange={(val) => void updateConfig({ rotation: Number(val) })}
                disabled={saving}
              >
                <SelectTrigger className="w-full font-mono text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0° (Standard)</SelectItem>
                  <SelectItem value="90">90° (Vertical Right)</SelectItem>
                  <SelectItem value="180">180° (Inverted / Upside Down)</SelectItem>
                  <SelectItem value="270">270° (Vertical Left)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground">Useful if mounted upside-down in a 3D-printed enclosure.</p>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">I²C Bus Device</Label>
              <Input
                value={config.i2cBus}
                onChange={(e) => void updateConfig({ i2cBus: e.target.value })}
                disabled={saving}
                className="font-mono text-xs"
                placeholder="/dev/i2c-1"
              />
              <p className="text-[10px] text-muted-foreground">Default Linux I²C bus for Pi 5 GPIO pins 3 &amp; 5.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Per-Mode UI Layout Customization */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-cyan-400" />
            Mode-Specific UI Layout Options
          </CardTitle>
          <CardDescription className="text-xs">
            Fine-tune what information is rendered on the OLED display when each mode is active.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Speed Camera UI Options */}
          <section className="space-y-3 pb-4 border-b border-border/60">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Speed Camera Mode
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label className="text-xs">Speed Unit</Label>
                <Select
                  value={config.speedUi?.unit || "kmh"}
                  onValueChange={(val: any) =>
                    void updateConfig({ speedUi: { ...config.speedUi, unit: val } })
                  }
                  disabled={saving}
                >
                  <SelectTrigger className="w-full font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="kmh">Kilometers per hour (km/h)</SelectItem>
                    <SelectItem value="mph">Miles per hour (mph)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs">Layout Style</Label>
                <Select
                  value={config.speedUi?.style || "large"}
                  onValueChange={(val: any) =>
                    void updateConfig({ speedUi: { ...config.speedUi, style: val } })
                  }
                  disabled={saving}
                >
                  <SelectTrigger className="w-full font-mono text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="large">Large Digits (High Visibility)</SelectItem>
                    <SelectItem value="detailed">Detailed (With Limit &amp; Direction)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          {/* Lap Timer UI Options */}
          <section className="space-y-3 pb-4 border-b border-border/60">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Lap Timer Mode
            </h3>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5 flex-1 min-w-0 pr-2">
                <Label className="text-xs">Show Entry &amp; Exit Speeds</Label>
                <p className="text-xs text-muted-foreground">
                  Display speed at start and finish line alongside lap time.
                </p>
              </div>
              <Switch
                className="shrink-0"
                checked={config.laptimerUi?.showSpeed ?? true}
                onCheckedChange={(checked) =>
                  void updateConfig({
                    laptimerUi: { ...config.laptimerUi, showSpeed: checked },
                  })
                }
                disabled={saving}
              />
            </div>
          </section>

          {/* Alignment Mode Options */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
              Sensor Alignment Mode
            </h3>
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5 flex-1 min-w-0 pr-2">
                <Label className="text-xs">Visual Beam Graphic</Label>
                <p className="text-xs text-muted-foreground">
                  Display dual live Sick sensor barrier status blocks and lock indicator.
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                Active
              </Badge>
            </div>
          </section>
        </CardContent>
      </Card>

      {/* Compressed Wiring Reference (Footer) */}
      <details className="text-[11px] font-mono text-muted-foreground border-t border-border/40 pt-3 cursor-pointer group">
        <summary className="hover:text-foreground transition-colors select-none text-[10px] uppercase tracking-wider text-muted-foreground/70 flex items-center justify-between">
          <span>Raspberry Pi 5 GPIO Pinout Reference</span>
          <span className="text-[10px] text-muted-foreground/50 group-hover:text-muted-foreground">Click to expand</span>
        </summary>
        <div className="mt-2 p-2.5 rounded-lg bg-muted/20 border border-border/40 text-[11px] flex flex-wrap gap-x-4 gap-y-1.5 text-muted-foreground">
          <span><strong className="text-rose-400">VCC:</strong> Pin 1 (3.3V)</span>
          <span><strong className="text-neutral-400">GND:</strong> Pin 6</span>
          <span><strong className="text-cyan-400">SDA:</strong> Pin 3 (GPIO 2)</span>
          <span><strong className="text-amber-400">SCL:</strong> Pin 5 (GPIO 3)</span>
          <span className="text-muted-foreground/80 w-full sm:w-auto sm:ml-auto text-[10px]">Bus: {config.i2cBus} • Addr: 0x{config.i2cAddress.toString(16).toUpperCase()}</span>
        </div>
      </details>
    </div>
  );
}
