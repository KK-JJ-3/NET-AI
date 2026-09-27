import type { Request, Response } from "express";

import prisma from "../config/database.js";
import { predictFault } from "../services/aiServiceClient.js";
import { generatePrediction } from "../services/predictionGenerationService.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";

export async function createTelemetry(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const {
      deviceId,
      interfaceId,
      recordedAt,
      latencyMs,
      packetLossPct,
      jitterMs,
      utilizationPct,
      cpuPct,
      memoryPct,
      availability,
      scenarioLabel,
    } = req.body;

    const device = await prisma.device.findUnique({
      where: {
        id: deviceId,
      },
    });

    if (!device) {
      return sendError(res, "Device not found", 404);
    }

    if (interfaceId !== undefined && interfaceId !== null) {
      const networkInterface = await prisma.interface.findUnique({
        where: {
          id: interfaceId,
        },
      });

      if (!networkInterface) {
        return sendError(res, "Interface not found", 404);
      }

      if (networkInterface.deviceId !== deviceId) {
        return sendError(
          res,
          "Interface does not belong to the specified device",
          400,
        );
      }
    }

    const telemetry = await prisma.telemetry.create({
      data: {
        deviceId,
        interfaceId: interfaceId ?? null,
        recordedAt,
        latencyMs,
        packetLossPct,
        jitterMs,
        utilizationPct,
        cpuPct,
        memoryPct,
        availability,
        scenarioLabel,
      },
    });

    let prediction = null;

    try {
      const recentTelemetry = await prisma.telemetry.findMany({
        where: {
          deviceId,
        },
        orderBy: {
          recordedAt: "desc",
        },
        take: 15,
      });

      if (recentTelemetry.length >= 15) {
        const aiWindow = recentTelemetry
          .slice()
          .reverse()
          .map((item) => ({
            recordedAt: item.recordedAt,
            latencyMs: item.latencyMs,
            packetLossPct: item.packetLossPct,
            jitterMs: item.jitterMs,
            utilizationPct: item.utilizationPct,
            cpuPct: item.cpuPct,
            memoryPct: item.memoryPct,
            availability: item.availability ? 1 : 0,
          }));

        const aiResult = await predictFault(deviceId, aiWindow);

        prediction = await generatePrediction(deviceId, aiResult);
      }
    } catch (scoringError) {
      console.error(
        `Telemetry scoring failed for device ${deviceId}:`,
        scoringError,
      );
    }

    return sendSuccess(
      res,
      {
        telemetry,
        prediction,
      },
      201,
    );
  } catch (error) {
    console.error("Failed to create telemetry:", error);

    return sendError(res, "Failed to create telemetry", 500);
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
