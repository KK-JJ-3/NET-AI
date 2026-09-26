import {
  Bell,
  Boxes,
  ChartNoAxesCombined,
  CircleAlert,
  LayoutDashboard,
  LogOut,
  Network,
} from "lucide-react";

import { useAuth } from "../../auth/AuthContext";

const navigation = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: LayoutDashboard,
    available: true,
  },
  {
    id: "devices",
    label: "Devices",
    icon: Boxes,
    available: true,
  },
  {
    id: "predictions",
    label: "Predictions",
    icon: ChartNoAxesCombined,
    available: true,
  },
  {
    id: "faults",
    label: "Faults",
    icon: CircleAlert,
    available: true,
  },
  {
    id: "alerts",
    label: "Alerts",
    icon: Bell,
    available: true,
  },
  {
    id: "topology",
    label: "Topology",
    icon: Network,
    available: false,
  },
];

function Sidebar({ activePage, onNavigate }) {
  const { logout } = useAuth();

  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <div className="brand-mark">NF</div>

        <div className="brand-text">
          <strong>NETFAULT</strong>

          <span>AI / MONITOR</span>
        </div>
      </div>

      <div className="sidebar-navigation">
        <span className="sidebar-label">Navigation</span>

        <nav aria-label="Main navigation">
          {navigation.map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.id}
                type="button"
                className={`sidebar-nav-item ${
                  activePage === item.id ? "active" : ""
                } ${!item.available ? "disabled" : ""}`}
                disabled={!item.available}
                onClick={() => onNavigate(item.id)}
                aria-current={activePage === item.id ? "page" : undefined}
                title={
                  item.available
                    ? item.label
                    : `${item.label} is not available yet`
                }
              >
                <Icon size={17} strokeWidth={2} aria-hidden="true" />

                <span>{item.label}</span>

                {!item.available && (
                  <span className="nav-coming-soon">Soon</span>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div className="sidebar-bottom">
        <div className="sidebar-system-note">
          <span className="api-status-dot" aria-hidden="true" />

          <span>System online</span>
        </div>

        <button type="button" className="logout-button" onClick={logout}>
          <LogOut size={16} aria-hidden="true" />

          <span>Log out</span>
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
