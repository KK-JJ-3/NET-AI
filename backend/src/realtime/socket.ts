import type { Server as HttpServer } from "node:http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";

import { env } from "../config/env.js";

export type MonitoringUpdateType =
  | "telemetry.created"
  | "prediction.created"
  | "prediction.evaluated"
  | "alert.created"
  | "alert.acknowledged"
  | "fault.created"
  | "fault.resolved";

export interface MonitoringUpdate {
  type: MonitoringUpdateType;
  deviceId?: number;
  entityId?: number | bigint | string;
  occurredAt: string;
}

let socketServer: Server | null = null;

export function attachRealtime(httpServer: HttpServer): Server {
  const frontendOrigin =
    process.env.FRONTEND_URL?.trim() || "http://localhost:5173";

  const io = new Server(httpServer, {
    cors: {
      origin: frontendOrigin,
      methods: ["GET", "POST"],
    },
  });

  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    if (typeof token !== "string" || !token) {
      next(new Error("Authentication required"));
      return;
    }

    try {
      const decoded = jwt.verify(token, env.jwtSecret);

      if (
        typeof decoded !== "object" ||
        decoded === null ||
        typeof decoded.userId !== "number" ||
        typeof decoded.username !== "string" ||
        typeof decoded.role !== "string"
      ) {
        next(new Error("Invalid token payload"));
        return;
      }

      socket.data.user = {
        userId: decoded.userId,
        username: decoded.username,
        role: decoded.role,
      };
      next();
    } catch {
      next(new Error("Invalid or expired token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`Realtime client connected (${socket.id})`);
    socket.on("disconnect", (reason) => {
      console.log(`Realtime client disconnected (${socket.id}): ${reason}`);
    });
  });

  socketServer = io;
  return io;
}

/**
 * Publish a small invalidation event. Clients should re-fetch authoritative
 * records from the REST API rather than treating socket payloads as database state.
 */
export function emitMonitoringUpdate(
  update: Omit<MonitoringUpdate, "occurredAt">,
): void {
  const payload = {
    ...update,
    entityId:
      update.entityId === undefined ? undefined : String(update.entityId),
    occurredAt: new Date().toISOString(),
  };

  socketServer?.emit("monitoring:update", payload);
}

export async function closeRealtime(): Promise<void> {
  const io = socketServer;
  socketServer = null;

  if (!io) return;

  await new Promise<void>((resolve) => {
    io.close(() => resolve());
  });
}
