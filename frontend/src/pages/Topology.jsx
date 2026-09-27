import { useEffect, useMemo, useState } from "react";
import "../styles/topology.css";
import { getDevices } from "../api/client";
import TopologyGraph from "../components/topology/TopologyGraph";

function Topology({ onSelectDevice }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadDevices() {
      try {
        setLoading(true);
        setError("");

        const data = await getDevices();

        if (mounted) {
          setDevices(Array.isArray(data) ? data : []);
        }
      } catch (requestError) {
        console.error("Failed to load topology devices:", requestError);

        if (mounted) {
          setDevices([]);
          setError(requestError?.message || "Unable to load network devices.");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadDevices();

    return () => {
      mounted = false;
    };
  }, []);

  const statusCounts = useMemo(() => {
    return devices.reduce(
      (counts, device) => {
        if (device.status === "up") {
          counts.up += 1;
        } else if (device.status === "degraded") {
          counts.degraded += 1;
        } else if (device.status === "down") {
          counts.down += 1;
        } else {
          counts.unknown += 1;
        }

        return counts;
      },
      {
        up: 0,
        degraded: 0,
        down: 0,
        unknown: 0,
      },
    );
  }, [devices]);

  return (
    <section className="page topology-page">
      <div className="page-header">
        <div>
          <p className="page-eyebrow">NETWORK</p>

          <h1>Network Topology</h1>

          <p className="page-description">
            View the network layout and current device status.
          </p>
        </div>
      </div>

      <div className="topology-card">
        <div className="topology-card-header">
          <div>
            <h2>Network Map</h2>

            <p>
              Static view of the available network devices and their current
              health.
            </p>
          </div>

          <div className="topology-device-summary">
            <span>
              <strong>{devices.length}</strong>
              <small>Devices</small>
            </span>

            <span className="topology-summary-divider" />

            <span className="topology-summary-status topology-summary-up">
              <strong>{statusCounts.up}</strong>
              <small>Normal</small>
            </span>

            <span className="topology-summary-status topology-summary-warning">
              <strong>{statusCounts.degraded}</strong>
              <small>Warning</small>
            </span>

            <span className="topology-summary-status topology-summary-critical">
              <strong>{statusCounts.down}</strong>
              <small>Critical</small>
            </span>
          </div>
        </div>

        <div className="topology-graph-container">
          {loading ? (
            <div className="topology-placeholder">
              <strong>Loading topology...</strong>

              <span>Fetching the current network devices.</span>
            </div>
          ) : error ? (
            <div className="topology-placeholder topology-placeholder-error">
              <strong>Unable to load topology</strong>

              <span>{error}</span>
            </div>
          ) : (
            <TopologyGraph devices={devices} onSelectDevice={onSelectDevice} />
          )}
        </div>

        <div className="topology-footer">
          <div className="topology-legend">
            <span className="topology-legend-title">Status</span>

            <span className="topology-legend-item">
              <span className="topology-status-dot topology-status-normal" />
              Normal
            </span>

            <span className="topology-legend-item">
              <span className="topology-status-dot topology-status-warning" />
              Warning
            </span>

            <span className="topology-legend-item">
              <span className="topology-status-dot topology-status-critical" />
              Critical
            </span>

            <span className="topology-legend-item">
              <span className="topology-status-dot topology-status-unknown" />
              Unknown
            </span>
          </div>

          <span className="topology-data-note">
            Links are illustrative and do not represent live network
            connections.
          </span>
        </div>
      </div>
    </section>
  );
}

export default Topology;
