import { useEffect, useMemo, useState } from "react";
import "../styles/predictions.css";
import { AlertTriangle, Clock3, RefreshCw, ShieldAlert } from "lucide-react";

import { getPrediction, getPredictions } from "../api/client";

import PredictionDetails from "./PredictionDetails";

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
  const [predictions, setPredictions] = useState([]);
  const [activeFilter, setActiveFilter] = useState("all");

  const [selectedPredictionId, setSelectedPredictionId] = useState(null);

  const [selectedPrediction, setSelectedPrediction] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [error, setError] = useState("");

  async function loadPredictions(isRefresh = false) {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError("");

      const data =
        activeFilter === "all"
          ? await getPredictions()
          : await getPredictions({
              status: activeFilter,
            });

      setPredictions(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load predictions");

      setPredictions([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadPredictionDetails(id) {
    try {
      setDetailLoading(true);
      setDetailError("");
      setSelectedPrediction(null);

      const data = await getPrediction(id);

      setSelectedPrediction(data);
    } catch (err) {
      setDetailError(err.message || "Failed to load prediction details");
    } finally {
      setDetailLoading(false);
    }
  }

  function handleOpenPrediction(id) {
    setSelectedPredictionId(id);
  }

  function handleClosePrediction() {
    setSelectedPredictionId(null);
    setSelectedPrediction(null);
    setDetailError("");
  }

  useEffect(() => {
    loadPredictions();
  }, [activeFilter]);

  useEffect(() => {
    if (!selectedPredictionId) {
      return;
    }

    loadPredictionDetails(selectedPredictionId);
  }, [selectedPredictionId]);

  const pendingCount = useMemo(
    () =>
      predictions.filter((prediction) => prediction.status === "pending")
        .length,
    [predictions],
  );

  const visiblePredictions = predictions;

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
              There are currently no prediction records for this filter.
              Prediction generation will be connected during the later AI
              pipeline stage.
            </p>
          </div>
        )}

        {!loading && !error && visiblePredictions.length > 0 && (
          <section className="prediction-list">
            {visiblePredictions.map((prediction) => (
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

                      <strong>{getRiskPercentage(prediction.riskScore)}</strong>
                    </div>

                    <div className="prediction-metric">
                      <span>Device</span>

                      <strong>#{prediction.deviceId}</strong>
                    </div>

                    <div className="prediction-metric">
                      <span>Window</span>

                      <strong>
                        <Clock3 size={15} aria-hidden="true" />

                        {formatWindow(prediction.predictedWindowMinutes)}
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
                    Predicted at {formatPredictedAt(prediction.predictedAt)}
                  </span>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

export default Predictions;
