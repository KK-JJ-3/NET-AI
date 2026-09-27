export type AiFaultType = "congestion" | "device_failure";

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
  window: AiTelemetryPoint[];
}

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? "http://localhost:8000";

export async function predictFault(
  deviceId: number,
  window: AiTelemetryPoint[],
): Promise<AiPredictionResult> {
  if (!Number.isInteger(deviceId) || deviceId <= 0) {
    throw new Error("Invalid device ID");
  }

  if (window.length === 0) {
    throw new Error("Telemetry window cannot be empty");
  }

  const payload: PredictRequest = {
    deviceId,
    window,
  };

  /*
   * Temporary stub.
   *
   * The Python AI service will replace this implementation later.
   *
   * For now, return a deterministic AI-shaped result so the Node
   * prediction pipeline can be developed and tested independently.
   */
  void AI_SERVICE_URL;
  void payload;

  return {
    faultType: "congestion",
    riskScore: 0.83,
    predictedWindowMinutes: 10,
    contributingFeatures: {
      utilization_slope: 0.79,
      latency_slope: 0.61,
    },
    explanationText: "Network utilization and latency are increasing rapidly.",
  };
}
