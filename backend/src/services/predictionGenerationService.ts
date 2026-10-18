import prisma from "../config/database.js";
import type { AiPredictionResult } from "./aiServiceClient.js";

type FaultType = "congestion" | "device_failure";
type Severity = "low" | "medium" | "high" | "critical";

function getSeverity(riskScore: number): Severity {
  if (riskScore >= 0.8) return "critical";
  if (riskScore >= 0.6) return "high";
  if (riskScore >= 0.4) return "medium";
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
  predictedAt: Date = new Date(),
) {
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    throw new Error("Invalid device ID");
  }

  if (!(predictedAt instanceof Date) || Number.isNaN(predictedAt.getTime())) {
    throw new Error("Invalid prediction timestamp");
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

  if (
    typeof result.explanationText !== "string" ||
    !result.explanationText.trim()
  ) {
    throw new Error("Explanation text is required");
  }

  // Normal operation is not a fault prediction.
  if (result.faultType === "normal") {
    return null;
  }

  const faultType: FaultType = result.faultType;
  const severity = getSeverity(result.riskScore);

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true },
  });

  if (!device) {
    throw new Error("Device not found");
  }

  return prisma.$transaction(async (tx) => {
    const prediction = await tx.prediction.create({
      data: {
        deviceId,
        faultType,
        riskScore: result.riskScore,
        severity,
        predictedWindowMinutes: result.predictedWindowMinutes,
        explanationText: result.explanationText,
        contributingFeatures: result.contributingFeatures,
        status: "pending",
        predictedAt,
      },
    });

    let alert = null;

    // Create alerts only when risk is at least 0.6.
    if (result.riskScore >= 0.6) {
      const existingActiveAlert = await tx.alert.findFirst({
        where: {
          deviceId,
          acknowledged: false,
          prediction: { faultType },
        },
        orderBy: { createdAt: "desc" },
      });

      if (!existingActiveAlert) {
        alert = await tx.alert.create({
          data: {
            predictionId: prediction.id,
            deviceId,
            message: getAlertMessage(faultType, severity, result.riskScore),
            severity,
            acknowledged: false,
          },
        });
      }
    }

    return { prediction, alert };
  });
}
