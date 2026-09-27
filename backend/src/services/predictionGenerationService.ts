import prisma from "../config/database.js";
import type { AiPredictionResult } from "./aiServiceClient.js";

type FaultType = "congestion" | "device_failure";
type Severity = "low" | "medium" | "high" | "critical";

function getSeverity(riskScore: number): Severity {
  if (riskScore >= 0.8) {
    return "critical";
  }

  if (riskScore >= 0.6) {
    return "high";
  }

  if (riskScore >= 0.4) {
    return "medium";
  }

  return "low";
}

function getAlertMessage(
  faultType: FaultType,
  severity: Severity,
  riskScore: number,
): string {
  const faultName =
    faultType === "device_failure" ? "Device Failure" : "Network Congestion";

  return `${severity.toUpperCase()} risk: ${faultName} predicted with ${(riskScore * 100).toFixed(1)}% risk.`;
}

export async function generatePrediction(
  deviceId: number,
  result: AiPredictionResult,
) {
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    throw new Error("Invalid device ID");
  }

  if (
    !Number.isFinite(result.riskScore) ||
    result.riskScore < 0 ||
    result.riskScore > 1
  ) {
    throw new Error("Risk score must be between 0 and 1");
  }

  if (
    !Number.isInteger(result.predictedWindowMinutes) ||
    result.predictedWindowMinutes <= 0
  ) {
    throw new Error("Prediction window must be a positive integer");
  }

  if (!result.explanationText.trim()) {
    throw new Error("Explanation text is required");
  }

  const severity = getSeverity(result.riskScore);

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

  return prisma.$transaction(async (tx) => {
    /*
     * A Prediction represents the AI's prediction.
     *
     * It does NOT mean that the fault has actually happened.
     */
    const prediction = await tx.prediction.create({
      data: {
        deviceId,
        faultType: result.faultType,
        riskScore: result.riskScore,
        severity,
        predictedWindowMinutes: result.predictedWindowMinutes,
        explanationText: result.explanationText,
        contributingFeatures: result.contributingFeatures,
        status: "pending",
      },
    });

    /*
     * Alert threshold:
     * risk >= 0.6
     *
     * Deduplication will be added separately.
     */
    let alert = null;

    if (result.riskScore >= 0.6) {
      const existingActiveAlert = await tx.alert.findFirst({
        where: {
          deviceId,
          acknowledged: false,
          prediction: {
            faultType: result.faultType,
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      if (!existingActiveAlert) {
        alert = await tx.alert.create({
          data: {
            predictionId: prediction.id,
            deviceId,
            message: getAlertMessage(
              result.faultType,
              severity,
              result.riskScore,
            ),
            severity,
            acknowledged: false,
          },
        });
      }
    }

    /*
     * IMPORTANT:
     *
     * No Fault is created here.
     *
     * A Fault represents an actual fault occurrence and will be
     * created later by the simulator / actual-fault flow.
     */
    return {
      prediction,
      alert,
    };
  });
}
