import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../src/config/database.js", () => ({
  default: {
    device: { findUnique: vi.fn() },
    telemetry: { findFirst: vi.fn() },
  },
}));

import prisma from "../src/config/database.js";
import { getLatestDeviceTelemetry } from "../src/controllers/deviceController.js";

const db = prisma as unknown as {
  device: { findUnique: ReturnType<typeof vi.fn> };
  telemetry: { findFirst: ReturnType<typeof vi.fn> };
};

async function getLatest(deviceId: string | number) {
  let statusCode = 200;
  let responseBody: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(body: unknown) {
      responseBody = body;
      return this;
    },
  } as unknown as Response;

  await getLatestDeviceTelemetry(
    { params: { id: String(deviceId) } } as unknown as Request,
    res,
  );

  return { statusCode, responseBody };
}

beforeEach(() => {
  vi.clearAllMocks();
  db.device.findUnique.mockResolvedValue({ id: 1 });
  db.telemetry.findFirst.mockResolvedValue({
    recordedAt: new Date("2026-10-24T12:00:00.000Z"),
  });
});

describe("getLatestDeviceTelemetry", () => {
  it("returns the latest recorded timestamp for a device", async () => {
    const result = await getLatest(1);

    expect(result.statusCode).toBe(200);
    expect(db.telemetry.findFirst).toHaveBeenCalledWith({
      where: { deviceId: 1 },
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      select: { recordedAt: true },
    });
    expect(result.responseBody).toEqual({
      data: {
        deviceId: 1,
        latestRecordedAt: "2026-10-24T12:00:00.000Z",
      },
      error: null,
    });
  });

  it("returns null when the device has no telemetry", async () => {
    db.telemetry.findFirst.mockResolvedValue(null);

    const result = await getLatest(1);

    expect(result.statusCode).toBe(200);
    expect(result.responseBody).toEqual({
      data: { deviceId: 1, latestRecordedAt: null },
      error: null,
    });
  });

  it("rejects an invalid device ID", async () => {
    const result = await getLatest("abc");

    expect(result.statusCode).toBe(400);
    expect(db.device.findUnique).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown device", async () => {
    db.device.findUnique.mockResolvedValue(null);

    const result = await getLatest(99);

    expect(result.statusCode).toBe(404);
    expect(db.telemetry.findFirst).not.toHaveBeenCalled();
  });
});
