import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";

import prisma from "./config/database.js";
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

dotenv.config();
import { env } from "./config/env.js";

const app = express();
const PORT = env.port;

// Middleware
app.use(helmet());
app.use(cors());
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

    return sendSuccess(res, {
      server: "ok",
      database: "connected",
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

// Start server
app.listen(PORT, () => {
  console.log(`NetFault AI backend running on http://localhost:${PORT}`);
});
