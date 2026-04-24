import { useEffect } from "react";
import { useAppStore } from "@/stores/useAppStore";

/**
 * Watches the conditions required for system operation and automatically
 * transitions between PASSIVE and DISARMED. Must be mounted once at the root.
 *
 * PASSIVE  → DISARMED : all conditions become satisfied
 * DISARMED → PASSIVE  : any condition is lost
 * ARMED    → PASSIVE  : any condition is lost (also disarms)
 */
export function useSystemStateSync() {
  const systemState = useAppStore((s) => s.systemState);
  const setSystemState = useAppStore((s) => s.setSystemState);
  const connectedPort = useAppStore((s) => s.connectedPort);
  const selectedCameraDeviceId = useAppStore((s) => s.selectedCameraDeviceId);

  const conditionsMet = !!connectedPort && !!selectedCameraDeviceId;

  useEffect(() => {
    if (conditionsMet) {
      if (systemState === "PASSIVE") {
        setSystemState("DISARMED");
      }
    } else {
      if (systemState !== "PASSIVE") {
        setSystemState("PASSIVE");
      }
    }
  }, [conditionsMet, systemState, setSystemState]);
}
