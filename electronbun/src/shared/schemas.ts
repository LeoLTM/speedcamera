import { z } from "zod";

// ─── Incoming: ESP → Host ─────────────────────────────────────────────────────

const EspSpeedingSchema = z.object({
  status: z.literal("speeding"),
  value: z.number().nonnegative().max(300),
  tolerance: z.number().nonnegative(),
  direction: z.enum(["forward", "reverse"]),
});

const EspLegalSchema = z.object({
  status: z.literal("legal"),
  value: z.number().nonnegative().max(300),
  tolerance: z.number().nonnegative(),
  direction: z.enum(["forward", "reverse"]),
});

export const EspPongConfigSchema = z.object({
  maxSpeed: z.number().positive(),
  sensorDistance: z.number().positive(),
  debugEnabled: z.boolean(),
  lapMode: z.enum(["single", "multi"]),
  lapActive: z.boolean(),
  lapAutoFlash: z.boolean().optional(),
  lapDirFilter: z.enum(["both", "forward", "reverse"]),
});

const EspPongSchema = z.object({
  status: z.literal("pong"),
  config: EspPongConfigSchema,
});

const EspConfigAckSchema = z.object({
  status: z.literal("config"),
  key: z.string(),
  value: z.number(),
});

const EspConfigErrorSchema = z.object({
  status: z.literal("configError"),
  message: z.string(),
});

// Simple statuses with no extra fields
const EspReadySchema      = z.object({ status: z.literal("ready") });
const EspMeasuringSchema  = z.object({ status: z.literal("measuring") });
const EspTimeoutSchema    = z.object({ status: z.literal("timeout") });
const EspJsonErrorSchema  = z.object({ status: z.literal("jsonError") });

// ─── Lap Timer Messages ───────────────────────────────────────────────────────

const EspLapWaitingSchema = z.object({ status: z.literal("lapWaiting") });
const EspLapStoppedSchema = z.object({ status: z.literal("lapStopped") });

const EspLapStartSchema = z.object({
  status: z.literal("lapStart"),
  lapNumber: z.number().int().positive(),
  speedAtStart: z.number().nonnegative(),
});

const EspLapEndSchema = z.object({
  status: z.literal("lapEnd"),
  lapNumber: z.number().int().positive(),
  durationMs: z.number().positive(),
  speedAtStart: z.number().nonnegative(),
  speedAtEnd: z.number().nonnegative(),
});

export const EspMessageSchema = z.discriminatedUnion("status", [
  EspSpeedingSchema,
  EspLegalSchema,
  EspPongSchema,
  EspConfigAckSchema,
  EspConfigErrorSchema,
  EspReadySchema,
  EspMeasuringSchema,
  EspTimeoutSchema,
  EspJsonErrorSchema,
  EspLapWaitingSchema,
  EspLapStoppedSchema,
  EspLapStartSchema,
  EspLapEndSchema,
]);

export type EspMessage    = z.infer<typeof EspMessageSchema>;
export type EspPongConfig = z.infer<typeof EspPongConfigSchema>;

// ─── Outgoing: Host → ESP ─────────────────────────────────────────────────────

export const EspCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("ping") }),
  z.object({ command: z.literal("setMaxSpeed"),      value: z.number().min(1).max(250) }),
  z.object({ command: z.literal("setDebug"),         value: z.union([z.literal(0), z.literal(1)]) }),
  z.object({ command: z.literal("startLapSession"),  mode: z.enum(["single", "multi"]), autoFlash: z.boolean().optional(), dirFilter: z.enum(["both", "forward", "reverse"]).optional() }),
  z.object({ command: z.literal("stopLapSession") }),
]);

export type EspCommand = z.infer<typeof EspCommandSchema>;
