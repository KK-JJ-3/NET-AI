import { z } from "zod";

export const alertQuerySchema = z.object({
  body: z.object({}).optional(),
  params: z.object({}),
  query: z.object({
    acknowledged: z.coerce.boolean().optional(),
  }),
});

export const alertIdSchema = z.object({
  body: z.object({}).optional(),
  params: z.object({
    id: z.coerce.number().int().positive(),
  }),
  query: z.object({}),
});
