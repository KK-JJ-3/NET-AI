import { useCallback, useEffect, useMemo, useState } from "react";
import "../styles/predictions.css";
import { AlertTriangle, Clock3, RefreshCw, ShieldAlert } from "lucide-react";

import { getPrediction, getPredictions } from "../api/client";

import PredictionDetails from "./PredictionDetails";
import { useMonitoringUpdates } from "../hooks/useMonitoringUpdates";

const STATUS_FILTERS = [
  {
    id: "all",
    label: "All",
  },
  {
    id: "pending",
    label: "Pending",
  },
  {
    id: "confirmed",
    label: "Confirmed",
  },
  {
    id: "false_positive",
    label: "False Positive",
  },
];

const ACTIVE_DETECTION_PREFIXES = ["[ACTIVE_FAULT_DETECTION]", "[RULE_BASED]"];

function isActiveDetection(prediction) {
  const explanation = String(prediction?.explanationText || "").trimStart();
  return ACTIVE_DETECTION_PREFIXES.some((prefix) =>
    explanation.startsWith(prefix),
  );
}

function formatFaultType(value) {
  if (!value) {
    return "Unknown";
  }

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatStatus(value) {
  if (!value) {
    return "Unknown";
  }

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatPredictedAt(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString();
}

function formatWindow(minutes) {
  if (!minutes) {
    return "Unknown";
  }

  return `${minutes} min`;
}

function getSeverityClass(severity) {
  switch (severity) {
    case "low":
      return "prediction-severity-low";

    case "medium":
      return "prediction-severity-medium";

    case "high":
      return "prediction-severity-high";

    case "critical":
      return "prediction-severity-critical";

    default:
      return "prediction-severity-unknown";
  }
}

function getRiskPercentage(riskScore) {
  const numericRisk = Number(riskScore);

  if (Number.isNaN(numericRisk)) {
    return "—";
  }

  return `${Math.round(numericRisk * 100)}%`;
}

function Predictions() {
  const realtimeRevision = useMonitoringUpdates();
  const [predictions, setPredictions] = useState([]);
  const [activeFilter, setActiveFilter] = useState("all");

  const [selectedPredictionId, setSelectedPredictionId] = useState(null);

  const [selectedPrediction, setSelectedPrediction] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [error, setError] = useState("");

  const loadPredictions = useCallback(
    async (isRefresh = false, silent = false) => {
      try {
        if (isRefresh) {
          if (!silent) setRefreshing(true);
        } else {
          setLoading(true);
        }

        if (!silent) setError("");

        // Always load the full set so summary counts remain independent of the
        // selected status filter. Filtering is performed locally below.
        const data = await getPredictions();
        setPredictions(Array.isArray(data) ? data : []);
      } catch (err) {
        if (silent) {
          // Keep the current list visible if a background refresh fails.
          console.error("Failed to refresh predictions:", err);
          return;
        }

        setError(err.message || "Failed to load predictions");
        setPredictions([]);
      } finally {
        if (!silent) {
          if (!isRefresh) setLoading(false);
          setRefreshing(false);
        }
      }
    },
    [],
  );

  const loadPredictionDetails = useCallback(async (id, silent = false) => {
    try {
      if (!silent) {
        setDetailLoading(true);
        setDetailError("");
        setSelectedPrediction(null);
      }

      const data = await getPrediction(id);

      setSelectedPrediction(data);
      if (silent) setDetailError("");
    } catch (err) {
      if (silent) {
        console.error("Failed to refresh prediction details:", err);
        return;
      }

      setDetailError(err.message || "Failed to load prediction details");
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }, []);

  function handleOpenPrediction(id) {
    setSelectedPredictionId(id);
  }

  function handleClosePrediction() {
    setSelectedPredictionId(null);
    setSelectedPrediction(null);
    setDetailError("");
  }

  // Start network work asynchronously so effects do not synchronously trigger
  // loading-state renders. Filter changes retain the normal loading state.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadPredictions();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loadPredictions]);

  // Socket events refresh the list in the background without replacing it
  // with a loading screen on every telemetry/prediction event.
  useEffect(() => {
    if (realtimeRevision === 0) return undefined;

    const timer = window.setTimeout(() => {
      void loadPredictions(true, true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [realtimeRevision, loadPredictions]);

  useEffect(() => {
    if (!selectedPredictionId) return undefined;

    const timer = window.setTimeout(() => {
      void loadPredictionDetails(selectedPredictionId);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [selectedPredictionId, loadPredictionDetails]);

  // Keep the detail view mounted while its data is refreshed silently.
  useEffect(() => {
    if (!selectedPredictionId || realtimeRevision === 0) return undefined;

    const timer = window.setTimeout(() => {
      void loadPredictionDetails(selectedPredictionId, true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, [realtimeRevision, selectedPredictionId, loadPredictionDetails]);

  const pendingCount = useMemo(
    () =>
      predictions.filter(
        (prediction) =>
          prediction.status === "pending" && !isActiveDetection(prediction),
      ).length,
    [predictions],
  );

  const filteredPredictions = useMemo(
    () =>
      predictions.filter(
        (prediction) =>
          activeFilter === "all" || prediction.status === activeFilter,
      ),
    [predictions, activeFilter],
  );

  const forecastPredictions = useMemo(
    () =>
      filteredPredictions.filter(
        (prediction) => !isActiveDetection(prediction),
      ),
    [filteredPredictions],
  );

  const activeDetections = useMemo(
    () => filteredPredictions.filter(isActiveDetection),
    [filteredPredictions],
  );

  const visiblePredictions = filteredPredictions;

  if (selectedPredictionId) {
    if (detailLoading) {
      return (
        <div className="page-scroll">
          <div className="prediction-detail-page">
            <div className="prediction-state">
              <div className="prediction-state-icon">
                <RefreshCw
                  size={22}
                  className="prediction-spin"
                  aria-hidden="true"
                />
              </div>

              <h2>Loading prediction</h2>

              <p>
                Fetching the selected prediction from the monitoring backend.
              </p>
            </div>
          </div>
        </div>
      );
    }

    if (detailError) {
      return (
        <div className="page-scroll">
          <div className="prediction-detail-page">
            <button
              type="button"
              className="prediction-detail-back"
              onClick={handleClosePrediction}
            >
              ← Back to predictions
            </button>

            <div className="prediction-state prediction-state-error">
              <div className="prediction-state-icon">
                <AlertTriangle size={22} aria-hidden="true" />
              </div>

              <h2>Unable to load prediction</h2>

              <p>{detailError}</p>

              <button
                type="button"
                className="prediction-retry-button"
                onClick={() => loadPredictionDetails(selectedPredictionId)}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (selectedPrediction) {
      return (
        <PredictionDetails
          prediction={selectedPrediction}
          onBack={handleClosePrediction}
        />
      );
    }
  }

  return (
    <div className="page-scroll">
      <div className="predictions-page">
        <div className="predictions-header">
          <div>
            <span className="page-eyebrow">AI PREDICTIONS</span>

            <h1>Predictions</h1>

            <p>
              Review predicted network faults, risk levels, and prediction
              outcomes.
            </p>
          </div>

          <button
            type="button"
            className="prediction-refresh-button"
            onClick={() => loadPredictions(true)}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={16}
              className={refreshing ? "prediction-spin" : ""}
              aria-hidden="true"
            />

            <span>{refreshing ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>

        <section className="prediction-summary-grid">
          <div className="prediction-summary-card">
            <span className="prediction-summary-label">Total loaded</span>

            <strong>{predictions.length}</strong>
          </div>

          <div className="prediction-summary-card">
            <span className="prediction-summary-label">Pending</span>

            <strong>{pendingCount}</strong>
          </div>
        </section>

        <div className="prediction-filters" aria-label="Prediction status">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`prediction-filter ${
                activeFilter === filter.id ? "active" : ""
              }`}
              onClick={() => setActiveFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {!loading && error && (
          <div className="prediction-state prediction-state-error">
            <div className="prediction-state-icon">
              <AlertTriangle size={22} aria-hidden="true" />
            </div>

            <h2>Unable to load predictions</h2>

            <p>{error}</p>

            <button
              type="button"
              className="prediction-retry-button"
              onClick={() => loadPredictions(true)}
            >
              Try again
            </button>
          </div>
        )}

        {loading && (
          <div className="prediction-state">
            <div className="prediction-state-icon">
              <RefreshCw
                size={22}
                className="prediction-spin"
                aria-hidden="true"
              />
            </div>

            <h2>Loading predictions</h2>

            <p>Fetching prediction records from the monitoring backend.</p>
          </div>
        )}

        {!loading && !error && visiblePredictions.length === 0 && (
          <div className="prediction-state">
            <div className="prediction-state-icon">
              <ShieldAlert size={22} aria-hidden="true" />
            </div>

            <h2>No predictions available</h2>

            <p>
              No forecasts or active detections match this filter. New records
              will appear here as telemetry is processed.
            </p>
          </div>
        )}

        {!loading && !error && visiblePredictions.length > 0 && (
          <div className="prediction-groups">
            {[
              {
                title: "Future forecasts",
                items: forecastPredictions,
                kind: "forecast",
              },
              {
                title: "Active-fault detections",
                items: activeDetections,
                kind: "detection",
              },
            ]
              .filter((group) => group.items.length > 0)
              .map((group) => (
                <section className="prediction-group" key={group.kind}>
                  <div className="prediction-group-heading">
                    <h2>{group.title}</h2>
                    <span>{group.items.length}</span>
                  </div>
                  <div className="prediction-list">
                    {group.items.map((prediction) => (
                      <article
                        className="prediction-card"
                        key={prediction.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => handleOpenPrediction(prediction.id)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();

                            handleOpenPrediction(prediction.id);
                          }
                        }}
                        aria-label={`Open prediction ${prediction.id}`}
                      >
                        <div className="prediction-card-main">
                          <div className="prediction-card-heading">
                            <div>
                              <span className="prediction-id">
                                PREDICTION #{prediction.id}
                              </span>

                              <h2>{formatFaultType(prediction.faultType)}</h2>
                            </div>

                            <span
                              className={`prediction-severity ${getSeverityClass(
                                prediction.severity,
                              )}`}
                            >
                              {formatStatus(prediction.severity)}
                            </span>
                          </div>

                          <div className="prediction-metrics">
                            <div className="prediction-metric">
                              <span>Risk score</span>

                              <strong>
                                {getRiskPercentage(prediction.riskScore)}
                              </strong>
                            </div>

                            <div className="prediction-metric">
                              <span>Device</span>

                              <strong>#{prediction.deviceId}</strong>
                            </div>

                            <div className="prediction-metric">
                              <span>Window</span>

                              <strong>
                                <Clock3 size={15} aria-hidden="true" />

                                {formatWindow(
                                  prediction.predictedWindowMinutes,
                                )}
                              </strong>
                            </div>

                            <div className="prediction-metric">
                              <span>Status</span>

                              <strong>{formatStatus(prediction.status)}</strong>
                            </div>
                          </div>
                        </div>

                        <div className="prediction-card-footer">
                          <span>
                            {isActiveDetection(prediction)
                              ? "Detected during active fault"
                              : "Forecast for upcoming fault"}
                          </span>
                          <span>
                            Predicted at{" "}
                            {formatPredictedAt(prediction.predictedAt)}
                          </span>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default Predictions;
