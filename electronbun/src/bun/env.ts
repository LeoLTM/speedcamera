import { join, dirname } from "path";
import { existsSync } from "fs";

function resolveAravisPath(): string | undefined {
  const binDir = dirname(process.execPath || process.argv[0] || "");
  const candidates = [
    // Production layout (e.g. app/bin -> app/Resources/resources/ or app/resources/)
    join(process.cwd(), "..", "Resources", "resources", "libaravis-0.8.so"),
    join(process.cwd(), "..", "resources", "libaravis-0.8.so"),
    join(binDir, "..", "Resources", "resources", "libaravis-0.8.so"),
    join(binDir, "..", "resources", "libaravis-0.8.so"),
    // Development / flat file layout
    join(import.meta.dir, "..", "resources", "libaravis-0.8.so"),
    join(import.meta.dir, "..", "..", "resources", "libaravis-0.8.so"),
    join(import.meta.dir, "..", "bin", "libaravis-0.8.so"),
    join(import.meta.dir, "libaravis-0.8.so"),
    join(process.cwd(), "vendor", "libaravis-0.8.so"),
    join(process.cwd(), "resources", "libaravis-0.8.so"),
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


