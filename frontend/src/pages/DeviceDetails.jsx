import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { getDevice, getDeviceTelemetry } from "../api/client";

import {
  Breadcrumb,
  CopyValue,
  DeviceTypeIcon,
  StatusBadge,
  TelemetryEmpty,
  formatWhen,
} from "../components/ui/NetworkUI";

function DeviceDetails({ deviceId, onBack }) {
  const [device, setDevice] = useState(null);
  const [telemetry, setTelemetry] = useState([]);

  const [range, setRange] = useState("1h");

  const [loading, setLoading] = useState(true);
  const [telemetryLoading, setTelemetryLoading] = useState(false);

  const [error, setError] = useState("");

  useEffect(() => {
    let mounted = true;

    async function loadDevice() {
      try {
        setLoading(true);
        setError("");

        const data = await getDevice(deviceId);

        if (mounted) {
          setDevice(data);
        }
      } catch (err) {
        if (mounted) {
          setError(err?.message || "Failed to load device");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    loadDevice();

    return () => {
      mounted = false;
    };
  }, [deviceId]);

  useEffect(() => {
    let mounted = true;

    async function loadTelemetry() {
      try {
        setTelemetryLoading(true);

        const data = await getDeviceTelemetry(deviceId, range);

        if (mounted) {
          setTelemetry(Array.isArray(data?.telemetry) ? data.telemetry : []);
        }
      } catch {
        if (mounted) {
          setTelemetry([]);
        }
      } finally {
        if (mounted) {
          setTelemetryLoading(false);
        }
      }
    }

    loadTelemetry();

    return () => {
      mounted = false;
    };
  }, [deviceId, range]);

  const lastReported = useMemo(() => {
    if (!telemetry.length) {
      return {
        relative: "Never",
        absolute: "No telemetry has been recorded",
      };
    }

    const timestamp = findTelemetryTimestamp(telemetry);

    if (!timestamp) {
      return {
        relative: "Recorded",
        absolute: "Telemetry exists for the selected period",
      };
    }

    return formatWhen(timestamp);
  }, [telemetry]);

  const chartData = useMemo(() => {
    return telemetry
      .map((item) => {
        const timestamp = item?.recordedAt;

        if (!timestamp) {
          return null;
        }

        const date = new Date(timestamp);

        if (Number.isNaN(date.getTime())) {
          return null;
        }

        return {
          time: date.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          }),
          latency: Number(item.latencyMs ?? 0),
          packetLoss: Number(item.packetLossPct ?? 0),
          jitter: Number(item.jitterMs ?? 0),
          utilization: Number(item.utilizationPct ?? 0),
          cpu: Number(item.cpuPct ?? 0),
          memory: Number(item.memoryPct ?? 0),
        };
      })
      .filter(Boolean);
  }, [telemetry]);
  const latestTelemetry = telemetry[telemetry.length - 1] ?? null;

  if (loading) {
    return (
      <div className="page-scroll">
        <div className="page-state">
          <div className="loading-indicator" />

          <strong>Loading device</strong>

          <span>Fetching device information...</span>
        </div>
      </div>
    );
  }

  if (!device || error) {
    return (
      <div className="page-scroll">
        <div className="page-state error-state">
          <strong>Device unavailable</strong>

          <span>{error || "The requested device could not be found."}</span>

          <button type="button" className="primary-action" onClick={onBack}>
            Back to devices
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="detail-scroll-area">
      <button type="button" className="detail-back-button" onClick={onBack}>
        <ArrowLeft size={17} strokeWidth={2.5} />
        <span>Back to devices</span>
      </button>

      <Breadcrumb
        items={[
          {
            label: "Devices",
            action: "devices",
          },
          {
            label: device.name,
          },
        ]}
        onNavigate={(page) => {
          if (page === "devices") {
            onBack();
          }
        }}
      />

      {/* DEVICE HEADER */}
      <section className="device-detail-hero">
        <div className="detail-title-block">
          <div className="detail-device-type">
            <DeviceTypeIcon type={device.type} />

            <span>{formatDeviceType(device.type)}</span>
          </div>

          <div className="detail-title-row">
            <h1>{device.name}</h1>

            <StatusBadge status={device.status} />
          </div>

          <p className="detail-last-reported">
            Last reported:{" "}
            <time title={lastReported.absolute}>{lastReported.relative}</time>
          </p>
        </div>
      </section>

      {/* STATIC DEVICE INFORMATION */}
      <section className="detail-grid">
        <div className="detail-panel">
          <div className="panel-heading">
            <span>Device information</span>
          </div>

          <dl className="detail-definition-list">
            <dt>IP address</dt>

            <dd>
              <CopyValue value={device.ipAddress} />
            </dd>

            <dt>Type</dt>

            <dd>{formatDeviceType(device.type)}</dd>

            <dt>Location</dt>

            <dd>{device.location || "Not specified"}</dd>

            <dt>Last reported</dt>

            <dd>
              <time title={lastReported.absolute}>{lastReported.relative}</time>
            </dd>
          </dl>
        </div>

        {/* INTERFACES */}
        <div className="detail-panel">
          <div className="panel-heading">
            <span>Interfaces</span>

            <strong>
              {device.interfaces?.length || 0}{" "}
              {device.interfaces?.length === 1 ? "interface" : "interfaces"}
            </strong>
          </div>

          <div className="interfaces-list">
            {device.interfaces?.length ? (
              device.interfaces.map((item) => (
                <div className="interface-row" key={item.id}>
                  <div className="interface-main">
                    <strong>{item.name}</strong>

                    <span>{formatInterfaceStatus(item.status)}</span>
                  </div>

                  <StatusBadge status={item.status} />
                </div>
              ))
            ) : (
              <div className="empty-inline">No interfaces registered</div>
            )}
          </div>
        </div>
      </section>

      {/* TELEMETRY */}
      <section className="telemetry-panel">
        <div className="telemetry-header">
          <div>
            <span className="panel-kicker">Telemetry</span>

            <h2>Network metrics</h2>
          </div>

          <div className="range-controls" aria-label="Telemetry time range">
            {["1h", "6h", "24h"].map((value) => (
              <button
                key={value}
                type="button"
                className={range === value ? "active" : ""}
                onClick={() => setRange(value)}
                aria-pressed={range === value}
              >
                {value}
              </button>
            ))}
          </div>
        </div>

        <div className="telemetry-body">
          {telemetryLoading ? (
            <div className="telemetry-loading">
              <div className="loading-indicator" />

              <strong>Loading telemetry</strong>

              <span>Fetching metrics for the selected period...</span>
            </div>
          ) : telemetry.length === 0 ? (
            <TelemetryEmpty range={range} />
          ) : chartData.length === 0 ? (
            <TelemetryEmpty range={range} />
          ) : (
            <>
              {/* NETWORK SUMMARY */}
              <div className="telemetry-metric-grid">
                <TelemetryMetric
                  label="Latency"
                  value={latestTelemetry?.latencyMs}
                  unit="ms"
                  tone="latency"
                />

                <TelemetryMetric
                  label="Packet Loss"
                  value={latestTelemetry?.packetLossPct}
                  unit="%"
                  tone="packet-loss"
                />

                <TelemetryMetric
                  label="Jitter"
                  value={latestTelemetry?.jitterMs}
                  unit="ms"
                  tone="jitter"
                />
              </div>

              {/* NETWORK PERFORMANCE */}
              <section className="telemetry-chart-panel">
                <div className="telemetry-chart-heading">
                  <div>
                    <span className="panel-kicker">Network performance</span>

                    <h3>Latency, packet loss and jitter</h3>
                  </div>

                  <div className="telemetry-legend">
                    <TelemetryLegend color="#3b82f6" label="Latency" />
                    <TelemetryLegend color="#ef4444" label="Packet Loss" />
                    <TelemetryLegend color="#f59e0b" label="Jitter" />
                  </div>
                </div>

                <div className="telemetry-chart">
                  <ResponsiveContainer width="100%" height={360}>
                    <LineChart
                      data={chartData}
                      margin={{
                        top: 12,
                        right: 18,
                        left: 8,
                        bottom: 8,
                      }}
                    >
                      <CartesianGrid
                        stroke="#303030"
                        strokeDasharray="3 3"
                        vertical={false}
                      />

                      <XAxis
                        dataKey="time"
                        stroke="#777"
                        tick={{ fill: "#999", fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: "#444" }}
                      />

                      <YAxis
                        yAxisId="ms"
                        stroke="#3b82f6"
                        tick={{ fill: "#999", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={45}
                        label={{
                          value: "ms",
                          angle: -90,
                          position: "insideLeft",
                          fill: "#3b82f6",
                          fontSize: 11,
                        }}
                      />

                      <YAxis
                        yAxisId="percent"
                        orientation="right"
                        domain={[0, 100]}
                        stroke="#ef4444"
                        tick={{ fill: "#999", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={45}
                        label={{
                          value: "%",
                          angle: 90,
                          position: "insideRight",
                          fill: "#ef4444",
                          fontSize: 11,
                        }}
                      />

                      <Tooltip content={<TelemetryTooltip />} />

                      <Line
                        yAxisId="ms"
                        type="monotone"
                        dataKey="latency"
                        name="Latency"
                        stroke="#3b82f6"
                        strokeWidth={3}
                        dot={{
                          r: 3,
                          fill: "#3b82f6",
                          stroke: "#111",
                          strokeWidth: 2,
                        }}
                        activeDot={{
                          r: 5,
                          fill: "#3b82f6",
                        }}
                      />

                      <Line
                        yAxisId="percent"
                        type="monotone"
                        dataKey="packetLoss"
                        name="Packet Loss"
                        stroke="#ef4444"
                        strokeWidth={3}
                        dot={{
                          r: 3,
                          fill: "#ef4444",
                          stroke: "#111",
                          strokeWidth: 2,
                        }}
                        activeDot={{
                          r: 5,
                          fill: "#ef4444",
                        }}
                      />

                      <Line
                        yAxisId="ms"
                        type="monotone"
                        dataKey="jitter"
                        name="Jitter"
                        stroke="#f59e0b"
                        strokeWidth={3}
                        dot={{
                          r: 3,
                          fill: "#f59e0b",
                          stroke: "#111",
                          strokeWidth: 2,
                        }}
                        activeDot={{
                          r: 5,
                          fill: "#f59e0b",
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* RESOURCE SUMMARY */}
              <div className="telemetry-resource-grid">
                <TelemetryMetric
                  label="Utilization"
                  value={latestTelemetry?.utilizationPct}
                  unit="%"
                  tone="utilization"
                />

                <TelemetryMetric
                  label="CPU Usage"
                  value={latestTelemetry?.cpuPct}
                  unit="%"
                  tone="cpu"
                />

                <TelemetryMetric
                  label="Memory Usage"
                  value={latestTelemetry?.memoryPct}
                  unit="%"
                  tone="memory"
                />

                <TelemetryMetric
                  label="Availability"
                  value={latestTelemetry?.availability ? "Up" : "Down"}
                  tone={
                    latestTelemetry?.availability
                      ? "availability-up"
                      : "availability-down"
                  }
                />
              </div>

              {/* RESOURCE CHART */}
              <section className="telemetry-chart-panel">
                <div className="telemetry-chart-heading">
                  <div>
                    <span className="panel-kicker">Resource health</span>

                    <h3>Utilization, CPU and memory</h3>
                  </div>

                  <div className="telemetry-legend">
                    <TelemetryLegend color="#a855f7" label="Utilization" />
                    <TelemetryLegend color="#14b8a6" label="CPU" />
                    <TelemetryLegend color="#ec4899" label="Memory" />
                  </div>
                </div>

                <div className="telemetry-chart">
                  <ResponsiveContainer width="100%" height={320}>
                    <LineChart
                      data={chartData}
                      margin={{
                        top: 12,
                        right: 18,
                        left: 8,
                        bottom: 8,
                      }}
                    >
                      <CartesianGrid
                        stroke="#303030"
                        strokeDasharray="3 3"
                        vertical={false}
                      />

                      <XAxis
                        dataKey="time"
                        stroke="#777"
                        tick={{ fill: "#999", fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: "#444" }}
                      />

                      <YAxis
                        domain={[0, 100]}
                        tick={{ fill: "#999", fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={45}
                        tickFormatter={(value) => `${value}%`}
                      />

                      <Tooltip content={<ResourceTooltip />} />

                      <Line
                        type="monotone"
                        dataKey="utilization"
                        name="Utilization"
                        stroke="#a855f7"
                        strokeWidth={3}
                        dot={{
                          r: 3,
                          fill: "#a855f7",
                          stroke: "#111",
                          strokeWidth: 2,
                        }}
                      />

                      <Line
                        type="monotone"
                        dataKey="cpu"
                        name="CPU"
                        stroke="#14b8a6"
                        strokeWidth={3}
                        dot={{
                          r: 3,
                          fill: "#14b8a6",
                          stroke: "#111",
                          strokeWidth: 2,
                        }}
                      />

                      <Line
                        type="monotone"
                        dataKey="memory"
                        name="Memory"
                        stroke="#ec4899"
                        strokeWidth={3}
                        dot={{
                          r: 3,
                          fill: "#ec4899",
                          stroke: "#111",
                          strokeWidth: 2,
                        }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function TelemetryMetric({ label, value, unit = "", tone }) {
  const displayValue =
    typeof value === "number"
      ? Number.isInteger(value)
        ? value
        : value.toFixed(1)
      : (value ?? "—");

  return (
    <div className={`telemetry-metric-card telemetry-metric-${tone}`}>
      <div className="telemetry-metric-indicator" />

      <div className="telemetry-metric-content">
        <span>{label}</span>

        <strong>
          {displayValue}
          {unit && <small>{unit}</small>}
        </strong>
      </div>
    </div>
  );
}

function TelemetryLegend({ color, label }) {
  return (
    <span className="telemetry-legend-item">
      <i style={{ background: color }} />
      {label}
    </span>
  );
}

function TelemetryTooltip({ active, payload, label }) {
  if (!active || !payload?.length) {
    return null;
  }

  const values = {
    latency: payload.find((item) => item.dataKey === "latency")?.value,
    packetLoss: payload.find((item) => item.dataKey === "packetLoss")?.value,
    jitter: payload.find((item) => item.dataKey === "jitter")?.value,
  };

  return (
    <div className="telemetry-tooltip">
      <strong>{label}</strong>

      <div className="telemetry-tooltip-row">
        <span>
          <i className="tooltip-dot latency-dot" />
          Latency
        </span>
        <b>{values.latency ?? "—"} ms</b>
      </div>

      <div className="telemetry-tooltip-row">
        <span>
          <i className="tooltip-dot packet-loss-dot" />
          Packet Loss
        </span>
        <b>{values.packetLoss ?? "—"}%</b>
      </div>

      <div className="telemetry-tooltip-row">
        <span>
          <i className="tooltip-dot jitter-dot" />
          Jitter
        </span>
        <b>{values.jitter ?? "—"} ms</b>
      </div>
    </div>
  );
}

function ResourceTooltip({ active, payload, label }) {
  if (!active || !payload?.length) {
    return null;
  }

  const values = {
    utilization: payload.find((item) => item.dataKey === "utilization")?.value,
    cpu: payload.find((item) => item.dataKey === "cpu")?.value,
    memory: payload.find((item) => item.dataKey === "memory")?.value,
  };

  return (
    <div className="telemetry-tooltip">
      <strong>{label}</strong>

      <div className="telemetry-tooltip-row">
        <span>
          <i className="tooltip-dot utilization-dot" />
          Utilization
        </span>
        <b>{values.utilization ?? "—"}%</b>
      </div>

      <div className="telemetry-tooltip-row">
        <span>
          <i className="tooltip-dot cpu-dot" />
          CPU
        </span>
        <b>{values.cpu ?? "—"}%</b>
      </div>

      <div className="telemetry-tooltip-row">
        <span>
          <i className="tooltip-dot memory-dot" />
          Memory
        </span>
        <b>{values.memory ?? "—"}%</b>
      </div>
    </div>
  );
}

function formatDeviceType(type) {
  return String(type || "device")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatInterfaceStatus(status) {
  const normalized = String(status || "").toLowerCase();

  if (normalized === "up") {
    return "Operational";
  }

  if (normalized === "degraded") {
    return "Degraded";
  }

  if (normalized === "down") {
    return "Down";
  }

  return "Unknown";
}

function findTelemetryTimestamp(items) {
  const candidates = ["recordedAt", "timestamp", "createdAt"];

  for (const item of items) {
    for (const key of candidates) {
      if (item?.[key]) {
        const date = new Date(item[key]);

        if (!Number.isNaN(date.getTime())) {
          return item[key];
        }
      }
    }
  }

  return null;
}

export default DeviceDetails;
