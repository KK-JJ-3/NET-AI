import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    fault: {
      findMany: vi.fn(),
    },
    prediction: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../src/config/database.js", () => ({
  default: prismaMock,
}));

import { findMissedFaults } from "../src/services/missedFaultService.js";

describe("findMissedFaults", () => {
  const faultTime = new Date("2026-10-18T10:30:00.000Z");

  const faults = [
    {
      id: 1,
      deviceId: 10,
      faultType: "congestion",
      startedAt: faultTime,
      status: "confirmed",
    },
    {
      id: 2,
      deviceId: 11,
      faultType: "device_failure",
      startedAt: faultTime,
      status: "resolved",
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.fault.findMany.mockResolvedValue(faults);
  });

  it("does not mark a fault missed when a matching earlier forecast exists", async () => {
    prismaMock.prediction.findMany
      .mockResolvedValueOnce([
        { id: 50, explanationText: "Forecast: congestion risk increasing." },
      ])
      .mockResolvedValueOnce([]);

    const result = await findMissedFaults();

    expect(result.map((fault) => fault.id)).toEqual([2]);
  });

  it("does not count a rule-based detection as an earlier forecast", async () => {
    prismaMock.prediction.findMany
      .mockResolvedValueOnce([
        {
          id: 50,
          explanationText: "[RULE_BASED] Active network congestion detected.",
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await findMissedFaults();

    expect(result.map((fault) => fault.id)).toEqual([1, 2]);
  });

  it("counts a fault as forecast when both rule-based and forecast predictions exist", async () => {
    prismaMock.prediction.findMany
      .mockResolvedValueOnce([
        {
          id: 50,
          explanationText: "[RULE_BASED] Active network congestion detected.",
        },
        {
          id: 51,
          explanationText: "Forecast: congestion risk increasing.",
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await findMissedFaults();

    expect(result.map((fault) => fault.id)).toEqual([2]);
  });

  it("uses a fixed 30-minute lookback and excludes predictions at fault onset", async () => {
    prismaMock.prediction.findMany.mockResolvedValue([]);

    await findMissedFaults();

    expect(prismaMock.prediction.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          deviceId: 10,
          faultType: "congestion",
          predictedAt: {
            gte: new Date("2026-10-18T10:00:00.000Z"),
            lt: faultTime,
          },
        }),
      }),
    );
  });

  it("marks all faults missed when no earlier matching predictions exist", async () => {
    prismaMock.prediction.findMany.mockResolvedValue([]);

    const result = await findMissedFaults();

    expect(result.map((fault) => fault.id)).toEqual([1, 2]);
  });
});
