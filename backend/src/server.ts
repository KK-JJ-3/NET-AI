import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import helmet from "helmet";
import morgan from "morgan";

import prisma from "./config/database.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan("dev"));

// Root
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    message: "Welcome to NetFault AI API",
  });
});

// Health check
app.get("/api/health", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      success: true,
      server: "ok",
      database: "connected",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(503).json({
      success: false,
      server: "ok",
      database: "disconnected",
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`NetFault AI backend running on http://localhost:${PORT}`);
});
