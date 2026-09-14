import type { Response } from "express";

function serializeForJson<T>(data: T): T {
  return JSON.parse(
    JSON.stringify(data, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  ) as T;
}

export function sendSuccess<T>(
  res: Response,
  data: T,
  statusCode = 200,
): Response {
  return res.status(statusCode).json({
    data: serializeForJson(data),
    error: null,
  });
}

export function sendError(
  res: Response,
  message: string,
  statusCode = 500,
): Response {
  return res.status(statusCode).json({
    data: null,
    error: message,
  });
}
