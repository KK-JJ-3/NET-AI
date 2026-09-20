import {
  Server,
  Router,
  Network,
  Shield,
  Wifi,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from "lucide-react";

const DEVICE_ICONS = {
  server: Server,
  router: Router,
  switch: Network,
  firewall: Shield,
  access_point: Wifi,
};

const STATUS_CONFIG = {
  up: {
    label: "Up",
    icon: CheckCircle2,
    className: "status-up",
  },
  degraded: {
    label: "Degraded",
    icon: AlertTriangle,
    className: "status-degraded",
  },
  down: {
    label: "Down",
    icon: XCircle,
    className: "status-down",
  },
};

function DeviceCard({ device, onSelectDevice }) {
  const DeviceIcon = DEVICE_ICONS[device.type] || Server;

  const status = STATUS_CONFIG[device.status] || {
    label: "Unknown",
    icon: AlertTriangle,
    className: "status-unknown",
  };

  const StatusIcon = status.icon;

  function handleKeyDown(event) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelectDevice(device.id);
    }
  }

  return (
    <article
      className={`device-card ${status.className}`}
      role="button"
      tabIndex={0}
      onClick={() => onSelectDevice(device.id)}
      onKeyDown={handleKeyDown}
      aria-label={`Open ${device.name}`}
    >
      <div className="device-card-top">
        <span className="device-type">{formatDeviceType(device.type)}</span>

        <span className={`device-status ${status.className}`}>
          <StatusIcon size={16} strokeWidth={2.5} />
          {status.label}
        </span>
      </div>

      <div className="device-card-main">
        <div className="device-icon" aria-hidden="true">
          <DeviceIcon size={28} strokeWidth={1.8} />
        </div>

        <div className="device-card-title">
          <h3 title={device.name}>{device.name}</h3>

          <code>{device.ipAddress || "No IP address"}</code>
        </div>
      </div>

      <div className="device-card-location">
        <span>Location</span>

        <strong title={device.location || "Not specified"}>
          {device.location || "Not specified"}
        </strong>
      </div>
    </article>
  );
}

function formatDeviceType(type) {
  return String(type || "device")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default DeviceCard;
