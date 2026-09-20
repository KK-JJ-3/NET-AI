import { UserRound } from "lucide-react";

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

  return (
    <header className="topbar">
      <div className="topbar-context">
        <span className="topbar-slash">/</span>

        <strong>{pageLabel}</strong>
      </div>

      <div className="topbar-right">
        <div
          className="api-connection-indicator"
          role="status"
          title="REST API connection is available"
        >
          <span className="api-status-dot" aria-hidden="true" />

          <strong>API CONNECTED</strong>
        </div>

        <div className="user-profile">
          <div className="user-avatar">
            <UserRound size={18} aria-hidden="true" />
          </div>

          <div className="user-profile-copy">
            <strong>admin</strong>
          </div>
        </div>
      </div>
    </header>
  );
}

export default TopBar;
