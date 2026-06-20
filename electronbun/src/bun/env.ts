import { join } from "path";
import { existsSync } from "fs";

function resolveAravisPath(): string | undefined {
  const candidates = [
    join(import.meta.dir, "..", "resources", "libaravis-0.8.so"),
    join(import.meta.dir, "..", "..", "resources", "libaravis-0.8.so"),
  ];
  return candidates.find((p) => existsSync(p));
}

const libPath = resolveAravisPath();
if (libPath) {
  console.log(`[entry] Setting BUN_ARAVIS_LIB_PATH to ${libPath}`);
  process.env.BUN_ARAVIS_LIB_PATH = libPath;
} else {
  console.log(`[entry] libaravis-0.8.so not found in bundled resources, falling back to system library`);
}

