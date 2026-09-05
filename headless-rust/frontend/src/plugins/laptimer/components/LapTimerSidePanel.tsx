import { LapTimerDisplay } from "./LapTimerDisplay";
import { useLapStore } from "../store";

export function LapTimerSidePanel() {
  const currentLaps = useLapStore((s) => s.currentLaps);

  return (
    <LapTimerDisplay
      compact
      laps={currentLaps}
      className="flex-1 py-6"
    />
  );
}
