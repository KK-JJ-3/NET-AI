import prisma from "../config/database.js";

export async function evaluatePrediction(predictionId: number) {
  if (!Number.isInteger(predictionId) || predictionId <= 0) {
    throw new Error("Invalid prediction ID");
  }

  const prediction = await prisma.prediction.findUnique({
    where: {
      id: predictionId,
    },
    select: {
      id: true,
      deviceId: true,
      faultType: true,
      predictedWindowMinutes: true,
      predictedAt: true,
      status: true,
      outcomes: {
        select: {
          id: true,
        },
        take: 1,
      },
    },
  });

  if (!prediction) {
    throw new Error("Prediction not found");
  }

  /*
   * Do not evaluate a prediction more than once.
   */
  if (prediction.outcomes.length > 0) {
    throw new Error("Prediction has already been evaluated");
  }

  /*
   * Only pending predictions should be evaluated.
   */
  if (prediction.status !== "pending") {
    throw new Error("Prediction is not pending");
  }

  const windowEnd = new Date(
    prediction.predictedAt.getTime() +
      prediction.predictedWindowMinutes * 60 * 1000,
  );

  /*
   * The prediction cannot be evaluated until its predicted window
   * has expired.
   */
  if (new Date() < windowEnd) {
    throw new Error("Prediction window has not expired");
  }

  /*
   * Find an actual fault matching:
   * - same device
   * - same fault type
   * - fault started during the prediction window
   */
  const actualFault = await prisma.fault.findFirst({
    where: {
      deviceId: prediction.deviceId,
      faultType: prediction.faultType,
      status: {
        in: ["confirmed", "resolved"],
      },
      startedAt: {
        gte: prediction.predictedAt,
        lte: windowEnd,
      },
    },
    orderBy: {
      startedAt: "asc",
    },
  });

  if (actualFault) {
    const outcome = await prisma.$transaction(async (tx) => {
      const predictionOutcome = await tx.predictionOutcome.create({
        data: {
          predictionId: prediction.id,
          faultId: actualFault.id,
          outcome: "confirmed",
          notes: "Matching actual fault occurred within the prediction window.",
        },
      });

      await tx.prediction.update({
        where: {
          id: prediction.id,
        },
        data: {
          status: "confirmed",
        },
      });

      return predictionOutcome;
    });

    return {
      result: "confirmed" as const,
      predictionId: prediction.id,
      faultId: actualFault.id,
      outcome,
    };
  }

  const outcome = await prisma.$transaction(async (tx) => {
    const predictionOutcome = await tx.predictionOutcome.create({
      data: {
        predictionId: prediction.id,
        outcome: "false_positive",
        notes:
          "No matching actual fault occurred within the prediction window.",
      },
    });

    await tx.prediction.update({
      where: {
        id: prediction.id,
      },
      data: {
        status: "false_positive",
      },
    });

    return predictionOutcome;
  });

  return {
    result: "false_positive" as const,
    predictionId: prediction.id,
    faultId: null,
    outcome,
  };
}
