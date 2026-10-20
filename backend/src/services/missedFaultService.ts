import prisma from "../config/database.js";
import { isActiveFaultDetection } from "./predictionClassification.js";

const MINUTE_MS = 60_000;

export async function findMissedFaults() {
  const faults = await prisma.fault.findMany({
    where: { status: { in: ["confirmed", "resolved"] } },
    orderBy: { startedAt: "asc" },
  });

  const missedFaults: typeof faults = [];

  for (const fault of faults) {
    const earlierPredictions = await prisma.prediction.findMany({
      where: {
        deviceId: fault.deviceId,
        faultType: fault.faultType,
        predictedAt: {
          lt: fault.startedAt,
        },
      },
      select: {
        id: true,
        explanationText: true,
        predictedAt: true,
        predictedWindowMinutes: true,
      },
    });

    const hasForecast = earlierPredictions.some((prediction) => {
      if (isActiveFaultDetection(prediction.explanationText)) {
        return false;
      }

      if (
        !Number.isInteger(prediction.predictedWindowMinutes) ||
        prediction.predictedWindowMinutes <= 0
      ) {
        return false;
      }

      const horizonStart =
        fault.startedAt.getTime() -
        prediction.predictedWindowMinutes * MINUTE_MS;

      return prediction.predictedAt.getTime() >= horizonStart;
    });

    if (!hasForecast) {
      missedFaults.push(fault);
    }
  }

  return missedFaults;
}
