import { pluginRegistry } from "./registry";
import { lapTimerPlugin } from "./laptimer";

// ponytail: register default plugins. Core imports only this registry.
pluginRegistry.register(lapTimerPlugin);

export { pluginRegistry };
export * from "./types";
