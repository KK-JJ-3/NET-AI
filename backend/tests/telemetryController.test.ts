import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("../src/config/database.js", () => ({
  default: {
    device: { findUnique: vi.fn() },
    interface: { findUnique: vi.fn() },
    telemetry: {
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../src/services/aiServiceClient.js", () => ({
  predictFault: vi.fn(),
}));

vi.mock("../src/services/predictionGenerationService.js", () => ({
  generatePrediction: vi.fn(),
}));

vi.mock("../src/realtime/socket.js", () => ({
  emitMonitoringUpdate: vi.fn(),
}));

import prisma from "../src/config/database.js";
import { createTelemetry } from "../src/controllers/telemetryController.js";

const db = prisma as unknown as {
  device: { findUnique: ReturnType<typeof vi.fn> };
  interface: { findUnique: ReturnType<typeof vi.fn> };
  telemetry: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
  };
};

type StoredTelemetry = {
  id: number;
  deviceId: number;
  interfaceId: number | null;
  recordedAt: Date;
  latencyMs: number;
  packetLossPct: number;
  jitterMs: number;
  utilizationPct: number;
  cpuPct: number;
  memoryPct: number;
  availability: boolean;
  scenarioLabel: string;
};

const deviceId = 1;
const interfaceId = 1;
const recordedAt = "2026-10-23T12:00:00.000Z";
let stored: StoredTelemetry[];
let nextId: number;

function makeBody(overrides: Partial<StoredTelemetry> = {}) {
  return {
    deviceId,
    interfaceId: null as number | null,
    recordedAt,
    latencyMs: 25,
    packetLossPct: 0.2,
    jitterMs: 2,
    utilizationPct: 35,
    cpuPct: 30,
    memoryPct: 45,
    availability: true,
    scenarioLabel: "normal",
    ...overrides,
  };
}

async function postTelemetry(body: ReturnType<typeof makeBody>) {
  let statusCode = 200;
  let responseBody: unknown;
  const res = {
    status(code: number) {
      statusCode = code;
      return this;
    },
    json(bodyValue: unknown) {
      responseBody = bodyValue;
      return this;
    },
  } as unknown as Response;

  await createTelemetry({ body } as Request, res);
  return { statusCode, responseBody };
}

beforeEach(() => {
  vi.clearAllMocks();
  stored = [];
  nextId = 1;

  db.device.findUnique.mockResolvedValue({
    id: deviceId,
    name: "Core-Router-01",
  });
  db.interface.findUnique.mockImplementation(async ({ where }) =>
    where.id === interfaceId ? { id: interfaceId, deviceId } : null,
  );
  db.telemetry.findFirst.mockImplementation(async ({ where }) => {
    const match = stored.find(
      (row) =>
        row.deviceId === where.deviceId &&
        row.interfaceId === (where.interfaceId ?? null) &&
        row.recordedAt.getTime() === new Date(where.recordedAt).getTime(),
    );
    return match ? { id: match.id } : null;
  });
  db.telemetry.create.mockImplementation(async ({ data }) => {
    const row: StoredTelemetry = {
      id: nextId++,
      ...data,
      interfaceId: data.interfaceId ?? null,
      recordedAt: new Date(data.recordedAt),
    };
    stored.push(row);
    return row;
  });
  db.telemetry.count.mockImplementation(
    async ({ where }) =>
      stored.filter((row) => row.deviceId === where.deviceId).length,
  );
  db.telemetry.findMany.mockResolvedValue([]);
});

describe("createTelemetry duplicate detection (B3)", () => {
  it("allows a device-level and an interface-level reading at the same timestamp", async () => {
    const deviceReading = await postTelemetry(makeBody({ interfaceId: null }));
    const interfaceReading = await postTelemetry(makeBody({ interfaceId }));

    expect(deviceReading.statusCode).toBe(201);
    expect(interfaceReading.statusCode).toBe(201);
    expect(stored).toHaveLength(2);
    expect(stored.map((row) => row.interfaceId)).toEqual([null, interfaceId]);
  });

  it("rejects a duplicate for the same device, interface, and timestamp", async () => {
    const first = await postTelemetry(makeBody({ interfaceId }));
    const duplicate = await postTelemetry(makeBody({ interfaceId }));

    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(409);
    expect(stored).toHaveLength(1);
  });

  it("rejects a duplicate device-level reading at the same timestamp", async () => {
    const first = await postTelemetry(makeBody({ interfaceId: null }));
    const duplicate = await postTelemetry(makeBody({ interfaceId: null }));

    expect(first.statusCode).toBe(201);
    expect(duplicate.statusCode).toBe(409);
    expect(stored).toHaveLength(1);
  });
});
