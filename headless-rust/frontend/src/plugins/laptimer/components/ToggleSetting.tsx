import { Button } from "@/components/ui/button";

interface ToggleSettingProps {
  label: string;
  description?: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}

export function ToggleSetting({ label, description, checked, disabled, onChange }: ToggleSettingProps) {
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
