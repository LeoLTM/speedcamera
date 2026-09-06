import { pluginRegistry } from "./registry";
import { lapTimerPlugin } from "./laptimer";
import { alignmentPlugin } from "./alignment";

// ponytail: register default plugins. Core imports only this registry.
pluginRegistry.register(lapTimerPlugin);
pluginRegistry.register(alignmentPlugin);

export { pluginRegistry };
export * from "./types";
