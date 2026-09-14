import type { Request, Response } from "express";

import prisma from "../config/database.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";

export async function getAlerts(
  req: Request,
  res: Response,
): Promise<Response> {
  const acknowledged =
    req.query.acknowledged !== undefined
      ? req.query.acknowledged === "true"
      : undefined;

  try {
    const alerts = await prisma.alert.findMany({
      where: {
        ...(acknowledged !== undefined ? { acknowledged } : {}),
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    return sendSuccess(res, alerts);
  } catch (error) {
    console.error("Failed to fetch alerts:", error);

    return sendError(res, "Failed to fetch alerts", 500);
  }
}

export async function acknowledgeAlert(
  req: Request,
  res: Response,
): Promise<Response> {
  const alertId = Number(req.params.id);

  try {
    const alert = await prisma.alert.findUnique({
      where: {
        id: alertId,
      },
    });

    if (!alert) {
      return sendError(res, "Alert not found", 404);
    }

    if (alert.acknowledged) {
      return sendSuccess(res, alert);
    }

    const updatedAlert = await prisma.alert.update({
      where: {
        id: alertId,
      },
      data: {
        acknowledged: true,
      },
    });

    return sendSuccess(res, updatedAlert);
  } catch (error) {
    console.error("Failed to acknowledge alert:", error);

    return sendError(res, "Failed to acknowledge alert", 500);
  }
}
