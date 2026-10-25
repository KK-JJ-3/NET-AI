import "dotenv/config";

import { createServer } from "node:http";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";

import prisma from "./config/database.js";
import { env } from "./config/env.js";
import { sendSuccess, sendError } from "./utils/apiResponse.js";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.js";
import deviceRoutes from "./routes/deviceRoutes.js";
import interfaceRoutes from "./routes/interfaceRoutes.js";
import telemetryRoutes from "./routes/telemetryRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import predictionRoutes from "./routes/predictionRoutes.js";
import faultRoutes from "./routes/faultRoutes.js";
import alertRoutes from "./routes/alertRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import {
  startPredictionOutcomeScheduler,
  stopPredictionOutcomeScheduler,
} from "./services/predictionOutcomeScheduler.js";
import { attachRealtime, closeRealtime } from "./realtime/socket.js";

const app = express();
const PORT = env.port;

// Middleware
app.use(helmet());
const allowedOrigins = env.frontendUrl
  .split(",")
  .map((origin) => origin.trim().replace(/\/$/, ""))
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin.replace(/\/$/, ""))) {
        return callback(null, true);
      }

      return callback(null, false);
    },
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// Root
app.get("/", (_req, res) => {
  return sendSuccess(res, {
    message: "Welcome to NetFault AI API",
  });
});

// Health check
app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    let aiService = "unavailable";
    const aiServiceUrl = (
      process.env.AI_SERVICE_URL || "http://localhost:8000"
    ).replace(/\/$/, "");
    try {
      const response = await fetch(`${aiServiceUrl}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      const health = await response.json();
      aiService =
        response.ok && health?.status === "ok" ? "connected" : "unavailable";
    } catch {
      // Keep API/database health independent from AI-service availability.
    }

    return sendSuccess(res, {
      server: "ok",
      database: "connected",
      aiService,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    return sendError(res, "Database connection failed", 503);
  }
});

// Auth routes
app.use("/api/auth", authRoutes);

// Device routes
app.use("/api/devices", deviceRoutes);

// Interface routes
app.use("/api/interfaces", interfaceRoutes);

// Telemetry routes
app.use("/api/telemetry", telemetryRoutes);

// Prediction routes
app.use("/api/predictions", predictionRoutes);

// Fault routes
app.use("/api/faults", faultRoutes);

// Alert routes
app.use("/api/alerts", alertRoutes);

// Dashboard routes
app.use("/api/dashboard", dashboardRoutes);

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Attach Socket.IO to the same HTTP server as Express.
const httpServer = createServer(app);
attachRealtime(httpServer);

// Graceful shutdown
let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  console.log(`${signal} received. Shutting down NetFault AI backend...`);

  stopPredictionOutcomeScheduler();

  const forceShutdownTimer = setTimeout(() => {
    console.error("Graceful shutdown timed out.");
    process.exit(1);
  }, 10_000);

  forceShutdownTimer.unref();

  try {
    await closeRealtime();
    await prisma.$disconnect();

    console.log("NetFault AI backend shut down cleanly.");
    process.exitCode = 0;
  } catch (error) {
    console.error("Error during backend shutdown:", error);
    process.exitCode = 1;
  } finally {
    clearTimeout(forceShutdownTimer);
  }
}

process.once("SIGINT", () => {
  void shutdown("SIGINT");
});

process.once("SIGTERM", () => {
  void shutdown("SIGTERM");
});

// Start server
httpServer.listen(PORT, () => {
  console.log(`NetFault AI backend running on http://localhost:${PORT}`);
  console.log("Socket.IO realtime transport initialized.");

  try {
    startPredictionOutcomeScheduler();
  } catch (error) {
    console.error("Failed to start prediction outcome scheduler:", error);
    void shutdown("SCHEDULER_STARTUP_FAILURE");
  }
});
