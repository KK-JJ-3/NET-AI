import type { Request, Response } from "express";

import prisma from "../config/database.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";

export async function getPredictions(
  req: Request,
  res: Response,
): Promise<Response> {
  const deviceId = req.query.deviceId ? Number(req.query.deviceId) : undefined;

  const status = req.query.status as
    | "pending"
    | "confirmed"
    | "false_positive"
    | undefined;

  try {
    const predictions = await prisma.prediction.findMany({
      where: {
        ...(deviceId !== undefined ? { deviceId } : {}),
        ...(status !== undefined ? { status } : {}),
      },
      orderBy: {
        predictedAt: "desc",
      },
    });

    return sendSuccess(res, predictions);
  } catch (error) {
    console.error("Failed to fetch predictions:", error);

    return sendError(res, "Failed to fetch predictions", 500);
  }
}

export async function getPredictionById(
  req: Request,
  res: Response,
): Promise<Response> {
  const predictionId = Number(req.params.id);

  try {
    const prediction = await prisma.prediction.findUnique({
      where: {
        id: predictionId,
      },
    });

    if (!prediction) {
      return sendError(res, "Prediction not found", 404);
    }

    return sendSuccess(res, prediction);
  } catch (error) {
    console.error("Failed to fetch prediction:", error);

    return sendError(res, "Failed to fetch prediction", 500);
  }
}
