import { z } from "zod";
import type { CameraInfo, HwControl } from "../shared/types";

// ─── Platform detection ───────────────────────────────────────────────────────

export const IS_LINUX = process.platform === "linux";

// ─── Zod schemas ─────────────────────────────────────────────────────────────

const HwControlTypeSchema = z.enum(["int", "bool", "menu"]);

const HwControlSchema = z.object({
  name: z.string(),
  type: HwControlTypeSchema,
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  default: z.number(),
  value: z.number(),
  flags: z.string().optional(),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function runV4l2Ctl(args: string[]): Promise<string> {
  const proc = Bun.spawn(["v4l2-ctl", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`v4l2-ctl ${args.join(" ")} exited ${exitCode}: ${stderr.trim()}`);
  }

  return stdout;
}

/**
 * Parse the output of `v4l2-ctl --list-ctrls` or `--all` into HwControl[].
 * Lines look like:
 *   brightness 0x00980900 (int) : min=0 max=255 step=1 default=128 value=128
 */
function parseControls(raw: string): HwControl[] {
  const controls: HwControl[] = [];

  for (const line of raw.split("\n")) {
    const match = line.match(
      /^\s*(\w+)\s+0x[\da-fA-F]+\s+\((\w+)\)\s*:\s*(.+)$/
    );
    if (!match) continue;

    const [, name, type, propsStr] = match;

    const getNum = (key: string): number | undefined => {
      const m = propsStr.match(new RegExp(`\\b${key}=([-\\d]+)`));
      return m ? Number(m[1]) : undefined;
    };

    const flagsMatch = propsStr.match(/flags=(.+)$/);

    const parsed = HwControlSchema.safeParse({
      name,
      type,
      min: getNum("min"),
      max: getNum("max"),
      step: getNum("step"),
      default: getNum("default"),
      value: getNum("value"),
      flags: flagsMatch?.[1]?.trim(),
    });

    if (parsed.success) {
      controls.push(parsed.data);
    }
  }

  return controls;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * List all V4L2 cameras that expose at least one hardware control.
 * Returns an empty array on non-Linux platforms.
 */
export async function getAvailableCameras(): Promise<CameraInfo[]> {
  if (!IS_LINUX) return [];

  let stdout: string;
  try {
    stdout = await runV4l2Ctl(["--list-devices"]);
  } catch {
    return [];
  }

  // Parse device blocks separated by blank lines
  const candidates: CameraInfo[] = [];
  for (const block of stdout.split("\n\n")) {
    const lines = block.split("\n").filter((l) => l.trim() !== "");
    if (lines.length < 2) continue;

    const name = lines[0].trim().replace(/:$/, "");
    // Pick the first /dev/videoN path in the block
    const devMatch = lines.find((l) => /\/dev\/video\d+/.test(l))?.match(/\/dev\/video(\d+)/);
    if (!devMatch) continue;

    candidates.push({ id: Number(devMatch[1]), name });
  }

  // Filter: only cameras that expose hardware controls
  const results = await Promise.allSettled(
    candidates.map(async (cam) => {
      const controls = await getAvailableHwControls(cam.id);
      return controls.length > 0 ? cam : null;
    })
  );

  return results
    .filter(
      (r): r is PromiseFulfilledResult<CameraInfo> =>
        r.status === "fulfilled" && r.value !== null
    )
    .map((r) => r.value);
}

/**
 * List the hardware controls for a specific camera (by v4l2 device number).
 * Returns an empty array on non-Linux platforms.
 */
export async function getAvailableHwControls(cameraId: number): Promise<HwControl[]> {
  if (!IS_LINUX) return [];

  try {
    const stdout = await runV4l2Ctl(["-d", String(cameraId), "--list-ctrls"]);
    return parseControls(stdout);
  } catch {
    return [];
  }
}

/**
 * Set a single hardware control value.
 */
export async function setHwControl(
  cameraId: number,
  name: string,
  value: number
): Promise<void> {
  if (!IS_LINUX) return;
  await runV4l2Ctl(["-d", String(cameraId), "-c", `${name}=${value}`]);
}

/**
 * Reset all hardware controls for a camera to their defaults.
 */
export async function resetHwControls(cameraId: number): Promise<void> {
  if (!IS_LINUX) return;

  const controls = await getAvailableHwControls(cameraId);
  await Promise.allSettled(
    controls.map((ctrl) =>
      runV4l2Ctl(["-d", String(cameraId), "-c", `${ctrl.name}=${ctrl.default}`])
    )
  );
}
