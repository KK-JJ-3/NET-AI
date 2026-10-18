import { z } from "zod";

export const faultQuerySchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}),
  query: z.object({
    deviceId: z.coerce.number().int().positive().optional(),
    status: z.enum(["predicted", "confirmed", "resolved"]).optional(),
  }),
});

export const faultIdSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  query: z.object({}),
});

export const createFaultSchema = z.object({
  body: z.object({
    deviceId: z.number().int().positive(),
    faultType: z.enum(["congestion", "device_failure"]),
    severity: z.enum(["low", "medium", "high", "critical"]),
    startedAt: z.string().datetime({ offset: true }),
    resolvedAt: z.string().datetime({ offset: true }).nullable().optional(),
  }),
  params: z.object({}),
  query: z.object({}),
});
