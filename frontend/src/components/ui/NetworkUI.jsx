import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  Network,
  Router as RouterIcon,
  Server,
  Shield,
  Wifi,
  XCircle,
} from "lucide-react";
import { useState } from "react";

/* =========================================================
   DEVICE ICONS
========================================================= */

const DEVICE_ICONS = {
  router: RouterIcon,
  switch: Network,
  firewall: Shield,
  access_point: Wifi,
  server: Server,
};

/* =========================================================
   STATUS
========================================================= */

const STATUS = {
  up: {
    label: "Up",
    Icon: CheckCircle2,
    tone: "ok",
  },

  degraded: {
    label: "Degraded",
    Icon: AlertTriangle,
    tone: "warn",
  },

  down: {
    label: "Down",
    Icon: XCircle,
    tone: "crit",
  },
};

export function StatusBadge({ status }) {
  const normalized = String(status || "down").toLowerCase();

  const config = STATUS[normalized] || STATUS.down;

  const { label, Icon, tone } = config;

  return (
    <span className={`status-badge status-badge--${tone}`} role="status">
      <Icon size={15} strokeWidth={2.5} aria-hidden="true" />

      <span>{label}</span>
    </span>
  );
}

/* =========================================================
   VISUAL LIVE INDICATOR
   IMPORTANT:
   This is only a visual activity indicator.
   It does NOT claim a WebSocket connection.
========================================================= */

export function LiveIndicator() {
  return (
    <span
      className="live-indicator"
      role="status"
      title="Activity indicator — real-time WebSocket is not connected yet"
    >
      <span className="status-pulse-dot" aria-hidden="true" />

      <strong>LIVE</strong>
    </span>
  );
}

/* =========================================================
   STATUS FILTER
========================================================= */

export function StatusFilter({ counts, value, onChange }) {
  const filters = [
    ["all", "ALL"],
    ["up", "UP"],
    ["degraded", "DEGRADED"],
    ["down", "DOWN"],
  ];

  return (
    <div
      className="status-filter-group"
      role="group"
      aria-label="Filter devices by status"
    >
      {filters.map(([key, label]) => {
        const empty = key !== "all" && counts[key] === 0;

        return (
          <button
            key={key}
            type="button"
            className={`status-filter-button ${value === key ? "active" : ""}`}
            aria-pressed={value === key}
            disabled={empty}
            onClick={() => onChange(key)}
          >
            <span>{label}</span>

            {key !== "all" && (
              <span className="filter-count">{counts[key]}</span>
            )}

            {key === "all" && (
              <span className="filter-count">{counts.all}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* =========================================================
   DEVICE ICON
========================================================= */

export function DeviceTypeIcon({ type }) {
  const Icon = DEVICE_ICONS[type] || Server;

  return (
    <div className="device-icon">
      <Icon size={30} strokeWidth={1.8} aria-hidden="true" />
    </div>
  );
}

/* =========================================================
   BREADCRUMB
========================================================= */

export function Breadcrumb({ items, onNavigate }) {
  return (
    <nav className="breadcrumb-nav" aria-label="Breadcrumb">
      <ol>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`}>
            {item.action ? (
              <button type="button" onClick={() => onNavigate?.(item.action)}>
                {item.label}
              </button>
            ) : (
              <span
                aria-current={index === items.length - 1 ? "page" : undefined}
              >
                {item.label}
              </span>
            )}

            {index < items.length - 1 && (
              <ChevronRight size={14} aria-hidden="true" />
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

/* =========================================================
   COPY VALUE
========================================================= */

export function CopyValue({ value }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(String(value));

      setCopied(true);

      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard may be unavailable.
    }
  }

  return (
    <span className="copy-value">
      <code>{value}</code>

      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : `Copy ${value}`}
        title={copied ? "Copied" : `Copy ${value}`}
      >
        {copied ? <Check size={15} /> : <Copy size={15} />}
      </button>
    </span>
  );
}

/* =========================================================
   TIME FORMAT
========================================================= */

export function formatWhen(iso) {
  if (!iso) {
    return {
      relative: "Unknown",
      absolute: "Unknown",
    };
  }

  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return {
      relative: "Unknown",
      absolute: "Unknown",
    };
  }

  const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);

  const units = [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];

  const [unit, size] = units.find(
    ([, seconds]) => Math.abs(diffSeconds) >= seconds,
  ) || ["second", 1];

  const relative = new Intl.RelativeTimeFormat(undefined, {
    numeric: "auto",
  }).format(Math.round(diffSeconds / size), unit);

  const absolute = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);

  return {
    relative,
    absolute,
  };
}

/* =========================================================
   TELEMETRY EMPTY
========================================================= */

export function TelemetryEmpty({ range }) {
  return (
    <div className="telemetry-empty-state" role="status">
      <Activity size={30} strokeWidth={1.7} aria-hidden="true" />

      <h3>No telemetry in the last {range}</h3>

      <p>This device has not reported telemetry for the selected period.</p>

      <p className="telemetry-last-reported">Last reported: Never</p>
    </div>
  );
}

/* =========================================================
   PASSWORD INPUT
========================================================= */

export function PasswordField({ value, onChange, error }) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="login-field">
      <label htmlFor="password">PASSWORD</label>

      <div className="password-input">
        <input
          id="password"
          type={visible ? "text" : "password"}
          value={value}
          onChange={onChange}
          placeholder="Enter your password"
          autoComplete="current-password"
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "password-error" : undefined}
        />

        <button
          type="button"
          onClick={() => setVisible((current) => !current)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          {visible ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>
      </div>

      {error && (
        <span id="password-error" className="field-error" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
