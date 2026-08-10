import { join, dirname } from "path";
import { existsSync } from "fs";

function resolveAravisPath(): string | undefined {
  const binDir = dirname(process.execPath || process.argv[0] || "");
  const candidates = [
    // Standard system paths
    "/usr/lib/aarch64-linux-gnu/libaravis-0.8.so",
    "/usr/lib/x86_64-linux-gnu/libaravis-0.8.so",
    "/usr/local/lib/libaravis-0.8.so",
    "/usr/lib/libaravis-0.8.so",
    // Development / project layout
    join(import.meta.dir, "..", "..", "vendor", "libaravis-0.8.so"),
    join(import.meta.dir, "..", "vendor", "libaravis-0.8.so"),
    join(process.cwd(), "vendor", "libaravis-0.8.so"),
    join(process.cwd(), "resources", "libaravis-0.8.so"),
    join(binDir, "libaravis-0.8.so"),
  ];
  return candidates.find((p) => existsSync(p));
}

const libPath = resolveAravisPath();
if (libPath) {
  console.log(`[entry] Setting BUN_ARAVIS_LIB_PATH to ${libPath}`);
  process.env.BUN_ARAVIS_LIB_PATH = libPath;
} else {
  console.log(`[entry] libaravis-0.8.so not found in bundled paths, falling back to system dynamic linker`);
}
