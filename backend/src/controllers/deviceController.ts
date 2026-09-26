import type { Request, Response } from "express";
import { isIP } from "node:net";
import prisma from "../config/database.js";
import { DeviceType, DeviceStatus } from "../generated/prisma/client.js";
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

export async function createDevice(
  req: Request,
  res: Response,
): Promise<Response> {
  const { name, type, ipAddress, status, location } = req.body;

  if (
    typeof name !== "string" ||
    name.trim().length === 0 ||
    typeof type !== "string" ||
    typeof ipAddress !== "string" ||
    ipAddress.trim().length === 0
  ) {
    return sendError(res, "name, type, and ipAddress are required", 400);
  }
  if (isIP(ipAddress.trim()) === 0) {
    return sendError(res, "Invalid IP address", 400);
  }
  const validTypes: DeviceType[] = [
    DeviceType.router,
    DeviceType.switch,
    DeviceType.firewall,
    DeviceType.access_point,
    DeviceType.server,
  ];

  if (!validTypes.includes(type as DeviceType)) {
    return sendError(res, "Invalid device type", 400);
  }

  const validStatuses: DeviceStatus[] = [
    DeviceStatus.up,
    DeviceStatus.degraded,
    DeviceStatus.down,
  ];

  if (status !== undefined && !validStatuses.includes(status as DeviceStatus)) {
    return sendError(res, "Invalid device status", 400);
  }

  try {
    const device = await prisma.device.create({
      data: {
        name: name.trim(),
        type: type as DeviceType,
        ipAddress: ipAddress.trim(),
        status: (status ?? DeviceStatus.up) as DeviceStatus,
        location:
          typeof location === "string" && location.trim().length > 0
            ? location.trim()
            : null,
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

    return sendSuccess(res, device, 201);
  } catch (error) {
    console.error("Failed to create device:", error);

    return sendError(res, "Failed to create device", 500);
  }
}
export async function updateDevice(
  req: Request,
  res: Response,
): Promise<Response> {
  const deviceId = Number(req.params.id);

  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return sendError(res, "Invalid device ID", 400);
  }

  const { name, type, ipAddress, status, location } = req.body;

  if (
    name === undefined &&
    type === undefined &&
    ipAddress === undefined &&
    status === undefined &&
    location === undefined
  ) {
    return sendError(res, "At least one field is required", 400);
  }

  if (name !== undefined) {
    if (typeof name !== "string" || name.trim().length === 0) {
      return sendError(res, "Invalid device name", 400);
    }
  }

  if (type !== undefined) {
    const validTypes: DeviceType[] = [
      DeviceType.router,
      DeviceType.switch,
      DeviceType.firewall,
      DeviceType.access_point,
      DeviceType.server,
    ];

    if (typeof type !== "string" || !validTypes.includes(type as DeviceType)) {
      return sendError(res, "Invalid device type", 400);
    }
  }

  if (ipAddress !== undefined) {
    if (typeof ipAddress !== "string" || ipAddress.trim().length === 0) {
      return sendError(res, "Invalid IP address", 400);
    }

    if (isIP(ipAddress.trim()) === 0) {
      return sendError(res, "Invalid IP address", 400);
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
      return sendError(res, "Invalid device status", 400);
    }
  }

  if (
    location !== undefined &&
    location !== null &&
    typeof location !== "string"
  ) {
    return sendError(res, "Invalid location", 400);
  }

  try {
    const existingDevice = await prisma.device.findUnique({
      where: {
        id: deviceId,
      },
    });

    if (!existingDevice) {
      return sendError(res, "Device not found", 404);
    }

    const device = await prisma.device.update({
      where: {
        id: deviceId,
      },
      data: {
        ...(name !== undefined && {
          name: name.trim(),
        }),
        ...(type !== undefined && {
          type: type as DeviceType,
        }),
        ...(ipAddress !== undefined && {
          ipAddress: ipAddress.trim(),
        }),
        ...(status !== undefined && {
          status: status as DeviceStatus,
        }),
        ...(location !== undefined && {
          location:
            location === null || location.trim().length === 0
              ? null
              : location.trim(),
        }),
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

    return sendSuccess(res, device);
  } catch (error) {
    console.error("Failed to update device:", error);

    return sendError(res, "Failed to update device", 500);
  }
}
export async function deleteDevice(
  req: Request,
  res: Response,
): Promise<Response> {
  const deviceId = Number(req.params.id);

  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    return sendError(res, "Invalid device ID", 400);
  }

  try {
    const existingDevice = await prisma.device.findUnique({
      where: {
        id: deviceId,
      },
    });

    if (!existingDevice) {
      return sendError(res, "Device not found", 404);
    }

    await prisma.device.delete({
      where: {
        id: deviceId,
      },
    });

    return sendSuccess(res, {
      message: "Device deleted successfully",
      id: deviceId,
    });
  } catch (error) {
    console.error("Failed to delete device:", error);

    return sendError(res, "Failed to delete device", 500);
  }
}
