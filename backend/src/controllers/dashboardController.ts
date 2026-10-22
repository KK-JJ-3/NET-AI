import type { Request, Response } from "express";

import prisma from "../config/database.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";

export async function getDashboardSummary(
  _req: Request,
  res: Response,
): Promise<Response> {
  try {
    const [
      totalDevices,
      devicesUp,
      devicesDegraded,
      devicesDown,
      pendingPredictions,
      confirmedFaults,
      totalFaults,
      unacknowledgedAlerts,
    ] = await Promise.all([
      prisma.device.count(),

      prisma.device.count({
        where: { status: "up" },
      }),

      prisma.device.count({
        where: { status: "degraded" },
      }),

      prisma.device.count({
        where: { status: "down" },
      }),

      prisma.prediction.count({
        where: { status: "pending" },
      }),

      prisma.fault.count({
        where: { status: "confirmed" },
      }),

      prisma.fault.count(),

      prisma.alert.count({
        where: { acknowledged: false },
      }),
    ]);

    return sendSuccess(res, {
      devices: {
        total: totalDevices,
        up: devicesUp,
        degraded: devicesDegraded,
        down: devicesDown,
      },
      predictions: {
        pending: pendingPredictions,
      },
      faults: {
        // "confirmed" is the currently unresolved/active count.
        // "total" includes resolved faults for the detected-faults metric.
        confirmed: confirmedFaults,
        total: totalFaults,
      },
      alerts: {
        unacknowledged: unacknowledgedAlerts,
      },
    });
  } catch (error) {
    console.error("Failed to fetch dashboard summary:", error);

    return sendError(res, "Failed to fetch dashboard summary", 500);
  }
}
