import { useAppStore } from "@/stores/useAppStore";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Step1IntroProps {
  onNext: () => void;
}

interface ChecklistItemProps {
  label: string;
  met: boolean;
  detail?: string;
}

function ChecklistItem({ label, met, detail }: ChecklistItemProps) {
  return (
    <div className="flex items-start gap-3">
      <div
        className={cn(
          "mt-0.5 w-5 h-5 rounded-full flex items-center justify-center shrink-0 text-xs",
          met
            ? "bg-green-500/20 text-green-600 dark:text-green-400"
            : "bg-muted text-muted-foreground",
        )}
      >
        {met ? (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        )}
      </div>
      <div>
        <p className={cn("text-sm font-medium", met ? "text-foreground" : "text-muted-foreground")}>
          {label}
        </p>
        {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

export function Step1Intro({ onNext }: Step1IntroProps) {
  const cameraStream = useAppStore((s) => s.cameraStream);
  const connectedPort = useAppStore((s) => s.connectedPort);

  const cameraReady = cameraStream !== null;
  const serialReady = connectedPort !== "";
  const canStart = cameraReady && serialReady;

  return (
    <div className="space-y-6">
      {/* Description */}
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground leading-relaxed">
          This wizard finds the optimal{" "}
          <span className="font-medium text-foreground">Flash Duration</span> and{" "}
          <span className="font-medium text-foreground">Picture Delay</span> for your camera and
          flash setup. It will:
        </p>
        <ol className="text-sm text-muted-foreground space-y-1.5 list-none pl-0">
          {[
            "Position the flash in view of the camera",
            "Fire a test flash to detect its colour",
            "Sweep 16 parameter combinations automatically",
            "Show you the best result to apply",
          ].map((item, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="shrink-0 w-5 h-5 rounded-full bg-muted flex items-center justify-center text-xs font-semibold text-muted-foreground">
                {i + 1}
              </span>
              <span className="mt-0.5">{item}</span>
            </li>
          ))}
        </ol>
      </div>

      {/* Requirements */}
      <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Requirements
        </p>
        <ChecklistItem
          label="Camera connected"
          met={cameraReady}
          detail={cameraReady ? undefined : "Start the camera feed before running calibration"}
        />
        <ChecklistItem
          label="Serial (ESP32) connected"
          met={serialReady}
          detail={
            serialReady
              ? `Port: ${connectedPort}`
              : "Connect to a serial port in the Device settings tab"
          }
        />
      </div>

      {/* Estimated time */}
      <p className="text-xs text-muted-foreground">
        Estimated sweep time: <span className="font-medium">20-35 seconds</span>
      </p>

      <Button onClick={onNext} disabled={!canStart} className="w-full">
        Start Calibration →
      </Button>

      {!canStart && (
        <p className="text-xs text-center text-muted-foreground">
          Meet all requirements above to continue
        </p>
      )}
    </div>
  );
}
