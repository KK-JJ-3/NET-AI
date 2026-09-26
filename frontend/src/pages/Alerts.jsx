import { useCallback, useEffect, useState } from "react";
import "../styles/alerts.css";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ShieldAlert,
} from "lucide-react";

import { acknowledgeAlert, getAlerts } from "../api/client";

function formatSeverity(value) {
  if (!value) {
    return "Unknown";
  }

  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value) {
  if (!value) {
    return "Unknown";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleString();
}

function getSeverityClass(severity) {
  switch (severity) {
    case "critical":
      return "alert-severity-critical";

    case "high":
      return "alert-severity-high";

    case "medium":
      return "alert-severity-medium";

    case "low":
      return "alert-severity-low";

    default:
      return "alert-severity-unknown";
  }
}

const ALERT_FILTERS = [
  {
    value: "all",
    label: "All",
  },
  {
    value: "unacknowledged",
    label: "Unacknowledged",
  },
  {
    value: "acknowledged",
    label: "Acknowledged",
  },
];

function AlertDetails({ alert, onBack, onAcknowledge, acknowledging }) {
  if (!alert) {
    return (
      <div className="page-scroll">
        <div className="alert-detail-page">
          <button type="button" onClick={onBack} className="alert-detail-back">
            ← Back to alerts
          </button>

          <div className="alert-state">
            <ShieldAlert size={24} aria-hidden="true" />

            <h1>Alert not found</h1>

            <p>The selected alert record is not available.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-scroll">
      <div className="alert-detail-page">
        <button type="button" onClick={onBack} className="alert-detail-back">
          ← Back to alerts
        </button>

        <div className="alert-detail-header">
          <div>
            <span className="page-eyebrow">ALERT #{alert.id}</span>

            <h1>{formatSeverity(alert.severity)} Alert</h1>

            <p>{alert.message}</p>
          </div>

          <span
            className={`alert-severity ${getSeverityClass(alert.severity)}`}
          >
            {formatSeverity(alert.severity)}
          </span>
        </div>

        <section className="alert-detail-summary">
          <div className="alert-detail-card">
            <span>Device</span>
            <strong>#{alert.deviceId}</strong>
          </div>

          <div className="alert-detail-card">
            <span>Prediction</span>
            <strong>
              {alert.predictionId ? `#${alert.predictionId}` : "None"}
            </strong>
          </div>

          <div className="alert-detail-card">
            <span>Status</span>
            <strong>
              {alert.acknowledged ? "Acknowledged" : "Unacknowledged"}
            </strong>
          </div>

          <div className="alert-detail-card">
            <span>Created</span>
            <strong>
              <Clock3 size={16} aria-hidden="true" />
              {formatDate(alert.createdAt)}
            </strong>
          </div>
        </section>

        <section className="alert-detail-section">
          <div className="alert-detail-section-heading">
            <span className="page-eyebrow">ALERT INFORMATION</span>

            <h2>Alert details</h2>
          </div>

          <div className="alert-detail-information">
            <div>
              <span>Alert ID</span>
              <strong>#{alert.id}</strong>
            </div>

            <div>
              <span>Device ID</span>
              <strong>#{alert.deviceId}</strong>
            </div>

            <div>
              <span>Prediction ID</span>
              <strong>
                {alert.predictionId ? `#${alert.predictionId}` : "None"}
              </strong>
            </div>

            <div>
              <span>Created at</span>
              <strong>{formatDate(alert.createdAt)}</strong>
            </div>

            <div>
              <span>Severity</span>
              <strong>{formatSeverity(alert.severity)}</strong>
            </div>

            <div>
              <span>Acknowledgement</span>
              <strong>{alert.acknowledged ? "Acknowledged" : "Pending"}</strong>
            </div>
          </div>
        </section>

        <section className="alert-detail-section">
          <div className="alert-detail-section-heading">
            <span className="page-eyebrow">MESSAGE</span>

            <h2>Alert message</h2>
          </div>

          <div className="alert-message">
            <AlertTriangle size={20} aria-hidden="true" />

            <p>{alert.message}</p>
          </div>
        </section>

        {!alert.acknowledged && (
          <button
            type="button"
            className="alert-acknowledge-button"
            onClick={() => onAcknowledge(alert.id)}
            disabled={acknowledging}
          >
            <Check size={16} aria-hidden="true" />

            {acknowledging ? "Acknowledging..." : "Acknowledge alert"}
          </button>
        )}

        {alert.acknowledged && (
          <div className="alert-acknowledged-state">
            <CheckCircle2 size={18} aria-hidden="true" />

            <span>This alert has been acknowledged.</span>
          </div>
        )}
      </div>
    </div>
  );
}

function Alerts() {
  const [alerts, setAlerts] = useState([]);
  const [activeFilter, setActiveFilter] = useState("all");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const [selectedAlertId, setSelectedAlertId] = useState(null);
  const [selectedAlert, setSelectedAlert] = useState(null);

  const [acknowledging, setAcknowledging] = useState(false);

  const loadAlerts = useCallback(
    async ({ showRefreshing = false } = {}) => {
      try {
        setError("");

        if (showRefreshing) {
          setRefreshing(true);
        } else {
          setLoading(true);
        }

        const filters = {};

        if (activeFilter === "acknowledged") {
          filters.acknowledged = true;
        }

        if (activeFilter === "unacknowledged") {
          filters.acknowledged = false;
        }

        const result = await getAlerts(filters);

        setAlerts(Array.isArray(result) ? result : []);
      } catch (requestError) {
        setError(
          requestError?.message || "Unable to load alerts. Please try again.",
        );
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [activeFilter],
  );

  useEffect(() => {
    loadAlerts();
  }, [loadAlerts]);

  async function handleAcknowledge(id) {
    try {
      setAcknowledging(true);
      setError("");

      await acknowledgeAlert(id);

      setAlerts((currentAlerts) =>
        currentAlerts.map((alert) =>
          alert.id === id
            ? {
                ...alert,
                acknowledged: true,
              }
            : alert,
        ),
      );

      setSelectedAlert((currentAlert) =>
        currentAlert && currentAlert.id === id
          ? {
              ...currentAlert,
              acknowledged: true,
            }
          : currentAlert,
      );
    } catch (requestError) {
      setError(
        requestError?.message ||
          "Unable to acknowledge this alert. Please try again.",
      );
    } finally {
      setAcknowledging(false);
    }
  }

  function handleSelectAlert(alert) {
    setSelectedAlertId(alert.id);
    setSelectedAlert(alert);
  }

  function handleBackToAlerts() {
    setSelectedAlertId(null);
    setSelectedAlert(null);
  }

  if (selectedAlertId) {
    return (
      <AlertDetails
        alert={selectedAlert}
        onBack={handleBackToAlerts}
        onAcknowledge={handleAcknowledge}
        acknowledging={acknowledging}
      />
    );
  }

  const totalAlerts = alerts.length;

  const acknowledgedCount = alerts.filter((alert) => alert.acknowledged).length;

  const unacknowledgedCount = alerts.filter(
    (alert) => !alert.acknowledged,
  ).length;

  return (
    <div className="page-scroll">
      <div className="alerts-page">
        <header className="alerts-header">
          <div>
            <span className="page-eyebrow">NETWORK ALERTS</span>

            <h1>Alerts</h1>

            <p>
              Review network alerts generated from detected prediction
              conditions.
            </p>
          </div>

          <button
            type="button"
            className="alert-refresh-button"
            onClick={() => loadAlerts({ showRefreshing: true })}
            disabled={refreshing}
          >
            <RefreshCw
              size={16}
              aria-hidden="true"
              className={refreshing ? "alert-refresh-spinning" : ""}
            />

            {refreshing ? "Refreshing..." : "Refresh"}
          </button>
        </header>

        <section className="alert-summary-grid">
          <div className="alert-summary-card">
            <span>Total alerts</span>
            <strong>{totalAlerts}</strong>
          </div>

          <div className="alert-summary-card">
            <span>Unacknowledged</span>
            <strong>{unacknowledgedCount}</strong>
          </div>

          <div className="alert-summary-card">
            <span>Acknowledged</span>
            <strong>{acknowledgedCount}</strong>
          </div>
        </section>

        <section className="alert-filters">
          {ALERT_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              className={`alert-filter ${
                activeFilter === filter.value ? "alert-filter-active" : ""
              }`}
              onClick={() => setActiveFilter(filter.value)}
            >
              {filter.label}
            </button>
          ))}
        </section>

        {error && (
          <div className="alert-state alert-state-error">
            <AlertTriangle size={24} aria-hidden="true" />

            <h2>Unable to load alerts</h2>

            <p>{error}</p>

            <button
              type="button"
              onClick={() => loadAlerts()}
              className="alert-retry-button"
            >
              Try again
            </button>
          </div>
        )}

        {loading && !error && (
          <div className="alert-state">
            <RefreshCw
              size={24}
              aria-hidden="true"
              className="alert-refresh-spinning"
            />

            <h2>Loading alerts...</h2>

            <p>Fetching the latest alert records.</p>
          </div>
        )}

        {!loading && !error && alerts.length === 0 && (
          <div className="alert-state">
            <CheckCircle2 size={24} aria-hidden="true" />

            <h2>No alerts found</h2>

            <p>There are no alerts matching the selected filter.</p>
          </div>
        )}

        {!loading && !error && alerts.length > 0 && (
          <section className="alert-list">
            {alerts.map((alert) => (
              <article
                key={alert.id}
                className={`alert-card ${
                  alert.acknowledged ? "alert-card-acknowledged" : ""
                }`}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectAlert(alert)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleSelectAlert(alert);
                  }
                }}
              >
                <div className="alert-card-main">
                  <div className="alert-card-heading">
                    <span className="alert-id">ALERT #{alert.id}</span>

                    <span
                      className={`alert-severity ${getSeverityClass(
                        alert.severity,
                      )}`}
                    >
                      {formatSeverity(alert.severity)}
                    </span>

                    <span className="alert-status">
                      {alert.acknowledged ? "Acknowledged" : "Unacknowledged"}
                    </span>
                  </div>

                  <h2>{alert.message}</h2>

                  <div className="alert-metadata">
                    <span>Device #{alert.deviceId}</span>

                    <span>
                      {alert.predictionId
                        ? `Prediction #${alert.predictionId}`
                        : "No prediction"}
                    </span>

                    <span>{formatDate(alert.createdAt)}</span>
                  </div>
                </div>

                {!alert.acknowledged && (
                  <button
                    type="button"
                    className="alert-card-acknowledge"
                    onClick={(event) => {
                      event.stopPropagation();
                      handleAcknowledge(alert.id);
                    }}
                    disabled={acknowledging}
                  >
                    <Check size={15} aria-hidden="true" />
                    Acknowledge
                  </button>
                )}
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

export default Alerts;
