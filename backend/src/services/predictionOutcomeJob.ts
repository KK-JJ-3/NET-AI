import prisma from "../config/database.js";
import { evaluatePrediction } from "./predictionOutcomeService.js";

export async function runPredictionOutcomeJob() {
  const now = new Date();

  const pendingPredictions = await prisma.prediction.findMany({
    where: {
      status: "pending",
    },
    select: {
      id: true,
      predictedAt: true,
      predictedWindowMinutes: true,
    },
  });

  const expiredPredictionIds = pendingPredictions
    .filter((prediction) => {
      const windowEnd = new Date(
        prediction.predictedAt.getTime() +
          prediction.predictedWindowMinutes * 60 * 1000,
      );

      return windowEnd <= now;
    })
    .map((prediction) => prediction.id);

  let evaluated = 0;
  let failed = 0;

  const results: Array<{
    predictionId: number;
    result: "confirmed" | "false_positive";
  }> = [];

  for (const predictionId of expiredPredictionIds) {
    try {
      const result = await evaluatePrediction(predictionId);

      results.push({
        predictionId: result.predictionId,
        result: result.result,
      });

      evaluated += 1;
    } catch (error) {
      failed += 1;

      console.error(`Failed to evaluate prediction ${predictionId}:`, error);
    }
  }

  return {
    checked: pendingPredictions.length,
    expired: expiredPredictionIds.length,
    evaluated,
    failed,
    results,
  };
}
