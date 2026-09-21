import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getAlerts,
  getDashboardSummary,
  getDevices,
  getDeviceTelemetry,
  getFaults,
  getPredictions,
} from "../api/client";
import { useAuth } from "../auth/AuthContext";

const METRIC_CONFIG = {
  latency: {
    label: "Latency",
    unit: "ms",
    dataKey: "latency",
    color: "#3b82f6",
  },
  packetLoss: {
    label: "Packet Loss",
    unit: "%",
    dataKey: "packetLoss",
    color: "#ef4444",
  },
  jitter: {
    label: "Jitter",
    unit: "ms",
    dataKey: "jitter",
    color: "#f59e0b",
  },
  utilization: {
    label: "Utilization",
    unit: "%",
    dataKey: "utilization",
    color: "#a855f7",
  },
};

function Dashboard() {
  const { user, logout } = useAuth();

  const [summary, setSummary] = useState(null);
  const [devices, setDevices] = useState([]);
  const [telemetry, setTelemetry] = useState([]);
  const [predictions, setPredictions] = useState([]);
  const [faults, setFaults] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [activeMetric, setActiveMetric] = useState("latency");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [
          summaryData,
          devicesData,
          predictionsData,
          faultsData,
          alertsData,
        ] = await Promise.all([
          getDashboardSummary(),
          getDevices(),
          getPredictions(),
          getFaults(),
          getAlerts(),
        ]);

        setSummary(summaryData);
        setDevices(Array.isArray(devicesData) ? devicesData : []);

        const telemetryResults = await Promise.all(
          (Array.isArray(devicesData) ? devicesData : []).map(
            async (device) => {
              try {
                const result = await getDeviceTelemetry(device.id, "1h");

                return {
                  deviceId: device.id,
                  telemetry: Array.isArray(result?.telemetry)
                    ? result.telemetry
                    : [],
                };
              } catch {
                return {
                  deviceId: device.id,
                  telemetry: [],
                };
              }
            },
          ),
        );

        setTelemetry(telemetryResults);
        setPredictions(Array.isArray(predictionsData) ? predictionsData : []);
        setFaults(Array.isArray(faultsData) ? faultsData : []);
        setAlerts(Array.isArray(alertsData) ? alertsData : []);
      } catch (err) {
        setError(err.message || "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  const latestTelemetryByDevice = useMemo(() => {
    return telemetry
      .map(({ deviceId, telemetry: deviceTelemetry }) => {
        if (!deviceTelemetry?.length) {
          return null;
        }

        const sorted = [...deviceTelemetry].sort(
          (a, b) =>
            new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime(),
        );

        return {
          deviceId,
          latest: sorted[0],
        };
      })
      .filter(Boolean);
  }, [telemetry]);

  const latestMetrics = useMemo(() => {
    if (!latestTelemetryByDevice.length) {
      return {
        latency: null,
        packetLoss: null,
        jitter: null,
        utilization: null,
      };
    }

    const values = {
      latency: [],
      packetLoss: [],
      jitter: [],
      utilization: [],
    };

    latestTelemetryByDevice.forEach(({ latest }) => {
      values.latency.push(Number(latest.latencyMs ?? 0));
      values.packetLoss.push(Number(latest.packetLossPct ?? 0));
      values.jitter.push(Number(latest.jitterMs ?? 0));
      values.utilization.push(Number(latest.utilizationPct ?? 0));
    });

    return {
      latency: average(values.latency),
      packetLoss: average(values.packetLoss),
      jitter: average(values.jitter),
      utilization: average(values.utilization),
    };
  }, [latestTelemetryByDevice]);

  const telemetryChartData = useMemo(() => {
    const groups = new Map();

    telemetry.forEach(({ telemetry: deviceTelemetry }) => {
      deviceTelemetry?.forEach((item) => {
        const time = new Date(item.recordedAt).getTime();

        if (Number.isNaN(time)) {
          return;
        }

        if (!groups.has(time)) {
          groups.set(time, []);
        }

        groups.get(time).push({
          latency: Number(item.latencyMs ?? 0),
          packetLoss: Number(item.packetLossPct ?? 0),
          jitter: Number(item.jitterMs ?? 0),
          utilization: Number(item.utilizationPct ?? 0),
        });
      });
    });

    return [...groups.entries()]
      .sort(([timeA], [timeB]) => timeA - timeB)
      .slice(-30)
      .map(([time, values]) => ({
        time,
        label: new Date(time).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        latency: average(values.map((item) => item.latency)),
        packetLoss: average(values.map((item) => item.packetLoss)),
        jitter: average(values.map((item) => item.jitter)),
        utilization: average(values.map((item) => item.utilization)),
      }));
  }, [telemetry]);

  const healthDistribution = useMemo(
    () => [
      {
        name: "Up",
        value: Number(summary?.devices?.up ?? 0),
        color: "#34d399",
      },
      {
        name: "Degraded",
        value: Number(summary?.devices?.degraded ?? 0),
        color: "#f59e0b",
      },
      {
        name: "Down",
        value: Number(summary?.devices?.down ?? 0),
        color: "#ef4444",
      },
    ],
    [summary],
  );

  const deviceRows = useMemo(() => {
    const faultCounts = new Map();

    faults.forEach((fault) => {
      faultCounts.set(
        fault.deviceId,
        (faultCounts.get(fault.deviceId) || 0) + 1,
      );
    });

    return [...devices]
      .map((device) => ({
        ...device,
        faultCount: faultCounts.get(device.id) || 0,
      }))
      .sort((a, b) => {
        if (b.faultCount !== a.faultCount) {
          return b.faultCount - a.faultCount;
        }

        const statusRank = {
          down: 3,
          degraded: 2,
          up: 1,
        };

        return (
          (statusRank[String(b.status).toLowerCase()] || 0) -
          (statusRank[String(a.status).toLowerCase()] || 0)
        );
      })
      .slice(0, 5);
  }, [devices, faults]);

  const reportingPercentage = summary?.devices?.total
    ? Math.round((latestTelemetryByDevice.length / summary.devices.total) * 100)
    : 0;

  const latestTelemetryTime = useMemo(() => {
    const timestamps = latestTelemetryByDevice
      .map(({ latest }) => new Date(latest.recordedAt).getTime())
      .filter((time) => !Number.isNaN(time));

    if (!timestamps.length) {
      return null;
    }

    return new Date(Math.max(...timestamps));
  }, [latestTelemetryByDevice]);

  const healthStatus =
    Number(summary?.devices?.down ?? 0) > 0 ||
    Number(summary?.devices?.degraded ?? 0) > 0
      ? "DEGRADED"
      : "HEALTHY";

  const activeMetricConfig = METRIC_CONFIG[activeMetric];

  return (
    <main className="dashboard-v2-page">
      <header className="dashboard-v2-header">
        <div>
          <p className="eyebrow">NETFAULT AI</p>
          <h1>Welcome back, {user?.username}</h1>
          <p>Here&apos;s your network at a glance.</p>
        </div>
      </header>

      {loading && (
        <section className="dashboard-state">
          <div className="loading-spinner" />
          <p>Loading dashboard...</p>
        </section>
      )}

      {error && !loading && (
        <section className="dashboard-error">
          <strong>Unable to load dashboard</strong>
          <p>{error}</p>
        </section>
      )}

      {!loading && !error && (
        <div className="dashboard-v2-content">
          {/* Network Health */}
          <section className="dashboard-health-hero">
            <div className="dashboard-health-main">
              <p className="eyebrow">NETWORK HEALTH</p>

              <div className="dashboard-health-status">
                <span
                  className={`health-status-dot ${
                    healthStatus === "HEALTHY"
                      ? "health-good"
                      : "health-warning"
                  }`}
                />
                <strong>{healthStatus}</strong>
              </div>

              <p>
                {healthStatus === "HEALTHY"
                  ? "Network operating normally"
                  : "One or more devices need attention"}
              </p>
            </div>

            <div className="dashboard-health-stats">
              <HealthStat
                label="Total Devices"
                value={summary?.devices?.total ?? 0}
              />

              <HealthStat
                label="Up"
                value={summary?.devices?.up ?? 0}
                tone="good"
              />

              <HealthStat
                label="Degraded"
                value={summary?.devices?.degraded ?? 0}
                tone="warning"
              />

              <HealthStat
                label="Down"
                value={summary?.devices?.down ?? 0}
                tone="danger"
              />
            </div>

            <div className="dashboard-reporting">
              <div className="dashboard-reporting-heading">
                <span>TELEMETRY STATUS</span>
                <strong>
                  {latestTelemetryByDevice.length} /{" "}
                  {summary?.devices?.total ?? 0}
                </strong>
              </div>

              <p>Devices reporting</p>

              <div className="dashboard-reporting-bar">
                <span style={{ width: `${reportingPercentage}%` }} />
              </div>

              <small>
                {latestTelemetryTime
                  ? `Latest data: ${latestTelemetryTime.toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : "No telemetry data yet"}
              </small>
            </div>
          </section>

          {/* Key Metrics */}
          <section className="dashboard-section">
            <div className="dashboard-section-title">
              <div>
                <p className="eyebrow">KEY METRICS</p>
                <h2>Latest network telemetry</h2>
              </div>

              <span>Average across reporting devices</span>
            </div>

            <div className="dashboard-metric-grid">
              <MetricCard
                label="Latency"
                value={latestMetrics.latency}
                unit="ms"
                tone="blue"
              />

              <MetricCard
                label="Packet Loss"
                value={latestMetrics.packetLoss}
                unit="%"
                tone="red"
              />

              <MetricCard
                label="Jitter"
                value={latestMetrics.jitter}
                unit="ms"
                tone="orange"
              />

              <MetricCard
                label="Utilization"
                value={latestMetrics.utilization}
                unit="%"
                tone="purple"
              />
            </div>
          </section>

          {/* Main Monitoring Row */}
          <section className="dashboard-main-grid">
            <div className="dashboard-panel dashboard-performance-panel">
              <div className="dashboard-panel-header">
                <div>
                  <p className="eyebrow">NETWORK PERFORMANCE</p>
                  <h2>{activeMetricConfig.label}</h2>
                </div>

                <span className="dashboard-live-badge">
                  <span />
                  {latestTelemetryByDevice.length > 0
                    ? "Live data"
                    : "Waiting for data"}
                </span>
              </div>

              <div className="dashboard-metric-tabs">
                {Object.entries(METRIC_CONFIG).map(([key, metric]) => (
                  <button
                    type="button"
                    key={key}
                    className={activeMetric === key ? "active" : ""}
                    onClick={() => setActiveMetric(key)}
                  >
                    {metric.label}
                  </button>
                ))}
              </div>

              {telemetryChartData.length === 0 ? (
                <div className="dashboard-empty-panel">
                  <strong>No telemetry data yet</strong>
                  <span>
                    Network telemetry will appear here once devices start
                    reporting metrics.
                  </span>
                </div>
              ) : (
                <>
                  <div className="dashboard-chart-summary">
                    <strong>
                      {formatMetricValue(
                        latestMetrics[activeMetric],
                        activeMetricConfig.unit,
                      )}
                    </strong>
                    <span>
                      Average {activeMetricConfig.label.toLowerCase()}
                    </span>
                  </div>

                  <div className="dashboard-chart">
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart
                        data={telemetryChartData}
                        margin={{
                          top: 10,
                          right: 15,
                          left: 0,
                          bottom: 5,
                        }}
                      >
                        <CartesianGrid strokeDasharray="3 3" opacity={0.12} />

                        <XAxis
                          dataKey="label"
                          tick={{
                            fill: "#9ca3af",
                            fontSize: 10,
                          }}
                          axisLine={false}
                          tickLine={false}
                        />

                        <YAxis
                          tick={{
                            fill: "#9ca3af",
                            fontSize: 10,
                          }}
                          axisLine={false}
                          tickLine={false}
                        />

                        <Tooltip
                          content={
                            <DashboardChartTooltip
                              metric={activeMetricConfig}
                            />
                          }
                        />

                        <Line
                          type="monotone"
                          dataKey={activeMetricConfig.dataKey}
                          stroke={activeMetricConfig.color}
                          strokeWidth={3}
                          dot={false}
                          activeDot={{
                            r: 5,
                            strokeWidth: 2,
                          }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </div>

            <div className="dashboard-panel dashboard-health-panel">
              <div className="dashboard-panel-header">
                <div>
                  <p className="eyebrow">NETWORK HEALTH</p>
                  <h2>Device distribution</h2>
                </div>
              </div>

              <div className="dashboard-health-chart">
                <ResponsiveContainer width="100%" height={240}>
                  <PieChart>
                    <Pie
                      data={healthDistribution}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={65}
                      outerRadius={90}
                      paddingAngle={3}
                      stroke="none"
                    >
                      {healthDistribution.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>

                <div className="dashboard-health-center">
                  <strong>{summary?.devices?.total ?? 0}</strong>
                  <span>Devices</span>
                </div>
              </div>

              <div className="dashboard-health-legend">
                {healthDistribution.map((item) => (
                  <div key={item.name}>
                    <span
                      className="dashboard-legend-dot"
                      style={{ background: item.color }}
                    />
                    <span>{item.name}</span>
                    <strong>
                      {item.value} (
                      {summary?.devices?.total
                        ? Math.round((item.value / summary.devices.total) * 100)
                        : 0}
                      %)
                    </strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="dashboard-panel dashboard-alerts-panel">
              <DashboardPanelHeading
                eyebrow="RECENT ALERTS"
                title="Alerts"
                count={alerts.length}
              />

              {alerts.length === 0 ? (
                <CompactEmptyState
                  title="No alerts"
                  text="New monitoring alerts will appear here when detected."
                />
              ) : (
                <div className="dashboard-compact-list">
                  {alerts.slice(0, 5).map((alert) => (
                    <div className="dashboard-compact-row" key={alert.id}>
                      <div>
                        <strong>{alert.message}</strong>
                        <span>{formatDashboardDate(alert.createdAt)}</span>
                      </div>

                      <div className="dashboard-compact-meta">
                        <span
                          className={`dashboard-severity severity-${String(
                            alert.severity || "unknown",
                          ).toLowerCase()}`}
                        >
                          {formatDashboardLabel(alert.severity)}
                        </span>

                        <span>
                          {alert.acknowledged
                            ? "Acknowledged"
                            : "Unacknowledged"}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* Faults / Predictions / Devices */}
          <section className="dashboard-secondary-grid">
            <div className="dashboard-panel">
              <DashboardPanelHeading
                eyebrow="RECENT FAULTS"
                title="Faults"
                count={faults.length}
              />

              {faults.length === 0 ? (
                <CompactEmptyState
                  title="No faults recorded"
                  text="Confirmed and predicted faults will appear here."
                />
              ) : (
                <div className="dashboard-compact-list">
                  {faults.slice(0, 5).map((fault) => (
                    <div className="dashboard-compact-row" key={fault.id}>
                      <div>
                        <strong>{formatDashboardLabel(fault.faultType)}</strong>
                        <span>
                          Started {formatDashboardDate(fault.startedAt)}
                        </span>
                      </div>

                      <div className="dashboard-compact-meta">
                        <span
                          className={`dashboard-severity severity-${String(
                            fault.severity || "unknown",
                          ).toLowerCase()}`}
                        >
                          {formatDashboardLabel(fault.severity)}
                        </span>

                        <span>{formatDashboardLabel(fault.status)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="dashboard-panel">
              <DashboardPanelHeading
                eyebrow="PREDICTIONS"
                title="Predicted faults"
                count={predictions.length}
              />

              {predictions.length === 0 ? (
                <CompactEmptyState
                  title="No predictions yet"
                  text="Predictions will appear when the monitoring pipeline produces risk assessments."
                />
              ) : (
                <div className="dashboard-compact-list">
                  {predictions.slice(0, 5).map((prediction) => (
                    <div className="dashboard-compact-row" key={prediction.id}>
                      <div>
                        <strong>
                          {formatDashboardLabel(prediction.faultType)}
                        </strong>

                        <span>
                          {prediction.predictedWindowMinutes} min window ·{" "}
                          {formatDashboardDate(prediction.predictedAt)}
                        </span>
                      </div>

                      <div className="dashboard-prediction-risk">
                        <strong>
                          {Math.round(Number(prediction.riskScore) * 100)}%
                        </strong>

                        <span>{formatDashboardLabel(prediction.severity)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="dashboard-panel">
              <DashboardPanelHeading
                eyebrow="DEVICES"
                title="Devices needing attention"
                count={devices.length}
              />

              {deviceRows.length === 0 ? (
                <CompactEmptyState
                  title="No devices found"
                  text="Devices will appear here when they are registered."
                />
              ) : (
                <div className="dashboard-device-table">
                  <div className="dashboard-device-table-header">
                    <span>Device</span>
                    <span>Status</span>
                    <span>Faults</span>
                  </div>

                  {deviceRows.map((device) => (
                    <div className="dashboard-device-table-row" key={device.id}>
                      <div>
                        <strong>{device.name}</strong>
                        <span>
                          {device.ipAddress} · {device.location}
                        </span>
                      </div>

                      <span
                        className="device-status"
                        data-status={device.status?.toLowerCase() || "unknown"}
                      >
                        {device.status || "Unknown"}
                      </span>

                      <strong>{device.faultCount}</strong>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          {/* AI Standby */}
          <section className="dashboard-ai-panel">
            <div>
              <p className="eyebrow">AI INSIGHTS</p>
              <h2>AI analysis is not active yet</h2>
              <p>
                The monitoring dashboard is ready for the AI prediction
                pipeline. Once the AI service is connected, predictions and
                fault insights will appear here.
              </p>
            </div>

            <div className="dashboard-ai-status">
              <span />
              <strong>Awaiting AI service</strong>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function HealthStat({ label, value, tone = "" }) {
  return (
    <div className={`dashboard-health-stat ${tone}`}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function MetricCard({ label, value, unit, tone }) {
  return (
    <div className={`dashboard-metric-card ${tone}`}>
      <div className="dashboard-metric-card-heading">
        <span>{label}</span>
      </div>

      <strong>{value === null ? "—" : formatMetricValue(value, unit)}</strong>

      <span className="dashboard-metric-subtitle">Latest average</span>
    </div>
  );
}

function DashboardPanelHeading({ eyebrow, title, count }) {
  return (
    <div className="dashboard-panel-header">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>

      <span className="dashboard-panel-count">{count}</span>
    </div>
  );
}

function CompactEmptyState({ title, text }) {
  return (
    <div className="dashboard-compact-empty">
      <strong>{title}</strong>
      <span>{text}</span>
    </div>
  );
}

function DashboardChartTooltip({ active, payload, label, metric }) {
  if (!active || !payload?.length) {
    return null;
  }

  const value = payload[0]?.value;

  return (
    <div className="dashboard-chart-tooltip">
      <span>{label}</span>
      <strong>{formatMetricValue(value, metric.unit)}</strong>
      <small>{metric.label}</small>
    </div>
  );
}

function average(values) {
  const validValues = values.filter((value) => Number.isFinite(value));

  if (!validValues.length) {
    return null;
  }

  return (
    validValues.reduce((total, value) => total + value, 0) / validValues.length
  );
}

function formatMetricValue(value, unit) {
  if (value === null || value === undefined) {
    return "—";
  }

  const number = Number(value);

  if (!Number.isFinite(number)) {
    return "—";
  }

  const formatted = Number.isInteger(number)
    ? number.toString()
    : number.toFixed(1);

  return `${formatted} ${unit}`.trim();
}

function formatDashboardLabel(value) {
  return String(value || "unknown")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatDashboardDate(value) {
  if (!value) {
    return "Unknown time";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

  return date.toLocaleString([], {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default Dashboard;
