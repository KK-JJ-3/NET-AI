import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, txMock } = vi.hoisted(() => {
  const txMock = {
    predictionOutcome: {
      create: vi.fn(),
    },
    prediction: {
      update: vi.fn(),
    },
  };

  return {
    txMock,
    prismaMock: {
      prediction: {
        findUnique: vi.fn(),
      },
      fault: {
        findFirst: vi.fn(),
      },
      $transaction: vi.fn(),
    },
  };
});

vi.mock("../src/config/database.js", () => ({
  default: prismaMock,
}));

vi.mock("../src/realtime/socket.js", () => ({
  emitMonitoringUpdate: vi.fn(),
}));

import { evaluatePrediction } from "../src/services/predictionOutcomeService.js";

describe("evaluatePrediction", () => {
  const predictedAt = new Date("2026-10-18T10:00:00.000Z");
  const windowEnd = new Date("2026-10-18T10:30:00.000Z");
  const referenceTime = new Date("2026-10-18T10:31:00.000Z");

  const prediction = {
    id: 1,
    deviceId: 10,
    faultType: "congestion",
    predictedWindowMinutes: 30,
    predictedAt,
    status: "pending",
    outcomes: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();

    prismaMock.prediction.findUnique.mockResolvedValue(prediction);
    prismaMock.fault.findFirst.mockResolvedValue(null);

    txMock.predictionOutcome.create.mockImplementation(async ({ data }) => ({
      id: 100,
      ...data,
    }));

    txMock.prediction.update.mockResolvedValue({ id: 1 });

    prismaMock.$transaction.mockImplementation(async (callback) =>
      callback(txMock),
    );
  });

  it("confirms a prediction when a matching fault starts inside its window", async () => {
    prismaMock.fault.findFirst.mockResolvedValue({
      id: 20,
      deviceId: 10,
      faultType: "congestion",
      startedAt: new Date("2026-10-18T10:15:00.000Z"),
      status: "confirmed",
    });

    const result = await evaluatePrediction(1, referenceTime);

    expect(result.result).toBe("confirmed");
    expect(result.faultId).toBe(20);

    expect(txMock.prediction.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: "confirmed" },
    });
  });

  it("does not count a fault at the exact prediction timestamp as a forecast", async () => {
    const result = await evaluatePrediction(1, referenceTime);

    expect(result.result).toBe("false_positive");

    expect(prismaMock.fault.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          startedAt: {
            gt: predictedAt,
            lte: windowEnd,
          },
        }),
      }),
    );
  });

  it("rejects evaluation before the prediction window expires", async () => {
    await expect(
      evaluatePrediction(1, new Date("2026-10-18T10:20:00.000Z")),
    ).rejects.toThrow("Prediction window has not expired");

    expect(txMock.predictionOutcome.create).not.toHaveBeenCalled();
  });

  it("rejects a prediction that already has an outcome", async () => {
    prismaMock.prediction.findUnique.mockResolvedValue({
      ...prediction,
      outcomes: [{ id: 100 }],
    });

    await expect(evaluatePrediction(1, referenceTime)).rejects.toThrow(
      "already been evaluated",
    );
  });
});
