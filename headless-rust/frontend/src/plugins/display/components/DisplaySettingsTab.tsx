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
import { Monitor, Cpu, Cable, Sparkles } from "lucide-react";

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
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold tracking-tight flex items-center gap-2">
            <Monitor className="w-5 h-5 text-primary" />
            OLED Monochrome Display (SSD1306)
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure the Raspberry Pi 5 I²C OLED screen, live telemetry layouts, and power modes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={status?.connected ? "default" : "secondary"} className="text-xs font-mono">
            {status?.connected ? "I²C Connected" : "Mock / Virtual"}
          </Badge>
          <Badge variant="outline" className="text-xs font-mono">
            {config.enabled ? "Power: ON" : "Power: OFF"}
          </Badge>
        </div>
      </div>

      {/* Live Screen Preview */}
      <DisplayPreview />

      {/* Raspberry Pi 5 Physical Pinout Guide */}
      <Card className="border-border/60 bg-muted/20">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Cable className="w-4 h-4 text-emerald-400" />
            Raspberry Pi 5 GPIO Pinout Connection Guide
          </CardTitle>
          <CardDescription className="text-xs">
            Connect your 4-pin I²C SSD1306 OLED module to the Raspberry Pi 5 40-pin GPIO header:
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs font-mono">
            <div className="p-2.5 rounded-lg border border-border bg-card">
              <span className="text-[10px] text-muted-foreground block">OLED PIN</span>
              <span className="font-bold text-rose-400">VCC</span>
              <span className="text-[11px] text-foreground/80 block mt-1">Pin 1 (3.3V Power)</span>
            </div>
            <div className="p-2.5 rounded-lg border border-border bg-card">
              <span className="text-[10px] text-muted-foreground block">OLED PIN</span>
              <span className="font-bold text-neutral-400">GND</span>
              <span className="text-[11px] text-foreground/80 block mt-1">Pin 6 or 9 (Ground)</span>
            </div>
            <div className="p-2.5 rounded-lg border border-border bg-card">
              <span className="text-[10px] text-muted-foreground block">OLED PIN</span>
              <span className="font-bold text-cyan-400">SDA</span>
              <span className="text-[11px] text-foreground/80 block mt-1">Pin 3 (GPIO 2 / I2C1 SDA)</span>
            </div>
            <div className="p-2.5 rounded-lg border border-border bg-card">
              <span className="text-[10px] text-muted-foreground block">OLED PIN</span>
              <span className="font-bold text-amber-400">SCL</span>
              <span className="text-[11px] text-foreground/80 block mt-1">Pin 5 (GPIO 3 / I2C1 SCL)</span>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-2 font-mono">
            Linux bus: <span className="text-primary">{config.i2cBus}</span> • Address:{" "}
            <span className="text-primary">0x{config.i2cAddress.toString(16).toUpperCase()}</span> (3.3V logic level)
          </p>
        </CardContent>
      </Card>

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
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label className="text-xs font-semibold">Display Power</Label>
              <p className="text-xs text-muted-foreground">
                Turn the OLED panel on or sleep the controller hardware.
              </p>
            </div>
            <Switch
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
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs">Show Entry &amp; Exit Speeds</Label>
                <p className="text-xs text-muted-foreground">
                  Display speed at start and finish line alongside lap time.
                </p>
              </div>
              <Switch
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
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-xs">Visual Beam Graphic</Label>
                <p className="text-xs text-muted-foreground">
                  Display dual live Sick sensor barrier status blocks and lock indicator.
                </p>
              </div>
              <Badge variant="outline" className="text-[10px] font-mono">
                Active
              </Badge>
            </div>
          </section>
        </CardContent>
      </Card>
    </div>
  );
}
