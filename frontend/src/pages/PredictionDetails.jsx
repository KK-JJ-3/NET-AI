import {
  Activity,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";

function formatFaultType(value) {
  if (!value) return "Unknown";

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatStatus(value) {
  if (!value) return "Unknown";

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatPredictedAt(value) {
  if (!value) return "Unknown";

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString();
}

function getRiskPercentage(value) {
  const risk = Number(value);

  return Number.isFinite(risk) ? `${Math.round(risk * 100)}%` : "—";
}

function formatWindow(minutes) {
  return minutes == null ? "Unknown" : `${minutes} min`;
}

function formatFeatureName(name) {
  const labels = {
    latency_ms_current: "Current latency",
    utilization_pct_current: "Current network utilization",
    packet_loss_pct_current: "Current packet loss",
    jitter_ms_current: "Current jitter",
    cpu_pct_current: "Current CPU usage",
    memory_pct_current: "Current memory usage",
    availability_current: "Device availability",
    latency_ms: "Latency",
    utilization_pct: "Network utilization",
    packet_loss_pct: "Packet loss",
    jitter_ms: "Jitter",
    cpu_pct: "CPU usage",
    memory_pct: "Memory usage",
    anomaly_score: "Anomaly score",
  };

  if (labels[name]) return labels[name];

  return name
    .replace(/_current$/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function getThreshold(name, value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) return null;

  if (name === "latency_ms_current") {
    return {
      label: "Congestion threshold",
      value: "100 ms",
      exceeded: numericValue >= 100,
    };
  }

  if (name === "utilization_pct_current") {
    return {
      label: "Congestion threshold",
      value: "90%",
      exceeded: numericValue >= 90,
    };
  }

  if (name === "availability_current") {
    return {
      label: "Expected state",
      value: "Available",
      exceeded: numericValue === 0,
    };
  }

  if (name === "packet_loss_pct_current") {
    return {
      label: "Observed packet loss",
      value: `${numericValue.toFixed(1)}%`,
      exceeded: false,
    };
  }

  if (name === "jitter_ms_current") {
    return {
      label: "Observed jitter",
      value: `${numericValue.toFixed(1)} ms`,
      exceeded: false,
    };
  }

  if (name === "cpu_pct_current" || name === "memory_pct_current") {
    return {
      label: "Observed usage",
      value: `${numericValue.toFixed(1)}%`,
      exceeded: false,
    };
  }

  return null;
}

function formatFeatureValue(name, value) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return String(value);
  }

  if (name === "availability_current") {
    return numericValue === 0 ? "Unavailable" : "Available";
  }

  if (name.endsWith("_current")) {
    if (
      name.includes("_pct_") ||
      name.startsWith("cpu_pct") ||
      name.startsWith("memory_pct")
    ) {
      return `${numericValue.toFixed(1)}%`;
    }

    if (name.includes("_ms_")) {
      return `${numericValue.toFixed(1)} ms`;
    }
  }

  // For model-based predictions, contributor values may represent
  // importance scores rather than measured telemetry.
  return numericValue.toFixed(3);
}

function getFallbackExplanation(prediction) {
  const faultType = prediction.faultType;

  if (faultType === "congestion") {
    return (
      "The prediction indicates network congestion risk. Review network " +
      "utilization, latency, packet loss, and jitter to identify possible " +
      "network bottlenecks."
    );
  }

  if (faultType === "device_failure") {
    return (
      "The prediction indicates device failure risk. Check device " +
      "availability, connectivity, and recent telemetry to identify " +
      "possible service interruptions."
    );
  }

  if (faultType === "normal") {
    return (
      "No significant future fault risk is indicated by the current " +
      "telemetry window. Continue monitoring for changes."
    );
  }

  return (
    "Review the contributing features and current telemetry to investigate " +
    "the predicted fault."
  );
}

function getSeverityClass(severity, riskScore) {
  const value = String(severity || "").toLowerCase();

  if (value) return value.replaceAll(" ", "-");

  const risk = Number(riskScore);

  if (risk >= 0.8) return "critical";
  if (risk >= 0.6) return "high";
  if (risk >= 0.4) return "medium";

  return "low";
}

function PredictionDetails({ prediction, onBack }) {
  if (!prediction) {
    return (
      <div className="page-scroll">
        <div className="prediction-detail-page">
          <button
            type="button"
            onClick={onBack}
            className="prediction-detail-back"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            <span>Back to predictions</span>
          </button>

          <div className="prediction-detail-empty">
            <ShieldAlert size={24} aria-hidden="true" />
            <h1>Prediction not found</h1>
            <p>The selected prediction record is not available.</p>
          </div>
        </div>
      </div>
    );
  }

  const features = prediction.contributingFeatures;
  const featureEntries =
    features && typeof features === "object" ? Object.entries(features) : [];

  const riskScore = Number(prediction.riskScore);
  const riskPercentage = getRiskPercentage(prediction.riskScore);
  const severityClass = getSeverityClass(
    prediction.severity,
    prediction.riskScore,
  );

  const rawExplanation = prediction.explanationText || "";
  const isActiveFaultDetection =
    /^\[(?:ACTIVE_FAULT_DETECTION|RULE_BASED)\]/.test(rawExplanation);
  const detectionType = isActiveFaultDetection
    ? "Active fault detection"
    : "Future forecast";
  const explanation = (
    rawExplanation || getFallbackExplanation(prediction)
  ).replace(/^\[(?:ACTIVE_FAULT_DETECTION|RULE_BASED)\]\s*/, "");
  const deviceName = prediction.device?.name || prediction.deviceName || null;

  return (
    <div className="page-scroll">
      <div className="prediction-detail-page">
        <button
          type="button"
          onClick={onBack}
          className="prediction-detail-back"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          <span>Back to predictions</span>
        </button>

        <div className="prediction-detail-header">
          <div>
            <span className="page-eyebrow">PREDICTION #{prediction.id}</span>

            <div className="prediction-detail-title-row">
              <h1>{formatFaultType(prediction.faultType)}</h1>
              <span
                className={`prediction-detection-type ${isActiveFaultDetection ? "active" : "forecast"}`}
              >
                {isActiveFaultDetection ? (
                  <TriangleAlert size={14} aria-hidden="true" />
                ) : (
                  <Clock3 size={14} aria-hidden="true" />
                )}
                {detectionType}
              </span>
            </div>

            <p>
              {isActiveFaultDetection
                ? "An active fault has been detected from current telemetry."
                : "Review the forecasted fault risk and its contributing telemetry."}
            </p>
          </div>

          <span className="prediction-detail-status">
            {formatStatus(prediction.status)}
          </span>
        </div>

        <section className="prediction-detail-summary">
          <div className="prediction-detail-card">
            <span>Risk score</span>
            <strong>{riskPercentage}</strong>
          </div>

          <div className="prediction-detail-card">
            <span>Severity</span>
            <strong>{formatStatus(prediction.severity)}</strong>
          </div>

          <div className="prediction-detail-card">
            <span>Prediction window</span>
            <strong>
              <Clock3 size={16} aria-hidden="true" />
              {formatWindow(prediction.predictedWindowMinutes)}
            </strong>
          </div>

          <div className="prediction-detail-card prediction-detail-device-card">
            <span>Device</span>
            <strong>{deviceName || `Device #${prediction.deviceId}`}</strong>
            <small>Device #{prediction.deviceId}</small>
          </div>
        </section>

        <section className="prediction-detail-section">
          <div className="prediction-detail-section-heading">
            <span className="page-eyebrow">PREDICTION INFORMATION</span>
            <h2>Prediction details</h2>
          </div>

          <div className="prediction-detail-information">
            <div>
              <span>Fault type</span>
              <strong>{formatFaultType(prediction.faultType)}</strong>
            </div>

            <div>
              <span>Predicted at</span>
              <strong>{formatPredictedAt(prediction.predictedAt)}</strong>
            </div>

            <div>
              <span>Estimated window</span>
              <strong>{formatWindow(prediction.predictedWindowMinutes)}</strong>
            </div>

            <div>
              <span>Outcome status</span>
              <strong>{formatStatus(prediction.status)}</strong>
            </div>
          </div>
        </section>

        <section className="prediction-detail-section">
          <div className="prediction-detail-section-heading">
            <span className="page-eyebrow">AI EXPLANATION</span>
            <h2>Contributing factors</h2>
          </div>

          <div className="prediction-detail-placeholder">
            <div className="prediction-ai-risk">
              <div className="prediction-ai-risk-icon">
                {riskScore >= 0.8 ? (
                  <TriangleAlert size={22} aria-hidden="true" />
                ) : (
                  <Activity size={22} aria-hidden="true" />
                )}
              </div>

              <div className="prediction-ai-risk-copy">
                <span>ASSESSED RISK</span>
                <strong>{riskPercentage}</strong>
                <p>
                  {formatFaultType(prediction.faultType)} ·{" "}
                  {formatStatus(prediction.severity)}
                </p>
              </div>

              <span className={`prediction-ai-severity ${severityClass}`}>
                {formatStatus(prediction.severity)}
              </span>
            </div>

            {featureEntries.length > 0 ? (
              <div className="prediction-contributors">
                {featureEntries.map(([name, value]) => {
                  const isMeasurement = name.endsWith("_current");
                  const threshold = getThreshold(name, value);

                  return (
                    <article className="prediction-contributor" key={name}>
                      <div className="prediction-contributor-icon">
                        <Activity size={19} aria-hidden="true" />
                      </div>

                      <div className="prediction-contributor-content">
                        <span className="prediction-contributor-label">
                          {formatFeatureName(name)}
                        </span>

                        <strong>{formatFeatureValue(name, value)}</strong>

                        {threshold && (
                          <div
                            className={`prediction-threshold ${
                              threshold.exceeded ? "exceeded" : "observed"
                            }`}
                          >
                            {threshold.exceeded ? (
                              <TriangleAlert size={14} aria-hidden="true" />
                            ) : (
                              <CheckCircle2 size={14} aria-hidden="true" />
                            )}

                            <span>
                              {threshold.label}: {threshold.value}
                            </span>
                          </div>
                        )}

                        {!threshold && !isMeasurement && (
                          <span className="prediction-contributor-note">
                            Model importance score
                          </span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="prediction-no-contributors">
                <Activity size={20} aria-hidden="true" />
                <p>
                  No contributing feature data was stored for this prediction.
                  The explanation below is still available.
                </p>
              </div>
            )}

            <div className="prediction-ai-explanation">
              <span className="page-eyebrow">GENERATED EXPLANATION</span>
              <p>{explanation}</p>
            </div>

            <p className="prediction-ai-footnote">
              Threshold comparisons are shown only where a configured threshold
              is available. A risk score is the model's estimated risk, not a
              guarantee that a fault will occur.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}

export default PredictionDetails;
