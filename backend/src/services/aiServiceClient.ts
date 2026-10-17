export type AiFaultType = "normal" | "congestion" | "device_failure";

export interface AiTelemetryPoint {
  recordedAt: Date;
  latencyMs: number | null;
  packetLossPct: number | null;
  jitterMs: number | null;
  utilizationPct: number | null;
  cpuPct: number | null;
  memoryPct: number | null;
  availability: number | null;
}

export interface AiPredictionResult {
  faultType: AiFaultType;
  riskScore: number;
  predictedWindowMinutes: number;
  contributingFeatures: Record<string, number>;
  explanationText: string;
}

interface PredictRequest {
  deviceId: number;
  window: {
    recordedAt: string;
    latencyMs: number | null;
    packetLossPct: number | null;
    jitterMs: number | null;
    utilizationPct: number | null;
    cpuPct: number | null;
    memoryPct: number | null;
    availability: number | null;
  }[];
}

interface AiPredictionResponse {
  faultType: AiFaultType;
  riskScore: number;
  predictedWindowMinutes: number;
  contributingFeatures: Record<string, number>;
  explanationText: string;
}

const AI_SERVICE_URL = (
  process.env.AI_SERVICE_URL ?? "http://127.0.0.1:8000"
).replace(/\/+$/, "");

const AI_REQUEST_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validatePredictionResponse(value: unknown): AiPredictionResponse {
  if (!isRecord(value)) {
    throw new Error("AI service returned an invalid response object");
  }

  const {
    faultType,
    riskScore,
    predictedWindowMinutes,
    contributingFeatures,
    explanationText,
  } = value;

  if (
    faultType !== "normal" &&
    faultType !== "congestion" &&
    faultType !== "device_failure"
  ) {
    throw new Error("AI service returned an invalid faultType");
  }

  if (
    typeof riskScore !== "number" ||
    !Number.isFinite(riskScore) ||
    riskScore < 0 ||
    riskScore > 1
  ) {
    throw new Error("AI service returned an invalid riskScore");
  }

  if (
    typeof predictedWindowMinutes !== "number" ||
    !Number.isInteger(predictedWindowMinutes) ||
    predictedWindowMinutes <= 0
  ) {
    throw new Error("AI service returned an invalid predictedWindowMinutes");
  }

  if (!isRecord(contributingFeatures)) {
    throw new Error("AI service returned invalid contributingFeatures");
  }

  for (const [name, score] of Object.entries(contributingFeatures)) {
    if (
      !name ||
      typeof score !== "number" ||
      !Number.isFinite(score) ||
      score < 0
    ) {
      throw new Error("AI service returned an invalid contributing feature");
    }
  }

  if (
    typeof explanationText !== "string" ||
    explanationText.trim().length === 0
  ) {
    throw new Error("AI service returned an invalid explanationText");
  }

  return {
    faultType,
    riskScore,
    predictedWindowMinutes,
    contributingFeatures: contributingFeatures as Record<string, number>,
    explanationText,
  };
}

export async function predictFault(
  deviceId: number,
  window: AiTelemetryPoint[],
): Promise<AiPredictionResult> {
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    throw new Error("Invalid device ID");
  }

  if (window.length < 15) {
    throw new Error("Telemetry window must contain at least 15 points");
  }

  const payload: PredictRequest = {
    deviceId,
    window: window.map((point) => ({
      recordedAt:
        point.recordedAt instanceof Date
          ? point.recordedAt.toISOString()
          : new Date(point.recordedAt).toISOString(),
      latencyMs: point.latencyMs,
      packetLossPct: point.packetLossPct,
      jitterMs: point.jitterMs,
      utilizationPct: point.utilizationPct,
      cpuPct: point.cpuPct,
      memoryPct: point.memoryPct,
      availability: point.availability,
    })),
  };

  const controller = new AbortController();

  const timeout = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS);

  try {
    let response: Response;

    try {
      response = await fetch(`${AI_SERVICE_URL}/predict`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(
          `AI service request timed out after ${AI_REQUEST_TIMEOUT_MS} ms`,
        );
      }

      throw new Error(
        `Unable to reach AI service at ${AI_SERVICE_URL}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!response.ok) {
      const errorBody = await response.text();

      throw new Error(
        `AI service returned HTTP ${response.status}: ${
          errorBody.slice(0, 500) || response.statusText
        }`,
      );
    }

    let responseBody: unknown;

    try {
      responseBody = await response.json();
    } catch {
      throw new Error("AI service returned invalid JSON");
    }

    return validatePredictionResponse(responseBody);
  } finally {
    clearTimeout(timeout);
  }
}
