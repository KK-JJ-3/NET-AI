import prisma from "../config/database.js";

type FaultType = "congestion" | "device_failure";
type Severity = "low" | "medium" | "high" | "critical";

export interface RecordFaultInput {
  faultType: FaultType;
  severity: Severity;
  startedAt: Date;
  resolvedAt?: Date | null;
}

export async function recordActualFault(
  deviceId: number,
  input: RecordFaultInput,
) {
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    throw new Error("Invalid device ID");
  }

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
    throw new Error("Device not found");
  }

  if (
    !(input.startedAt instanceof Date) ||
    Number.isNaN(input.startedAt.getTime())
  ) {
    throw new Error("Invalid fault start time");
  }

  if (input.resolvedAt !== undefined && input.resolvedAt !== null) {
    if (
      !(input.resolvedAt instanceof Date) ||
      Number.isNaN(input.resolvedAt.getTime())
    ) {
      throw new Error("Invalid fault resolution time");
    }

    if (input.resolvedAt < input.startedAt) {
      throw new Error("Fault resolution time cannot be before start time");
    }
  }

  return prisma.fault.create({
    data: {
      deviceId,
      faultType: input.faultType,
      status: input.resolvedAt ? "resolved" : "confirmed",
      severity: input.severity,
      startedAt: input.startedAt,
      resolvedAt: input.resolvedAt ?? null,
    },
  });
}
