import { useState } from "react";
import { toast } from "sonner";
import { useLapStore } from "../store";
import type { AppSettings } from "@/shared/types";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function LapTimerSettingsTab() {
  const lapSettings = useLapStore((s) => s.lapSettings);
  const updateLapSetting = useLapStore((s) => s.updateLapSetting);
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
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
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
