import type { Request, Response } from "express";

import prisma from "../config/database.js";
import { recordActualFault } from "../services/faultRecordingService.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";
import { resolveActualFault } from "../services/faultResolutionService.js";
import { emitMonitoringUpdate } from "../realtime/socket.js";

export async function createFault(
  req: Request,
  res: Response,
): Promise<Response> {
  try {
    const { deviceId, faultType, severity, startedAt, resolvedAt } = req.body;

    const fault = await recordActualFault(deviceId, {
      faultType,
      severity,
      startedAt: new Date(startedAt),
      resolvedAt:
        resolvedAt === undefined || resolvedAt === null
          ? resolvedAt
          : new Date(resolvedAt),
    });

    emitMonitoringUpdate({
      type: "fault.created",
      deviceId: fault.deviceId,
      entityId: fault.id,
    });

    return sendSuccess(res, fault, 201);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Device not found") {
        return sendError(res, error.message, 404);
      }

      if (
        error.message === "Invalid device ID" ||
        error.message === "Invalid fault start time" ||
        error.message === "Invalid fault resolution time" ||
        error.message === "Fault resolution time cannot be before start time"
      ) {
        return sendError(res, error.message, 400);
      }
    }

    console.error("Failed to record actual fault:", error);
    return sendError(res, "Failed to record actual fault", 500);
  }
}

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
      orderBy: { createdAt: "desc" },
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
      where: { id: faultId },
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

export async function resolveFault(
  req: Request,
  res: Response,
): Promise<Response> {
  const faultId = Number(req.params.id);
  const { resolvedAt } = req.body ?? {};

  if (typeof resolvedAt !== "string" || !resolvedAt.trim()) {
    return sendError(res, "Fault resolution time is required", 400);
  }

  try {
    const fault = await resolveActualFault(faultId, new Date(resolvedAt));

    emitMonitoringUpdate({
      type: "fault.resolved",
      deviceId: fault.deviceId,
      entityId: fault.id,
    });

    return sendSuccess(res, fault);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "Fault not found") {
        return sendError(res, error.message, 404);
      }

      if (
        error.message === "Invalid fault ID" ||
        error.message === "Invalid fault resolution time" ||
        error.message === "Fault resolution time cannot be before start time" ||
        error.message === "Fault is already resolved"
      ) {
        return sendError(res, error.message, 400);
      }
    }

    console.error("Failed to resolve actual fault:", error);
    return sendError(res, "Failed to resolve actual fault", 500);
  }
}
