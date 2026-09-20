import { ArrowLeft } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

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
          setTelemetry(Array.isArray(data) ? data : []);
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
          ) : (
            <pre className="telemetry-json">
              {JSON.stringify(telemetry, null, 2)}
            </pre>
          )}
        </div>
      </section>
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
