import { useEffect, useMemo, useState } from "react";
import "../styles/faults.css";
import { AlertTriangle, Clock3, RefreshCw, ShieldAlert } from "lucide-react";

import { getFault, getFaults } from "../api/client";

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
    case "low":
      return "fault-severity-low";

    case "medium":
      return "fault-severity-medium";

    case "high":
      return "fault-severity-high";

    case "critical":
      return "fault-severity-critical";

    default:
      return "fault-severity-unknown";
  }
}

const STATUS_FILTERS = [
  {
    id: "all",
    label: "All",
  },
  {
    id: "predicted",
    label: "Predicted",
  },
  {
    id: "confirmed",
    label: "Confirmed",
  },
  {
    id: "resolved",
    label: "Resolved",
  },
];

function FaultDetails({ fault, onBack }) {
  if (!fault) {
    return null;
  }

  return (
    <div className="page-scroll">
      <div className="fault-detail-page">
        <button type="button" className="fault-detail-back" onClick={onBack}>
          ← Back to faults
        </button>

        <div className="fault-detail-header">
          <div>
            <span className="page-eyebrow">FAULT #{fault.id}</span>

            <h1>{formatFaultType(fault.faultType)}</h1>

            <p>Detailed information for the selected network fault.</p>
          </div>

          <span
            className={`fault-severity ${getSeverityClass(fault.severity)}`}
          >
            {formatStatus(fault.severity)}
          </span>
        </div>

        <section className="fault-detail-summary">
          <div className="fault-detail-card">
            <span>Status</span>

            <strong>{formatStatus(fault.status)}</strong>
          </div>

          <div className="fault-detail-card">
            <span>Severity</span>

            <strong>{formatStatus(fault.severity)}</strong>
          </div>

          <div className="fault-detail-card">
            <span>Device</span>

            <strong>#{fault.deviceId}</strong>
          </div>

          <div className="fault-detail-card">
            <span>Started</span>

            <strong>
              <Clock3 size={16} aria-hidden="true" />

              {formatDate(fault.startedAt)}
            </strong>
          </div>
        </section>

        <section className="fault-detail-section">
          <div className="fault-detail-section-heading">
            <span className="page-eyebrow">FAULT INFORMATION</span>

            <h2>Fault details</h2>
          </div>

          <div className="fault-detail-information">
            <div>
              <span>Fault type</span>

              <strong>{formatFaultType(fault.faultType)}</strong>
            </div>

            <div>
              <span>Device</span>

              <strong>#{fault.deviceId}</strong>
            </div>

            <div>
              <span>Status</span>

              <strong>{formatStatus(fault.status)}</strong>
            </div>

            <div>
              <span>Severity</span>

              <strong>{formatStatus(fault.severity)}</strong>
            </div>

            <div>
              <span>Started at</span>

              <strong>{formatDate(fault.startedAt)}</strong>
            </div>

            <div>
              <span>Resolved at</span>

              <strong>{formatDate(fault.resolvedAt)}</strong>
            </div>

            <div>
              <span>Created at</span>

              <strong>{formatDate(fault.createdAt)}</strong>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Faults() {
  const [faults, setFaults] = useState([]);
  const [activeFilter, setActiveFilter] = useState("all");

  const [selectedFaultId, setSelectedFaultId] = useState(null);
  const [selectedFault, setSelectedFault] = useState(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");

  const [error, setError] = useState("");

  async function loadFaults(isRefresh = false) {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError("");

      const data =
        activeFilter === "all"
          ? await getFaults()
          : await getFaults({
              status: activeFilter,
            });

      setFaults(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err.message || "Failed to load faults");
      setFaults([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  async function loadFaultDetails(id) {
    try {
      setDetailLoading(true);
      setDetailError("");
      setSelectedFault(null);

      const data = await getFault(id);

      setSelectedFault(data);
    } catch (err) {
      setDetailError(err.message || "Failed to load fault details");
    } finally {
      setDetailLoading(false);
    }
  }

  function handleOpenFault(id) {
    setSelectedFaultId(id);
  }

  function handleCloseFault() {
    setSelectedFaultId(null);
    setSelectedFault(null);
    setDetailError("");
  }

  useEffect(() => {
    loadFaults();
  }, [activeFilter]);

  useEffect(() => {
    if (!selectedFaultId) {
      return;
    }

    loadFaultDetails(selectedFaultId);
  }, [selectedFaultId]);

  const confirmedCount = useMemo(
    () => faults.filter((fault) => fault.status === "confirmed").length,
    [faults],
  );

  const activeCount = useMemo(
    () => faults.filter((fault) => fault.status !== "resolved").length,
    [faults],
  );

  if (selectedFaultId) {
    if (detailLoading) {
      return (
        <div className="page-scroll">
          <div className="fault-detail-page">
            <div className="fault-state">
              <div className="fault-state-icon">
                <RefreshCw
                  size={22}
                  className="fault-spin"
                  aria-hidden="true"
                />
              </div>

              <h2>Loading fault</h2>

              <p>Fetching the selected fault from the monitoring backend.</p>
            </div>
          </div>
        </div>
      );
    }

    if (detailError) {
      return (
        <div className="page-scroll">
          <div className="fault-detail-page">
            <button
              type="button"
              className="fault-detail-back"
              onClick={handleCloseFault}
            >
              ← Back to faults
            </button>

            <div className="fault-state fault-state-error">
              <div className="fault-state-icon">
                <AlertTriangle size={22} aria-hidden="true" />
              </div>

              <h2>Unable to load fault</h2>

              <p>{detailError}</p>

              <button
                type="button"
                className="fault-retry-button"
                onClick={() => loadFaultDetails(selectedFaultId)}
              >
                Try again
              </button>
            </div>
          </div>
        </div>
      );
    }

    if (selectedFault) {
      return <FaultDetails fault={selectedFault} onBack={handleCloseFault} />;
    }
  }

  return (
    <div className="page-scroll">
      <div className="faults-page">
        <div className="faults-header">
          <div>
            <span className="page-eyebrow">NETWORK FAULTS</span>

            <h1>Faults</h1>

            <p>
              Review detected network faults, their severity, status, and
              lifecycle.
            </p>
          </div>

          <button
            type="button"
            className="fault-refresh-button"
            onClick={() => loadFaults(true)}
            disabled={loading || refreshing}
          >
            <RefreshCw
              size={16}
              className={refreshing ? "fault-spin" : ""}
              aria-hidden="true"
            />

            <span>{refreshing ? "Refreshing" : "Refresh"}</span>
          </button>
        </div>

        <section className="fault-summary-grid">
          <div className="fault-summary-card">
            <span>Loaded</span>

            <strong>{faults.length}</strong>
          </div>

          <div className="fault-summary-card">
            <span>Active</span>

            <strong>{activeCount}</strong>
          </div>

          <div className="fault-summary-card">
            <span>Confirmed</span>

            <strong>{confirmedCount}</strong>
          </div>
        </section>

        <div className="fault-filters" aria-label="Fault status">
          {STATUS_FILTERS.map((filter) => (
            <button
              key={filter.id}
              type="button"
              className={`fault-filter ${
                activeFilter === filter.id ? "active" : ""
              }`}
              onClick={() => setActiveFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {!loading && error && (
          <div className="fault-state fault-state-error">
            <div className="fault-state-icon">
              <AlertTriangle size={22} aria-hidden="true" />
            </div>

            <h2>Unable to load faults</h2>

            <p>{error}</p>

            <button
              type="button"
              className="fault-retry-button"
              onClick={() => loadFaults(true)}
            >
              Try again
            </button>
          </div>
        )}

        {loading && (
          <div className="fault-state">
            <div className="fault-state-icon">
              <RefreshCw size={22} className="fault-spin" aria-hidden="true" />
            </div>

            <h2>Loading faults</h2>

            <p>Fetching fault records from the monitoring backend.</p>
          </div>
        )}

        {!loading && !error && faults.length === 0 && (
          <div className="fault-state">
            <div className="fault-state-icon">
              <ShieldAlert size={22} aria-hidden="true" />
            </div>

            <h2>No faults available</h2>

            <p>There are currently no fault records for this filter.</p>
          </div>
        )}

        {!loading && !error && faults.length > 0 && (
          <section className="fault-list">
            {faults.map((fault) => (
              <article
                key={fault.id}
                className="fault-card"
                role="button"
                tabIndex={0}
                onClick={() => handleOpenFault(fault.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();

                    handleOpenFault(fault.id);
                  }
                }}
                aria-label={`Open fault ${fault.id}`}
              >
                <div className="fault-card-main">
                  <div className="fault-card-heading">
                    <div>
                      <span className="fault-id">FAULT #{fault.id}</span>

                      <h2>{formatFaultType(fault.faultType)}</h2>
                    </div>

                    <span
                      className={`fault-severity ${getSeverityClass(
                        fault.severity,
                      )}`}
                    >
                      {formatStatus(fault.severity)}
                    </span>
                  </div>

                  <div className="fault-metrics">
                    <div className="fault-metric">
                      <span>Status</span>

                      <strong>{formatStatus(fault.status)}</strong>
                    </div>

                    <div className="fault-metric">
                      <span>Device</span>

                      <strong>#{fault.deviceId}</strong>
                    </div>

                    <div className="fault-metric">
                      <span>Started</span>

                      <strong>
                        <Clock3 size={15} aria-hidden="true" />

                        {formatDate(fault.startedAt)}
                      </strong>
                    </div>

                    <div className="fault-metric">
                      <span>Resolved</span>

                      <strong>
                        {fault.resolvedAt
                          ? formatDate(fault.resolvedAt)
                          : "Not resolved"}
                      </strong>
                    </div>
                  </div>
                </div>

                <div className="fault-card-footer">
                  <span>Created {formatDate(fault.createdAt)}</span>
                </div>
              </article>
            ))}
          </section>
        )}
      </div>
    </div>
  );
}

export default Faults;
