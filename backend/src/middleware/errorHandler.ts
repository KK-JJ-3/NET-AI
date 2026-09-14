import type { ErrorRequestHandler, RequestHandler } from "express";
import { sendError } from "../utils/apiResponse.js";

export const notFoundHandler: RequestHandler = (_req, res) => {
  return sendError(res, "Route not found", 404);
};

export const errorHandler: ErrorRequestHandler = (
  error,
  _req,
  res,
  _next
) => {
  console.error("Unhandled server error:", error);

  return sendError(res, "Internal server error", 500);
};
