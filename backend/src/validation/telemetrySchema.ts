import { z } from "zod";

export const telemetrySchema = z.object({
  body: z.object({
    deviceId: z.number().int().positive(),
    interfaceId: z.number().int().positive().nullable().optional(),
    recordedAt: z.coerce.date(),
    latencyMs: z.number().min(0),
    packetLossPct: z.number().min(0).max(100),
    jitterMs: z.number().min(0),
    utilizationPct: z.number().min(0).max(100),
    cpuPct: z.number().min(0).max(100),
    memoryPct: z.number().min(0).max(100),
    availability: z.boolean(),
    scenarioLabel: z.enum(["normal", "congestion", "device_failure"]),
  }),
  params: z.object({}),
  query: z.object({}),
});

export const telemetryHistorySchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  query: z.object({
    range: z.enum(["1h", "6h", "24h"]).default("1h"),
  }),
});
