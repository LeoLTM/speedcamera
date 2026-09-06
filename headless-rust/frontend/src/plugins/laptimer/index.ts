import { createRoute } from "@tanstack/react-router";
import { Timer01Icon } from "@hugeicons/core-free-icons";
import type { UiPlugin } from "../types";
import { useLapStore } from "./store";
import { LapTimerSidePanel } from "./components/LapTimerSidePanel";
import { LapTimerSettingsTab } from "./components/LapTimerSettingsTab";
import { LapsPage } from "./routes/LapsPage";

export const lapTimerPlugin: UiPlugin = {
  id: "laptimer",
  name: "Lap Timer",

  navItems: [
    { label: "Laps", to: "/laps" },
  ],

  mode: {
    id: "laptimer",
    label: "Laps",
    icon: Timer01Icon,
  },

  homeSidePanel: LapTimerSidePanel,

  settingsTabs: [
    {
      id: "lap-timer",
      label: "Lap Timer",
      component: LapTimerSettingsTab,
    },
  ],

  getRoutes: (rootRoute) => [
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/laps",
      component: LapsPage,
    }),
  ],

  onSerialStatus: (payload) => {
    if (
      payload.status === "LAPSTART" ||
      payload.status === "LAPEND" ||
      payload.status === "LAPWAITING" ||
      payload.status === "LAPSTOPPED"
    ) {
      useLapStore.getState().handleSerialStatusForLap(payload);
      return true;
    }
    return false;
  },

  init: () => {
    void useLapStore.getState().loadLapSettings();
  },
};
