import { z } from "zod";

export const predictionQuerySchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}),
  query: z.object({
    deviceId: z.coerce.number().int().positive().optional(),
    status: z.enum(["pending", "confirmed", "false_positive"]).optional(),
  }),
});

export const predictionIdSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  query: z.object({}),
});
