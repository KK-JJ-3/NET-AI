import prisma from "../config/database.js";

export async function evaluatePrediction(
  predictionId: number,
  referenceTime: Date = new Date(),
) {
  if (!Number.isInteger(predictionId) || predictionId <= 0) {
    throw new Error("Invalid prediction ID");
  }

  if (
    !(referenceTime instanceof Date) ||
    Number.isNaN(referenceTime.getTime())
  ) {
    throw new Error("Invalid evaluation reference time");
  }

  const prediction = await prisma.prediction.findUnique({
    where: { id: predictionId },
    select: {
      id: true,
      deviceId: true,
      faultType: true,
      predictedWindowMinutes: true,
      predictedAt: true,
      status: true,
      outcomes: {
        select: { id: true },
        take: 1,
      },
    },
  });

  if (!prediction) {
    throw new Error("Prediction not found");
  }

  if (prediction.outcomes.length > 0) {
    throw new Error("Prediction has already been evaluated");
  }

  if (prediction.status !== "pending") {
    throw new Error("Prediction is not pending");
  }

  const windowEnd = new Date(
    prediction.predictedAt.getTime() +
      prediction.predictedWindowMinutes * 60_000,
  );

  if (referenceTime < windowEnd) {
    throw new Error("Prediction window has not expired");
  }

  const actualFault = await prisma.fault.findFirst({
    where: {
      deviceId: prediction.deviceId,
      faultType: prediction.faultType,
      status: { in: ["confirmed", "resolved"] },
      startedAt: {
        gt: prediction.predictedAt,
        lte: windowEnd,
      },
    },
    orderBy: { startedAt: "asc" },
  });

  return prisma.$transaction(async (tx) => {
    const confirmed = actualFault !== null;

    const outcome = await tx.predictionOutcome.create({
      data: {
        predictionId: prediction.id,
        faultId: actualFault?.id ?? null,
        outcome: confirmed ? "confirmed" : "false_positive",
        notes: confirmed
          ? "Matching actual fault occurred after the prediction and within its prediction window."
          : "No matching actual fault occurred after the prediction and within its prediction window.",
        evaluatedAt: referenceTime,
      },
    });

    await tx.prediction.update({
      where: { id: prediction.id },
      data: {
        status: confirmed ? "confirmed" : "false_positive",
      },
    });

    return {
      result: confirmed ? ("confirmed" as const) : ("false_positive" as const),
      predictionId: prediction.id,
      faultId: actualFault?.id ?? null,
      outcome,
    };
  });
}
