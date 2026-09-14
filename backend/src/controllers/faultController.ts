import type { Request, Response } from "express";

import prisma from "../config/database.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";

export async function getFaults(
  req: Request,
  res: Response,
): Promise<Response> {
  const deviceId = req.query.deviceId ? Number(req.query.deviceId) : undefined;

  const status = req.query.status as
    | "predicted"
    | "confirmed"
    | "resolved"
    | undefined;

  try {
    const faults = await prisma.fault.findMany({
      where: {
        ...(deviceId !== undefined ? { deviceId } : {}),
        ...(status !== undefined ? { status } : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return sendSuccess(res, faults);
  } catch (error) {
    console.error("Failed to fetch faults:", error);

    return sendError(res, "Failed to fetch faults", 500);
  }
}

export async function getFaultById(
  req: Request,
  res: Response,
): Promise<Response> {
  const faultId = Number(req.params.id);

  try {
    const fault = await prisma.fault.findUnique({
      where: {
        id: faultId,
      },
    });

    if (!fault) {
      return sendError(res, "Fault not found", 404);
    }

    return sendSuccess(res, fault);
  } catch (error) {
    console.error("Failed to fetch fault:", error);

    return sendError(res, "Failed to fetch fault", 500);
  }
}
