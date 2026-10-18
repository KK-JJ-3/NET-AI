import prisma from "../config/database.js";

export async function resolveActualFault(faultId: number, resolvedAt: Date) {
  if (!Number.isInteger(faultId) || faultId <= 0) {
    throw new Error("Invalid fault ID");
  }

  if (!(resolvedAt instanceof Date) || Number.isNaN(resolvedAt.getTime())) {
    throw new Error("Invalid fault resolution time");
  }

  const fault = await prisma.fault.findUnique({
    where: { id: faultId },
  });

  if (!fault) {
    throw new Error("Fault not found");
  }

  if (fault.status === "resolved") {
    throw new Error("Fault is already resolved");
  }

  if (resolvedAt < fault.startedAt) {
    throw new Error("Fault resolution time cannot be before start time");
  }

  return prisma.fault.update({
    where: { id: faultId },
    data: {
      status: "resolved",
      resolvedAt,
    },
  });
}
