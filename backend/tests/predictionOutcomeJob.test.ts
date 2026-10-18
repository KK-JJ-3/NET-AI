import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, evaluatePredictionMock } = vi.hoisted(() => ({
  prismaMock: {
    prediction: {
      findMany: vi.fn(),
    },
    telemetry: {
      findFirst: vi.fn(),
    },
    fault: {
      findFirst: vi.fn(),
    },
  },
  evaluatePredictionMock: vi.fn(),
}));

vi.mock("../src/config/database.js", () => ({
  default: prismaMock,
}));

vi.mock("../src/services/predictionOutcomeService.js", () => ({
  evaluatePrediction: evaluatePredictionMock,
}));

import { runPredictionOutcomeJob } from "../src/services/predictionOutcomeJob.js";

describe("runPredictionOutcomeJob", () => {
  const predictedAt = new Date("2026-10-18T10:00:00.000Z");

  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.prediction.findMany.mockResolvedValue([
      {
        id: 1,
        deviceId: 10,
        faultType: "congestion",
        predictedAt,
        predictedWindowMinutes: 30,
      },
    ]);

    prismaMock.telemetry.findFirst.mockResolvedValue({
      recordedAt: new Date("2026-10-18T10:31:00.000Z"),
    });

    prismaMock.fault.findFirst.mockResolvedValue(null);

    evaluatePredictionMock.mockResolvedValue({
      predictionId: 1,
      result: "confirmed",
    });
  });

  it("evaluates an expired prediction using the latest telemetry timestamp", async () => {
    const result = await runPredictionOutcomeJob();

    expect(evaluatePredictionMock).toHaveBeenCalledWith(
      1,
      new Date("2026-10-18T10:31:00.000Z"),
    );
    expect(result.evaluated).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.skippedActiveFault).toBe(0);
  });

  it("does not evaluate when telemetry has not reached the prediction window end", async () => {
    prismaMock.telemetry.findFirst.mockResolvedValue({
      recordedAt: new Date("2026-10-18T10:20:00.000Z"),
    });

    const result = await runPredictionOutcomeJob();

    expect(evaluatePredictionMock).not.toHaveBeenCalled();
    expect(prismaMock.fault.findFirst).not.toHaveBeenCalled();
    expect(result.expired).toBe(0);
    expect(result.evaluated).toBe(0);
  });

  it("uses an explicit reference time for deterministic evaluation", async () => {
    const referenceTime = new Date("2026-10-18T10:31:00.000Z");

    await runPredictionOutcomeJob(referenceTime);

    expect(prismaMock.telemetry.findFirst).not.toHaveBeenCalled();
    expect(evaluatePredictionMock).toHaveBeenCalledWith(1, referenceTime);
  });

  it("does not evaluate predictions for devices without telemetry", async () => {
    prismaMock.telemetry.findFirst.mockResolvedValue(null);

    const result = await runPredictionOutcomeJob();

    expect(evaluatePredictionMock).not.toHaveBeenCalled();
    expect(result.expired).toBe(0);
    expect(result.evaluated).toBe(0);
  });

  it("skips a prediction when the same fault was already active at prediction time", async () => {
    prismaMock.fault.findFirst.mockResolvedValue({ id: 12 });

    const result = await runPredictionOutcomeJob();

    expect(prismaMock.fault.findFirst).toHaveBeenCalledWith({
      where: {
        deviceId: 10,
        faultType: "congestion",
        startedAt: { lte: predictedAt },
        OR: [{ resolvedAt: null }, { resolvedAt: { gt: predictedAt } }],
      },
      select: { id: true },
    });

    expect(evaluatePredictionMock).not.toHaveBeenCalled();
    expect(result.evaluated).toBe(0);
    expect(result.skippedActiveFault).toBe(1);
    expect(result.failed).toBe(0);
  });
});
