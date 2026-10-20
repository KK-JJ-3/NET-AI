import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, txMock, emitMonitoringUpdateMock } = vi.hoisted(() => {
  const txMock = {
    fault: { findFirst: vi.fn() },
    prediction: { findFirst: vi.fn(), create: vi.fn() },
    alert: { findFirst: vi.fn(), create: vi.fn() },
  };

  return {
    txMock,
    prismaMock: {
      device: { findUnique: vi.fn() },
      $transaction: vi.fn(),
    },
    emitMonitoringUpdateMock: vi.fn(),
  };
});

vi.mock("../src/config/database.js", () => ({ default: prismaMock }));
vi.mock("../src/realtime/socket.js", () => ({
  emitMonitoringUpdate: emitMonitoringUpdateMock,
}));

import { generatePrediction } from "../src/services/predictionGenerationService.js";

const predictedAt = new Date("2026-10-19T10:10:00.000Z");
const activeFault = {
  id: 12,
  startedAt: new Date("2026-10-19T10:05:00.000Z"),
  resolvedAt: null,
};
const forecast = {
  faultType: "congestion" as const,
  riskScore: 0.8,
  predictedWindowMinutes: 10,
  explanationText: "Forecast: congestion risk increasing.",
  contributingFeatures: { utilization_pct: 0.92 },
};
const detection = {
  ...forecast,
  explanationText:
    "[ACTIVE_FAULT_DETECTION] Active network congestion is indicated.",
};

function transactionMock() {
  prismaMock.$transaction.mockImplementation(async (callback) =>
    callback(txMock),
  );
}

describe("generatePrediction fault-episode reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.device.findUnique.mockResolvedValue({ id: 7 });
    transactionMock();
    txMock.fault.findFirst.mockImplementation(async ({ where }) =>
      where.status === "resolved" ? null : null,
    );
    txMock.prediction.findFirst.mockResolvedValue(null);
    txMock.prediction.create.mockImplementation(async ({ data }) => ({
      id: 101,
      ...data,
    }));
    txMock.alert.findFirst.mockResolvedValue(null);
    txMock.alert.create.mockImplementation(async ({ data }) => ({
      id: 201,
      ...data,
    }));
  });

  it("suppresses future forecasts while a matching fault is already active", async () => {
    txMock.fault.findFirst.mockImplementation(async ({ where }) =>
      where.status === "resolved" ? null : activeFault,
    );

    const result = await generatePrediction(7, forecast, predictedAt);

    expect(result).toBeNull();
    expect(txMock.prediction.create).not.toHaveBeenCalled();
    expect(emitMonitoringUpdateMock).not.toHaveBeenCalled();
  });

  it("suppresses a forecast when a different fault type is already active", async () => {
    txMock.fault.findFirst.mockImplementation(async ({ where }) => {
      if (where.status === "resolved") return null;
      // The matching-type lookup finds nothing, but another fault is active.
      return where.faultType ? null : activeFault;
    });

    const result = await generatePrediction(7, forecast, predictedAt);

    expect(result).toBeNull();
    expect(txMock.prediction.create).not.toHaveBeenCalled();
    expect(emitMonitoringUpdateMock).not.toHaveBeenCalled();
  });

  it("stores an active-fault detection as confirmed, not as a pending forecast", async () => {
    txMock.fault.findFirst.mockImplementation(async ({ where }) =>
      where.status === "resolved" ? null : activeFault,
    );

    const result = await generatePrediction(7, detection, predictedAt);

    expect(result?.prediction.status).toBe("confirmed");
    expect(txMock.prediction.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ status: "confirmed", predictedAt }),
    });
  });

  it("does not create another detection prediction for the same active episode", async () => {
    txMock.fault.findFirst.mockImplementation(async ({ where }) =>
      where.status === "resolved" ? null : activeFault,
    );

    txMock.prediction.findFirst.mockResolvedValue({ id: 100 });
    txMock.alert.findFirst.mockResolvedValue({ id: 55 });

    const result = await generatePrediction(7, detection, predictedAt);

    expect(result).toBeNull();
    expect(txMock.prediction.create).not.toHaveBeenCalled();
    expect(txMock.alert.create).not.toHaveBeenCalled();
  });

  it("creates an alert when an existing detection later becomes high-risk", async () => {
    txMock.fault.findFirst.mockImplementation(async ({ where }) =>
      where.status === "resolved" ? null : activeFault,
    );

    // An earlier detection already exists for this episode.
    txMock.prediction.findFirst.mockResolvedValue({ id: 100 });

    // No alert exists yet for the episode.
    txMock.alert.findFirst.mockResolvedValue(null);

    const result = await generatePrediction(7, detection, predictedAt);

    expect(txMock.prediction.create).not.toHaveBeenCalled();

    expect(txMock.alert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        predictionId: 100,
        deviceId: 7,
        acknowledged: false,
        severity: "critical",
      }),
    });

    // A duplicate prediction is not returned or emitted again.
    expect(result?.prediction).toBeNull();
    expect(result?.alert).toMatchObject({ id: 201 });
    expect(emitMonitoringUpdateMock).toHaveBeenCalledTimes(1);
    expect(emitMonitoringUpdateMock).toHaveBeenCalledWith({
      type: "alert.created",
      deviceId: 7,
      entityId: 201,
    });
  });
  it("creates an alert when risk rises from low to high during one episode", async () => {
    txMock.fault.findFirst.mockImplementation(async ({ where }) =>
      where.status === "resolved" ? null : activeFault,
    );

    const lowRiskDetection = {
      ...detection,
      riskScore: 0.3,
    };

    // First call creates prediction 101; second call finds it.
    txMock.prediction.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 101 });

    const firstResult = await generatePrediction(
      7,
      lowRiskDetection,
      predictedAt,
    );

    expect(firstResult?.prediction.status).toBe("confirmed");
    expect(firstResult?.alert).toBeNull();
    expect(txMock.alert.create).not.toHaveBeenCalled();

    const secondResult = await generatePrediction(
      7,
      detection,
      new Date(predictedAt.getTime() + 60_000),
    );

    expect(txMock.prediction.create).toHaveBeenCalledTimes(1);
    expect(txMock.alert.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        predictionId: 101,
        deviceId: 7,
        acknowledged: false,
      }),
    });

    expect(secondResult?.prediction).toBeNull();
    expect(secondResult?.alert).toMatchObject({ id: 201 });

    expect(emitMonitoringUpdateMock).toHaveBeenCalledTimes(2);
  });

  it("does not recreate an acknowledged alert during the same active episode", async () => {
    txMock.fault.findFirst.mockImplementation(async ({ where }) =>
      where.status === "resolved" ? null : activeFault,
    );
    txMock.alert.findFirst.mockResolvedValue({ id: 55 });

    const result = await generatePrediction(7, detection, predictedAt);

    expect(result?.prediction.status).toBe("confirmed");
    expect(txMock.alert.create).not.toHaveBeenCalled();
  });

  it("suppresses forecasts during the recovery horizon after a fault resolves", async () => {
    txMock.fault.findFirst.mockImplementation(async ({ where }) =>
      where.status === "resolved" ? { id: 12 } : null,
    );

    const result = await generatePrediction(7, forecast, predictedAt);

    expect(result).toBeNull();
    expect(txMock.prediction.create).not.toHaveBeenCalled();
  });

  it("suppresses a forecast after a different fault type has recently resolved", async () => {
    txMock.fault.findFirst.mockImplementation(async ({ where }) => {
      if (where.status === "resolved") return { id: 12 };
      return null;
    });

    const result = await generatePrediction(7, forecast, predictedAt);

    expect(result).toBeNull();
    expect(txMock.prediction.create).not.toHaveBeenCalled();
    expect(emitMonitoringUpdateMock).not.toHaveBeenCalled();
  });

  it("deduplicates forecasts within the configured prediction horizon", async () => {
    txMock.prediction.findFirst.mockResolvedValue({ id: 99 });

    const result = await generatePrediction(7, forecast, predictedAt);

    expect(result).toBeNull();
    expect(txMock.prediction.create).not.toHaveBeenCalled();
  });

  it("serializes concurrent scoring so only one forecast is created for a horizon", async () => {
    let predictionWasCreated = false;
    txMock.prediction.findFirst.mockImplementation(async () =>
      predictionWasCreated ? { id: 100 } : null,
    );
    txMock.prediction.create.mockImplementation(async ({ data }) => {
      predictionWasCreated = true;
      return { id: 101, ...data };
    });

    const results = await Promise.all([
      generatePrediction(7, forecast, predictedAt),
      generatePrediction(7, forecast, predictedAt),
    ]);

    expect(txMock.prediction.create).toHaveBeenCalledTimes(1);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("suppresses concurrent forecasts of different types while a fault is active", async () => {
    txMock.fault.findFirst.mockImplementation(async ({ where }) =>
      where.status === "resolved" ? null : activeFault,
    );

    const deviceFailureForecast = {
      ...forecast,
      faultType: "device_failure" as const,
      explanationText: "Forecast: device failure risk increasing.",
    };

    const results = await Promise.all([
      generatePrediction(7, forecast, predictedAt),
      generatePrediction(7, deviceFailureForecast, predictedAt),
    ]);

    expect(results).toEqual([null, null]);
    expect(txMock.prediction.create).not.toHaveBeenCalled();
    expect(txMock.alert.create).not.toHaveBeenCalled();
    expect(emitMonitoringUpdateMock).not.toHaveBeenCalled();
  });
});
