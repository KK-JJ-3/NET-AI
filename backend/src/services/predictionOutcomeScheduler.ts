import { runPredictionOutcomeJob } from "./predictionOutcomeJob.js";

const DEFAULT_INTERVAL_MS = 60_000;

let schedulerTimer: NodeJS.Timeout | null = null;

export function startPredictionOutcomeScheduler(): void {
  if (schedulerTimer) {
    console.log("Prediction outcome scheduler is already running.");
    return;
  }

  const intervalMs = Number(
    process.env.PREDICTION_OUTCOME_INTERVAL_MS ?? DEFAULT_INTERVAL_MS,
  );

  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("PREDICTION_OUTCOME_INTERVAL_MS must be a positive number");
  }

  console.log(
    `Prediction outcome scheduler started. Interval: ${intervalMs}ms`,
  );

  schedulerTimer = setInterval(async () => {
    try {
      const result = await runPredictionOutcomeJob();

      if (result.evaluated > 0 || result.failed > 0) {
        console.log("Prediction outcome job completed:", result);
      }
    } catch (error) {
      console.error("Prediction outcome scheduler failed:", error);
    }
  }, intervalMs);
}

export function stopPredictionOutcomeScheduler(): void {
  if (!schedulerTimer) {
    return;
  }

  clearInterval(schedulerTimer);
  schedulerTimer = null;

  console.log("Prediction outcome scheduler stopped.");
}
