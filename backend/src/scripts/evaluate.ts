import prisma from "../config/database.js";

type OutcomeRecord = {
  outcome: "confirmed" | "false_positive";
  evaluatedAt: Date;
  prediction: {
    id: number;
    deviceId: number;
    faultType: string;
    predictedAt: Date;
    predictedWindowMinutes: number;
    explanationText: string;
  };
  fault: {
    id: number;
    deviceId: number;
    faultType: string;
    startedAt: Date;
  } | null;
};

const ACTIVE_DETECTION_TAG = "[ACTIVE_FAULT_DETECTION]";

function ratio(numerator: number, denominator: number): number | null {
  return denominator === 0 ? null : numerator / denominator;
}

function metric(value: number | null): string {
  return value === null ? "N/A" : `${(value * 100).toFixed(1)}%`;
}

function classificationMetrics(tp: number, fp: number, fn: number) {
  const precision = ratio(tp, tp + fp);
  const recall = ratio(tp, tp + fn);
  const f1 =
    precision === null || recall === null || precision + recall === 0
      ? precision === 0 && recall === 0
        ? 0
        : null
      : (2 * precision * recall) / (precision + recall);

  return {
    truePositives: tp,
    falsePositives: fp,
    falseNegatives: fn,
    precision,
    recall,
    f1,
    falsePositiveRate: ratio(fp, tp + fp),
  };
}

async function main() {
  const [outcomes, faults, predictions] = (await Promise.all([
    prisma.predictionOutcome.findMany({
      orderBy: { evaluatedAt: "asc" },
      select: {
        outcome: true,
        evaluatedAt: true,
        prediction: {
          select: {
            id: true,
            deviceId: true,
            faultType: true,
            predictedAt: true,
            predictedWindowMinutes: true,
            explanationText: true,
          },
        },
        fault: {
          select: {
            id: true,
            deviceId: true,
            faultType: true,
            startedAt: true,
          },
        },
      },
    }),
    prisma.fault.findMany({
      where: { status: { in: ["confirmed", "resolved"] } },
      orderBy: { startedAt: "asc" },
      select: {
        id: true,
        deviceId: true,
        faultType: true,
        startedAt: true,
        resolvedAt: true,
      },
    }),
    prisma.prediction.findMany({
      orderBy: { predictedAt: "asc" },
      select: {
        id: true,
        deviceId: true,
        faultType: true,
        status: true,
        predictedAt: true,
        explanationText: true,
      },
    }),
  ])) as [
    OutcomeRecord[],
    Array<{
      id: number;
      deviceId: number;
      faultType: string;
      startedAt: Date;
      resolvedAt: Date | null;
    }>,
    Array<{
      id: number;
      deviceId: number;
      faultType: string;
      status: string;
      predictedAt: Date;
      explanationText: string;
    }>,
  ];

  const forecastOutcomes = outcomes.filter(
    (row) => !row.prediction.explanationText.includes(ACTIVE_DETECTION_TAG),
  );
  const forecastTp = forecastOutcomes.filter(
    (row) => row.outcome === "confirmed",
  ).length;
  const forecastFp = forecastOutcomes.filter(
    (row) => row.outcome === "false_positive",
  ).length;

  // A fault is covered by a forecast only when the outcome linked that exact fault.
  const forecastCoveredFaultIds = new Set(
    forecastOutcomes
      .filter((row) => row.outcome === "confirmed" && row.fault)
      .map((row) => row.fault!.id),
  );
  const forecastFaults = faults.filter((fault) =>
    forecastOutcomes.some(
      (row) =>
        row.prediction.deviceId === fault.deviceId &&
        row.prediction.faultType === fault.faultType &&
        fault.startedAt >= row.prediction.predictedAt &&
        fault.startedAt <=
          new Date(
            row.prediction.predictedAt.getTime() +
              row.prediction.predictedWindowMinutes * 60_000,
          ),
    ),
  );
  const forecastFn = forecastFaults.filter(
    (fault) => !forecastCoveredFaultIds.has(fault.id),
  ).length;

  const leadTimes = forecastOutcomes
    .filter((row) => row.outcome === "confirmed" && row.fault)
    .map(
      (row) =>
        (row.fault!.startedAt.getTime() -
          row.prediction.predictedAt.getTime()) /
        60_000,
    )
    .filter((minutes) => minutes >= 0);
  const averageLeadMinutes =
    leadTimes.length === 0
      ? null
      : leadTimes.reduce((sum, value) => sum + value, 0) / leadTimes.length;

  const detections = predictions.filter((prediction) =>
    prediction.explanationText.includes(ACTIVE_DETECTION_TAG),
  );
  const detectionTpIds = new Set<number>();
  const matchedFaultIds = new Set<number>();
  let detectionFp = 0;

  for (const detection of detections) {
    const match = faults.find(
      (fault) =>
        fault.deviceId === detection.deviceId &&
        fault.faultType === detection.faultType &&
        fault.startedAt <= detection.predictedAt &&
        (fault.resolvedAt === null ||
          fault.resolvedAt >= detection.predictedAt),
    );
    if (match) {
      detectionTpIds.add(detection.id);
      matchedFaultIds.add(match.id);
    } else {
      detectionFp += 1;
    }
  }
  const detectionFn = faults.filter(
    (fault) => !matchedFaultIds.has(fault.id),
  ).length;
  const evaluatedAt = new Date().toISOString();

  const report = {
    title: "NetFault AI live evaluation report",
    evaluatedAt,
    dataset: {
      source: "Current database records",
      syntheticData: true,
      note: "Simulator-generated records are synthetic. Results are not a production reliability estimate.",
      actualFaultRecords: faults.length,
      storedPredictions: predictions.length,
      evaluatedForecasts: forecastOutcomes.length,
      activeDetectionPredictions: detections.length,
    },
    forecasts: {
      definition:
        "Forecast predictions evaluated by the outcome job; active-fault detections are excluded.",
      ...classificationMetrics(forecastTp, forecastFp, forecastFn),
      averageLeadTimeMinutes: averageLeadMinutes,
      leadTimeSamples: leadTimes.length,
      missedFaults: forecastFn,
    },
    activeDetections: {
      definition:
        "Predictions tagged ACTIVE_FAULT_DETECTION matched to a recorded fault active at prediction time.",
      truePositives: detectionTpIds.size,
      falsePositives: detectionFp,
      falseNegatives: detectionFn,
      precision: ratio(detectionTpIds.size, detectionTpIds.size + detectionFp),
      recall: ratio(detectionTpIds.size, detectionTpIds.size + detectionFn),
      f1: classificationMetrics(detectionTpIds.size, detectionFp, detectionFn)
        .f1,
      missedFaults: detectionFn,
    },
    caveats: [
      "Metrics are computed from current database records and the stored outcome labels.",
      "The forecast false-positive rate here is FP / (TP + FP), i.e. the false-discovery proportion among evaluated forecasts; true-negative telemetry windows are not stored as forecast outcomes, so a conventional FPR cannot be calculated.",
      "Forecast missed faults count recorded faults that fell within at least one evaluated forecast window but were not linked to a confirmed forecast outcome. Faults outside all evaluated windows are not counted in this forecast FN value.",
      "Detection matching requires same device and fault type and the fault to be active at the detection timestamp.",
      "All simulator-generated data is synthetic; small samples can make metrics unstable.",
    ],
  };

  console.log("\n=== NetFault AI Evaluation (synthetic/current DB data) ===");
  console.log(`Evaluated at: ${evaluatedAt}`);
  console.log(
    `Faults: ${faults.length} | Predictions: ${predictions.length} | Evaluated forecasts: ${forecastOutcomes.length}`,
  );
  console.log("\nFORECASTS");
  console.log(
    `Precision: ${metric(report.forecasts.precision)} | Recall: ${metric(report.forecasts.recall)} | F1: ${metric(report.forecasts.f1)}`,
  );
  console.log(
    `False-discovery proportion: ${metric(report.forecasts.falsePositiveRate)} | Avg lead time: ${averageLeadMinutes === null ? "N/A" : `${averageLeadMinutes.toFixed(2)} min`} | Missed faults in evaluated windows: ${forecastFn}`,
  );
  console.log("\nACTIVE DETECTIONS");
  console.log(
    `Precision: ${metric(report.activeDetections.precision)} | Recall: ${metric(report.activeDetections.recall)} | F1: ${metric(report.activeDetections.f1)}`,
  );
  console.log(
    `False positives: ${detectionFp} | Missed recorded faults: ${detectionFn}`,
  );
  console.log("\nCAVEATS");
  for (const caveat of report.caveats) console.log(`- ${caveat}`);

  const outputPath = process.env.NETFAULT_EVALUATION_OUTPUT;
  if (outputPath) {
    const { writeFile } = await import("node:fs/promises");
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    console.log(`\nJSON report written to: ${outputPath}`);
  }
}

main()
  .catch((error: unknown) => {
    console.error("Evaluation failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
