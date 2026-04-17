import { z } from "zod";

export const CameraHwControlTypeSchema = z.enum(["int", "bool", "menu"]);
export type CameraHwControlType = z.infer<typeof CameraHwControlTypeSchema>;

export const CameraHwControlSchema = z.object({
  name: z.string(),
  type: CameraHwControlTypeSchema,
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  default: z.number(),
  value: z.number(),
  flags: z.string().optional(),
});

export type CameraHwControl = z.infer<typeof CameraHwControlSchema>;

/**
 * Parses raw v4l2-ctl --list-ctrls output into CameraHwControl[].
 * Merges all control sections (User Controls, Camera Controls, etc.) into one array.
 */
export function parseV4l2CtlOutput(raw: string): CameraHwControl[] {
  const controls: CameraHwControl[] = [];

  for (const line of raw.split("\n")) {
    // Match control lines: <name> <hex_id> (<type>) : <key=value pairs...>
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

    const result = CameraHwControlSchema.safeParse({
      name,
      type,
      min: getNum("min"),
      max: getNum("max"),
      step: getNum("step"),
      default: getNum("default"),
      value: getNum("value"),
      flags: flagsMatch?.[1]?.trim(),
    });

    if (result.success) {
      controls.push(result.data);
    }
  }

  return controls;
}
