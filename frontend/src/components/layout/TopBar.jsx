import { UserRound } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { useMonitoringUpdates } from "../../hooks/useMonitoringUpdates";

const PAGE_LABELS = {
  dashboard: "Dashboard",
  devices: "Devices",
  predictions: "Predictions",
  faults: "Faults",
  alerts: "Alerts",
  topology: "Topology",
};

function TopBar({ activePage }) {
  const pageLabel = PAGE_LABELS[activePage] || "Network Monitor";
  const { user } = useAuth();
  const { connectionStatus } = useMonitoringUpdates();

  return (
    <header className="topbar">
      <div className="topbar-context">
        <span className="topbar-slash">/</span>
        <strong>{pageLabel}</strong>
      </div>
      <div className="topbar-right">
        <div
          className={`api-connection-indicator is-${connectionStatus}`}
          role="status"
          title="Socket.IO realtime connection"
        >
          <span className="api-status-dot" aria-hidden="true" />
          <strong>
            LIVE{" "}
            {connectionStatus === "connected"
              ? "CONNECTED"
              : connectionStatus === "connecting"
                ? "CONNECTING"
                : "OFFLINE"}
          </strong>
        </div>
        <div className="user-profile">
          <div className="user-avatar">
            <UserRound size={18} aria-hidden="true" />
          </div>
          <div className="user-profile-copy">
            <strong>{user?.username || "User"}</strong>
          </div>
        </div>
      </div>
    </header>
  );
}

export default TopBar;
