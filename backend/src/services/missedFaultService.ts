import prisma from "../config/database.js";
import { isActiveFaultDetection } from "./predictionClassification.js";

const LOOKBACK_MS = 30 * 60 * 1000;

export async function findMissedFaults() {
  const faults = await prisma.fault.findMany({
    where: { status: { in: ["confirmed", "resolved"] } },
    orderBy: { startedAt: "asc" },
  });

  const missedFaults: typeof faults = [];

  for (const fault of faults) {
    const lookbackStart = new Date(fault.startedAt.getTime() - LOOKBACK_MS);

    const earlierPredictions = await prisma.prediction.findMany({
      where: {
        deviceId: fault.deviceId,
        faultType: fault.faultType,
        predictedAt: {
          gte: lookbackStart,
          lt: fault.startedAt,
        },
      },
      select: {
        id: true,
        explanationText: true,
      },
    });

    const hasForecast = earlierPredictions.some(
      (prediction) => !isActiveFaultDetection(prediction.explanationText),
    );

    if (!hasForecast) {
      missedFaults.push(fault);
    }
  }

  return missedFaults;
}
