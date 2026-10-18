import prisma from "../config/database.js";
import { evaluatePrediction } from "./predictionOutcomeService.js";

export async function runPredictionOutcomeJob(referenceTime?: Date) {
  if (
    referenceTime !== undefined &&
    (!(referenceTime instanceof Date) || Number.isNaN(referenceTime.getTime()))
  ) {
    throw new Error("Invalid evaluation reference time");
  }

  const pendingPredictions = await prisma.prediction.findMany({
    where: { status: "pending" },
    select: {
      id: true,
      deviceId: true,
      faultType: true,
      predictedAt: true,
      predictedWindowMinutes: true,
    },
  });

  const effectiveTimes = new Map<number, Date | null>();

  if (referenceTime === undefined) {
    const deviceIds = [
      ...new Set(pendingPredictions.map((prediction) => prediction.deviceId)),
    ];

    await Promise.all(
      deviceIds.map(async (deviceId) => {
        const latestTelemetry = await prisma.telemetry.findFirst({
          where: { deviceId },
          orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
          select: { recordedAt: true },
        });

        effectiveTimes.set(deviceId, latestTelemetry?.recordedAt ?? null);
      }),
    );
  }

  const getEvaluationTime = (deviceId: number): Date | null =>
    referenceTime ?? effectiveTimes.get(deviceId) ?? null;

  const expiredPredictions = pendingPredictions.filter((prediction) => {
    const evaluationTime = getEvaluationTime(prediction.deviceId);

    if (!evaluationTime) return false;

    const windowEnd =
      prediction.predictedAt.getTime() +
      prediction.predictedWindowMinutes * 60_000;

    return windowEnd <= evaluationTime.getTime();
  });

  let evaluated = 0;
  let skippedActiveFault = 0;
  let failed = 0;

  const results: Array<{
    predictionId: number;
    result: "confirmed" | "false_positive";
  }> = [];

  for (const prediction of expiredPredictions) {
    const evaluationTime = getEvaluationTime(prediction.deviceId);

    if (!evaluationTime) continue;

    try {
      // Skip forecasts made while a matching fault was already active.
      const activeFault = await prisma.fault.findFirst({
        where: {
          deviceId: prediction.deviceId,
          faultType: prediction.faultType,
          startedAt: { lte: prediction.predictedAt },
          OR: [
            { resolvedAt: null },
            { resolvedAt: { gt: prediction.predictedAt } },
          ],
        },
        select: { id: true },
      });

      if (activeFault) {
        skippedActiveFault += 1;
        continue;
      }

      const result = await evaluatePrediction(prediction.id, evaluationTime);

      results.push({
        predictionId: result.predictionId,
        result: result.result,
      });

      evaluated += 1;
    } catch (error) {
      failed += 1;
      console.error(`Failed to evaluate prediction ${prediction.id}:`, error);
    }
  }

  return {
    checked: pendingPredictions.length,
    expired: expiredPredictions.length,
    evaluated,
    skippedActiveFault,
    failed,
    results,
  };
}
