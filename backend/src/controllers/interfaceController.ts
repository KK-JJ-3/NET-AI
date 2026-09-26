import type { Request, Response } from "express";

import prisma from "../config/database.js";
import { DeviceStatus } from "../generated/prisma/client.js";
import { sendError, sendSuccess } from "../utils/apiResponse.js";

export async function getDeviceInterfaces(
  req: Request,
  res: Response,
): Promise<Response> {
  const deviceId = Number(req.params.deviceId);

  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return sendError(res, "Invalid device ID", 400);
  }

  try {
    const device = await prisma.device.findUnique({
      where: {
        id: deviceId,
      },
      select: {
        id: true,
      },
    });

    if (!device) {
      return sendError(res, "Device not found", 404);
    }

    const interfaces = await prisma.interface.findMany({
      where: {
        deviceId,
      },
      orderBy: {
        id: "asc",
      },
    });

    return sendSuccess(res, interfaces);
  } catch (error) {
    console.error("Failed to fetch device interfaces:", error);

    return sendError(res, "Failed to fetch device interfaces", 500);
  }
}

export async function createInterface(
  req: Request,
  res: Response,
): Promise<Response> {
  const deviceId = Number(req.params.deviceId);

  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return sendError(res, "Invalid device ID", 400);
  }

  const { name, status } = req.body;

  if (typeof name !== "string" || name.trim().length === 0) {
    return sendError(res, "Interface name is required", 400);
  }

  const validStatuses: DeviceStatus[] = [
    DeviceStatus.up,
    DeviceStatus.degraded,
    DeviceStatus.down,
  ];

  if (status !== undefined && !validStatuses.includes(status as DeviceStatus)) {
    return sendError(res, "Invalid interface status", 400);
  }

  try {
    const device = await prisma.device.findUnique({
      where: {
        id: deviceId,
      },
      select: {
        id: true,
      },
    });

    if (!device) {
      return sendError(res, "Device not found", 404);
    }

    const interfaceRecord = await prisma.interface.create({
      data: {
        deviceId,
        name: name.trim(),
        status: (status ?? DeviceStatus.up) as DeviceStatus,
      },
    });

    return sendSuccess(res, interfaceRecord, 201);
  } catch (error) {
    console.error("Failed to create interface:", error);

    return sendError(res, "Failed to create interface", 500);
  }
}

export async function updateInterface(
  req: Request,
  res: Response,
): Promise<Response> {
  const interfaceId = Number(req.params.id);

  if (!Number.isInteger(interfaceId) || interfaceId <= 0) {
    return sendError(res, "Invalid interface ID", 400);
  }

  const { name, status } = req.body;

  if (name === undefined && status === undefined) {
    return sendError(res, "At least one field is required", 400);
  }

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return sendError(res, "Invalid interface name", 400);
    }
  }

  if (status !== undefined) {
    const validStatuses: DeviceStatus[] = [
      DeviceStatus.up,
      DeviceStatus.degraded,
      DeviceStatus.down,
    ];

    if (
      typeof status !== "string" ||
      !validStatuses.includes(status as DeviceStatus)
    ) {
      return sendError(res, "Invalid interface status", 400);
    }
  }

  try {
    const existingInterface = await prisma.interface.findUnique({
      where: {
        id: interfaceId,
      },
    });

    if (!existingInterface) {
      return sendError(res, "Interface not found", 404);
    }

    const interfaceRecord = await prisma.interface.update({
      where: {
        id: interfaceId,
      },
      data: {
        ...(name !== undefined && {
          name: name.trim(),
        }),
        ...(status !== undefined && {
          status: status as DeviceStatus,
        }),
      },
    });

    return sendSuccess(res, interfaceRecord);
  } catch (error) {
    console.error("Failed to update interface:", error);

    return sendError(res, "Failed to update interface", 500);
  }
}

export async function deleteInterface(
  req: Request,
  res: Response,
): Promise<Response> {
  const interfaceId = Number(req.params.id);

  if (!Number.isInteger(interfaceId) || interfaceId <= 0) {
    return sendError(res, "Invalid interface ID", 400);
  }

  try {
    const existingInterface = await prisma.interface.findUnique({
      where: {
        id: interfaceId,
      },
    });

    if (!existingInterface) {
      return sendError(res, "Interface not found", 404);
    }

    await prisma.interface.delete({
      where: {
        id: interfaceId,
      },
    });

    return sendSuccess(res, {
      message: "Interface deleted successfully",
      id: interfaceId,
    });
  } catch (error) {
    console.error("Failed to delete interface:", error);

    return sendError(res, "Failed to delete interface", 500);
  }
}
