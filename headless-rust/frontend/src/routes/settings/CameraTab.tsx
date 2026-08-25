import { useState } from "react";
import type { ChangeEvent } from "react";
import { toast } from "sonner";
import { useAppStore } from "@/stores/useAppStore";
import type { HwControl } from "@/shared/types";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Upload, CheckCircle2, XCircle, ChevronDown } from "lucide-react";

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
