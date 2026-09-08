import { pluginRegistry } from "./registry";
import { lapTimerPlugin } from "./laptimer";
import { alignmentPlugin } from "./alignment";
import { displayPlugin } from "./display";

// ponytail: register default plugins. Core imports only this registry.
pluginRegistry.register(lapTimerPlugin);
pluginRegistry.register(alignmentPlugin);
pluginRegistry.register(displayPlugin);

export { pluginRegistry };
export * from "./types";
