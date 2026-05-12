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
  flashDelay: z.number().nonnegative(),
  flashDuration: z.number().positive(),
  sensorDistance: z.number().positive(),
  debugEnabled: z.boolean(),
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
const EspFlashSchema      = z.object({ status: z.literal("flash") });
const EspJsonErrorSchema  = z.object({ status: z.literal("jsonError") });

export const EspMessageSchema = z.discriminatedUnion("status", [
  EspSpeedingSchema,
  EspLegalSchema,
  EspPongSchema,
  EspConfigAckSchema,
  EspConfigErrorSchema,
  EspReadySchema,
  EspMeasuringSchema,
  EspTimeoutSchema,
  EspFlashSchema,
  EspJsonErrorSchema,
]);

export type EspMessage    = z.infer<typeof EspMessageSchema>;
export type EspPongConfig = z.infer<typeof EspPongConfigSchema>;

// ─── Outgoing: Host → ESP ─────────────────────────────────────────────────────

export const EspCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("flash") }),
  z.object({ command: z.literal("ping") }),
  z.object({ command: z.literal("setMaxSpeed"),     value: z.number().min(1).max(250) }),
  z.object({ command: z.literal("setFlashDelay"),   value: z.number().min(0).max(5000) }),
  z.object({ command: z.literal("setFlashDuration"), value: z.number().min(1).max(10000) }),
  z.object({ command: z.literal("setDebug"),        value: z.union([z.literal(0), z.literal(1)]) }),
]);

export type EspCommand = z.infer<typeof EspCommandSchema>;
