import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    fault: { findMany: vi.fn() },
    prediction: { findMany: vi.fn() },
  },
}));

vi.mock("../src/config/database.js", () => ({ default: prismaMock }));

import { findMissedFaults } from "../src/services/missedFaultService.js";

describe("findMissedFaults", () => {
  const faultTime = new Date("2026-10-18T10:30:00.000Z");
  const forecastAt1025 = new Date("2026-10-18T10:25:00.000Z");
  const forecastAt1015 = new Date("2026-10-18T10:15:00.000Z");
  const forecastAt1005 = new Date("2026-10-18T10:05:00.000Z");

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

  const forecast = (
    id: number,
    predictedAt: Date,
    predictedWindowMinutes: number,
    explanationText = "Forecast: fault risk increasing.",
  ) => ({ id, predictedAt, predictedWindowMinutes, explanationText });

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.fault.findMany.mockResolvedValue(faults);
  });

  it("counts a matching forecast generated within its own horizon", async () => {
    prismaMock.prediction.findMany
      .mockResolvedValueOnce([forecast(50, forecastAt1025, 10)])
      .mockResolvedValueOnce([]);
    const result = await findMissedFaults();
    expect(result.map((fault) => fault.id)).toEqual([2]);
  });

  it("does not count a forecast older than its own horizon even if within 30 minutes", async () => {
    prismaMock.prediction.findMany
      .mockResolvedValueOnce([forecast(50, forecastAt1015, 10)])
      .mockResolvedValueOnce([]);
    const result = await findMissedFaults();
    expect(result.map((fault) => fault.id)).toEqual([1, 2]);
  });

  it("counts an older forecast when its own horizon is long enough", async () => {
    prismaMock.prediction.findMany
      .mockResolvedValueOnce([forecast(50, forecastAt1005, 30)])
      .mockResolvedValueOnce([]);
    const result = await findMissedFaults();
    expect(result.map((fault) => fault.id)).toEqual([2]);
  });

  it("does not count a rule-based detection as an earlier forecast", async () => {
    prismaMock.prediction.findMany
      .mockResolvedValueOnce([
        forecast(
          50,
          forecastAt1025,
          10,
          "[RULE_BASED] Active network congestion detected.",
        ),
      ])
      .mockResolvedValueOnce([]);
    const result = await findMissedFaults();
    expect(result.map((fault) => fault.id)).toEqual([1, 2]);
  });

  it("recognizes the explicit active-fault detection marker", async () => {
    prismaMock.prediction.findMany
      .mockResolvedValueOnce([
        forecast(
          50,
          forecastAt1025,
          10,
          "[ACTIVE_FAULT_DETECTION] Active network congestion detected.",
        ),
      ])
      .mockResolvedValueOnce([]);
    const result = await findMissedFaults();
    expect(result.map((fault) => fault.id)).toEqual([1, 2]);
  });

  it("counts a fault as forecast when both a detection and a valid forecast exist", async () => {
    prismaMock.prediction.findMany
      .mockResolvedValueOnce([
        forecast(
          50,
          forecastAt1025,
          10,
          "[RULE_BASED] Active network congestion detected.",
        ),
        forecast(
          51,
          forecastAt1025,
          10,
          "Forecast: congestion risk increasing.",
        ),
      ])
      .mockResolvedValueOnce([]);
    const result = await findMissedFaults();
    expect(result.map((fault) => fault.id)).toEqual([2]);
  });

  it("queries only predictions before onset and selects each prediction's horizon", async () => {
    prismaMock.prediction.findMany.mockResolvedValue([]);
    await findMissedFaults();
    expect(prismaMock.prediction.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({
          deviceId: 10,
          faultType: "congestion",
          predictedAt: { lt: faultTime },
        }),
        select: {
          id: true,
          explanationText: true,
          predictedAt: true,
          predictedWindowMinutes: true,
        },
      }),
    );
  });

  it("marks all faults missed when no earlier matching forecasts exist", async () => {
    prismaMock.prediction.findMany.mockResolvedValue([]);
    const result = await findMissedFaults();
    expect(result.map((fault) => fault.id)).toEqual([1, 2]);
  });
});
