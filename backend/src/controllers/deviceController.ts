import type { Request, Response } from "express";

import prisma from "../config/database.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";

export async function getDevices(
  _req: Request,
  res: Response,
): Promise<Response> {
  try {
    const devices = await prisma.device.findMany({
      orderBy: {
        id: "asc",
      },
      include: {
        interfaces: {
          select: {
            id: true,
            name: true,
            status: true,
          },
          orderBy: {
            id: "asc",
          },
        },
      },
    });

    return sendSuccess(res, devices);
  } catch (error) {
    console.error("Failed to fetch devices:", error);

    return sendError(res, "Failed to fetch devices", 500);
  }
}

export async function getDeviceById(
  req: Request,
  res: Response,
): Promise<Response> {
  const deviceId = Number(req.params.id);

  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return sendError(res, "Invalid device ID", 400);
  }

  try {
    const device = await prisma.device.findUnique({
      where: {
        id: deviceId,
      },
      include: {
        interfaces: {
          select: {
            id: true,
            name: true,
            status: true,
          },
          orderBy: {
            id: "asc",
          },
        },
      },
    });

    if (!device) {
      return sendError(res, "Device not found", 404);
    }

    return sendSuccess(res, device);
  } catch (error) {
    console.error("Failed to fetch device:", error);

    return sendError(res, "Failed to fetch device", 500);
  }
}
export async function getDeviceTelemetry(
  req: Request,
  res: Response,
): Promise<Response> {
  const deviceId = Number(req.params.id);
  const range = (req.query.range as string | undefined) ?? "1h";

  const rangeMinutes: Record<string, number> = {
    "1h": 60,
    "6h": 360,
    "24h": 1440,
  };

  try {
    const device = await prisma.device.findUnique({
      where: {
        id: deviceId,
      },
      select: {
        id: true,
        name: true,
      },
    });

    if (!device) {
      return sendError(res, "Device not found", 404);
    }

    const minutes = rangeMinutes[range];
    const startTime = new Date(Date.now() - minutes * 60 * 1000);

    const telemetry = await prisma.telemetry.findMany({
      where: {
        deviceId,
        recordedAt: {
          gte: startTime,
        },
      },
      orderBy: {
        recordedAt: "asc",
      },
    });

    return sendSuccess(res, {
      device,
      range,
      telemetry,
    });
  } catch (error) {
    console.error("Failed to fetch device telemetry:", error);

    return sendError(res, "Failed to fetch device telemetry", 500);
  }
}
