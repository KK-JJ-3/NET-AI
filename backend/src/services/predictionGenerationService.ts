import prisma from "../config/database.js";
import { emitMonitoringUpdate } from "../realtime/socket.js";
import { isActiveFaultDetection } from "./predictionClassification.js";
import type { AiPredictionResult } from "./aiServiceClient.js";

type FaultType = "congestion" | "device_failure";
type Severity = "low" | "medium" | "high" | "critical";

const DETECTION_PREFIXES = ["[ACTIVE_FAULT_DETECTION]", "[RULE_BASED]"];
const ALERT_THRESHOLD = 0.6;

// Temporary diagnostics: remove these logs after identifying suppression behavior.
function logSuppression(
  reason: string,
  deviceId: number,
  faultType: FaultType,
  predictedAt: Date,
  extra: Record<string, unknown> = {},
): void {
  console.info("[prediction-diagnostic] suppressed", {
    reason,
    deviceId,
    faultType,
    predictedAt: predictedAt.toISOString(),
    ...extra,
  });
}

function getSeverity(riskScore: number): Severity {
  if (riskScore >= 0.8) return "critical";
  if (riskScore >= ALERT_THRESHOLD) return "high";
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

/**
 * Serialize prediction generation per device/fault type within this backend
 * process. Multi-instance deployments should add database-level
 * uniqueness/idempotency protection.
 */
const generationLocks = new Map<string, Promise<void>>();

async function withGenerationLock<T>(
  key: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = generationLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });

  generationLocks.set(key, current);
  await previous;

  try {
    return await operation();
  } finally {
    release();
    if (generationLocks.get(key) === current) {
      generationLocks.delete(key);
    }
  }
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

  if (result.faultType === "normal") {
    return null;
  }

  // Reject unexpected runtime values instead of persisting an invalid type.
  if (
    result.faultType !== "congestion" &&
    result.faultType !== "device_failure"
  ) {
    throw new Error("Invalid fault type");
  }

  const faultType: FaultType = result.faultType;
  const severity = getSeverity(result.riskScore);
  const isDetection = isActiveFaultDetection(result.explanationText);
  const windowMs = result.predictedWindowMinutes * 60_000;

  const device = await prisma.device.findUnique({
    where: { id: deviceId },
    select: { id: true },
  });

  if (!device) {
    throw new Error("Device not found");
  }

  const outcome = await withGenerationLock(`${deviceId}:${faultType}`, () =>
    prisma.$transaction(async (tx) => {
      const activeFault = await tx.fault.findFirst({
        where: {
          deviceId,
          faultType,
          startedAt: { lte: predictedAt },
          OR: [{ resolvedAt: null }, { resolvedAt: { gt: predictedAt } }],
        },
        select: { id: true, startedAt: true, resolvedAt: true },
        orderBy: { startedAt: "desc" },
      });

      // A forecast is not useful while any fault is active on this device.
      // Do not filter by faultType here: a misclassified prediction must not
      // create a second, misleading forecast during another active fault.
      if (!isDetection) {
        const anyActiveFault = await tx.fault.findFirst({
          where: {
            deviceId,
            startedAt: { lte: predictedAt },
            OR: [{ resolvedAt: null }, { resolvedAt: { gt: predictedAt } }],
          },
          select: { id: true },
          orderBy: { startedAt: "desc" },
        });

        if (anyActiveFault) {
          logSuppression(
            "active-fault-on-device",
            deviceId,
            faultType,
            predictedAt,
            {
              activeFaultId: anyActiveFault.id,
            },
          );
          return null;
        }
      }

      if (isDetection) {
        // If the fault record has not arrived yet, use a short fallback
        // window to deduplicate repeated detections.
        const episodeStart =
          activeFault?.startedAt ?? new Date(predictedAt.getTime() - windowMs);

        const existingDetection = await tx.prediction.findFirst({
          where: {
            deviceId,
            faultType,
            predictedAt: { gte: episodeStart },
            OR: DETECTION_PREFIXES.map((prefix) => ({
              explanationText: { startsWith: prefix },
            })),
          },
          select: { id: true },
          orderBy: { predictedAt: "desc" },
        });

        if (existingDetection) {
          // Do not create another prediction for the same detected episode.
          // A later high-risk result may still require an alert.
          if (result.riskScore < ALERT_THRESHOLD) {
            logSuppression(
              "existing-detection-below-alert-threshold",
              deviceId,
              faultType,
              predictedAt,
              {
                existingPredictionId: existingDetection.id,
                riskScore: result.riskScore,
                alertThreshold: ALERT_THRESHOLD,
              },
            );
            return null;
          }

          const alertStart = activeFault
            ? new Date(activeFault.startedAt.getTime() - windowMs)
            : new Date(predictedAt.getTime() - windowMs);

          const existingAlert = await tx.alert.findFirst({
            where: {
              deviceId,
              createdAt: { gte: alertStart },
              prediction: { faultType },
            },
            select: { id: true },
            orderBy: { createdAt: "desc" },
          });

          if (existingAlert) {
            logSuppression(
              "duplicate-alert-for-detection",
              deviceId,
              faultType,
              predictedAt,
              {
                existingPredictionId: existingDetection.id,
                existingAlertId: existingAlert.id,
                riskScore: result.riskScore,
              },
            );
            return null;
          }

          const alert = await tx.alert.create({
            data: {
              predictionId: existingDetection.id,
              deviceId,
              message: getAlertMessage(faultType, severity, result.riskScore),
              severity,
              acknowledged: false,
            },
          });

          // Return only the newly created alert. Do not emit a duplicate
          // prediction.created event for the existing prediction.
          return {
            prediction: null,
            alert,
          };
        }
      } else if (!activeFault) {
        const recoveryStart = new Date(predictedAt.getTime() - windowMs);

        const recentlyResolvedFault = await tx.fault.findFirst({
          where: {
            deviceId,
            status: "resolved",
            resolvedAt: { gt: recoveryStart, lte: predictedAt },
          },
          select: { id: true },
          orderBy: { resolvedAt: "desc" },
        });

        if (recentlyResolvedFault) {
          logSuppression(
            "recently-resolved-fault",
            deviceId,
            faultType,
            predictedAt,
            {
              faultId: recentlyResolvedFault.id,
              recoveryWindowStart: recoveryStart.toISOString(),
            },
          );
          return null;
        }

        const existingForecast = await tx.prediction.findFirst({
          where: {
            deviceId,
            faultType,
            predictedAt: { gte: recoveryStart },
          },
          select: { id: true },
          orderBy: { predictedAt: "desc" },
        });

        if (existingForecast) {
          logSuppression(
            "existing-forecast-in-window",
            deviceId,
            faultType,
            predictedAt,
            {
              existingPredictionId: existingForecast.id,
              forecastWindowStart: recoveryStart.toISOString(),
            },
          );
          return null;
        }
      }

      const prediction = await tx.prediction.create({
        data: {
          deviceId,
          faultType,
          riskScore: result.riskScore,
          severity,
          predictedWindowMinutes: result.predictedWindowMinutes,
          explanationText: result.explanationText,
          contributingFeatures: result.contributingFeatures,
          status: isDetection ? "confirmed" : "pending",
          predictedAt,
        },
      });

      let alert = null;

      if (result.riskScore >= ALERT_THRESHOLD) {
        const existingAlert = await tx.alert.findFirst({
          where: {
            deviceId,
            ...(activeFault
              ? {
                  createdAt: {
                    gte: new Date(activeFault.startedAt.getTime() - windowMs),
                  },
                }
              : { acknowledged: false }),
            prediction: { faultType },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        });

        if (!existingAlert) {
          alert = await tx.alert.create({
            data: {
              predictionId: prediction.id,
              deviceId,
              message: getAlertMessage(faultType, severity, result.riskScore),
              severity,
              acknowledged: false,
            },
          });
        } else {
          logSuppression(
            "duplicate-alert-for-new-prediction",
            deviceId,
            faultType,
            predictedAt,
            {
              existingAlertId: existingAlert.id,
              riskScore: result.riskScore,
            },
          );
        }
      }

      return { prediction, alert };
    }),
  );

  if (!outcome) {
    return null;
  }

  if (outcome.prediction) {
    emitMonitoringUpdate({
      type: "prediction.created",
      deviceId,
      entityId: outcome.prediction.id,
    });
  }

  if (outcome.alert) {
    emitMonitoringUpdate({
      type: "alert.created",
      deviceId,
      entityId: outcome.alert.id,
    });
  }

  return outcome;
}
