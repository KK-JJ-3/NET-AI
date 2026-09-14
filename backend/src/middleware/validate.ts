import type { RequestHandler } from "express";
import { z } from "zod";
import { sendError } from "../utils/apiResponse.js";

export function validate(schema: z.ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse({
      body: req.body,
      params: req.params,
      query: req.query,
    });

    if (!result.success) {
      const message = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ");

      return sendError(res, `Validation error: ${message}`, 400);
    }

    next();
  };
}
