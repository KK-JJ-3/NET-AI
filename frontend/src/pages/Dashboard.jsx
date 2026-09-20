import { useEffect, useState } from "react";
import { getDashboardSummary, getDevices } from "../api/client";
import { useAuth } from "../auth/AuthContext";

function Dashboard() {
  const { user, logout } = useAuth();

  const [summary, setSummary] = useState(null);
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadDashboard() {
      try {
        const [summaryData, devicesData] = await Promise.all([
          getDashboardSummary(),
          getDevices(),
        ]);

        setSummary(summaryData);
        setDevices(devicesData);
      } catch (err) {
        setError(err.message || "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }

    loadDashboard();
  }, []);

  return (
    <main className="dashboard-page">
      <header className="dashboard-header">
        <div>
          <p className="eyebrow">NETFAULT AI</p>
          <h1>Network Dashboard</h1>
          <p>Welcome, {user?.username}</p>
        </div>

        <button type="button" className="logout-button" onClick={logout}>
          Logout
        </button>
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
        <>
          <section className="stats-grid">
            <div className="stat-card">
              <span>Total Devices</span>
              <strong>{summary?.totalDevices ?? devices.length}</strong>
            </div>

            <div className="stat-card">
              <span>Active Devices</span>
              <strong>{summary?.activeDevices ?? "—"}</strong>
            </div>

            <div className="stat-card">
              <span>Active Faults</span>
              <strong>{summary?.activeFaults ?? "—"}</strong>
            </div>

            <div className="stat-card">
              <span>Active Alerts</span>
              <strong>{summary?.activeAlerts ?? "—"}</strong>
            </div>
          </section>

          <section className="devices-card">
            <div className="section-heading">
              <div>
                <p className="eyebrow">INFRASTRUCTURE</p>
                <h2>Devices</h2>
              </div>

              <span>{devices.length} devices</span>
            </div>

            {devices.length === 0 ? (
              <div className="empty-state">No devices found.</div>
            ) : (
              <div className="device-list">
                {devices.map((device) => (
                  <div className="device-row" key={device.id}>
                    <div>
                      <strong>{device.name}</strong>
                      <span>
                        {device.ipAddress} · {device.location}
                      </span>
                    </div>

                    <span className="device-status">
                      {device.status || "Unknown"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </main>
  );
}

export default Dashboard;
