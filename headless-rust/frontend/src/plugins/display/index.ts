import type { UiPlugin } from "../types";
import { DisplaySettingsTab } from "./components/DisplaySettingsTab";
import { useDisplayStore } from "./store";

// ponytail: declaratively registers oled display settings and auto mode hooks
export const displayPlugin: UiPlugin = {
  id: "display",
  name: "OLED Display",

  settingsTabs: [
    {
      id: "display",
      label: "OLED Display",
      component: DisplaySettingsTab,
    },
  ],

  onModeChange: (mode: string) => {
    void useDisplayStore.getState().syncDashboardMode(mode);
  },

  init: () => {
    void useDisplayStore.getState().loadConfig();
  },
};

export * from "./types";
export * from "./store";
