import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, SlidersHorizontal } from "lucide-react";

import { getDevices } from "../api/client";
import DeviceList from "../components/devices/DeviceList";

function Devices({ onSelectDevice }) {
  const [devices, setDevices] = useState([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState(null);

  async function loadDevices(isRefresh = false) {
    try {
      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError("");

      const data = await getDevices();

      setDevices(Array.isArray(data) ? data : []);
      setLastUpdated(new Date());
    } catch (err) {
      setError(err.message || "Failed to load devices");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    loadDevices();
  }, []);

  const counts = useMemo(
    () => ({
      all: devices.length,
      up: devices.filter((device) => device.status === "up").length,
      degraded: devices.filter((device) => device.status === "degraded").length,
      down: devices.filter((device) => device.status === "down").length,
    }),
    [devices],
  );

  const filteredDevices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    const result = devices.filter((device) => {
      const matchesStatus =
        statusFilter === "all" || device.status === statusFilter;

      const matchesSearch =
        !query ||
        device.name?.toLowerCase().includes(query) ||
        device.ipAddress?.toLowerCase().includes(query) ||
        device.location?.toLowerCase().includes(query) ||
        device.type?.toLowerCase().includes(query);

      return matchesStatus && matchesSearch;
    });

    return [...result].sort((a, b) => {
      let first = "";
      let second = "";

      if (sortBy === "name") {
        first = a.name || "";
        second = b.name || "";
      }

      if (sortBy === "type") {
        first = a.type || "";
        second = b.type || "";
      }

      if (sortBy === "location") {
        first = a.location || "";
        second = b.location || "";
      }

      const comparison = first.localeCompare(second);

      return sortDirection === "asc" ? comparison : -comparison;
    });
  }, [devices, statusFilter, searchQuery, sortBy, sortDirection]);

  const visibleCount =
    statusFilter === "all" && !searchQuery
      ? devices.length
      : filteredDevices.length;

  function handleSortChange(event) {
    const value = event.target.value;

    if (value === sortBy) {
      setSortDirection((current) => (current === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(value);
      setSortDirection("asc");
    }
  }

  if (loading) {
    return (
      <div className="page-content">
        <div className="state-panel">
          <div className="loading-indicator" />
          <strong>Loading devices</strong>
          <span>Fetching registered network devices...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-content">
        <div className="state-panel error-state">
          <strong>Unable to load devices</strong>
          <span>{error}</span>

          <button
            type="button"
            className="dynamic-neo-btn"
            onClick={() => loadDevices()}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="devices-page">
      {/* HERO */}
      <section className="devices-hero">
        <div className="devices-hero-copy">
          <div className="page-eyebrow">Infrastructure</div>

          <h1 className="page-title">Network devices</h1>

          <p className="page-subtitle">Every device on your network.</p>
        </div>

        <div className="total-card">
          <span className="total-card-label">Total</span>

          <strong>{String(devices.length).padStart(2, "0")}</strong>

          <span className="total-card-caption">Devices</span>
        </div>
      </section>

      {/* CONTROLS */}
      <section className="device-controls">
        <div className="device-search">
          <Search size={19} strokeWidth={2.2} />

          <input
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search name, IP or location..."
            aria-label="Search devices"
          />
        </div>

        <label className="sort-control">
          <SlidersHorizontal size={17} />

          <span>Sort</span>

          <select
            value={sortBy}
            onChange={handleSortChange}
            aria-label="Sort devices"
          >
            <option value="name">Name</option>
            <option value="type">Type</option>
            <option value="location">Location</option>
          </select>

          <span className="sort-direction" aria-hidden="true">
            {sortDirection === "asc" ? "↑" : "↓"}
          </span>
        </label>

        <button
          type="button"
          className="refresh-button"
          onClick={() => loadDevices(true)}
          disabled={refreshing}
        >
          <RefreshCw size={17} className={refreshing ? "spin" : ""} />

          <span>{refreshing ? "Refreshing" : "Refresh"}</span>
        </button>
      </section>

      {/* FILTERS */}
      <section className="nf-chips" aria-label="Device status filters">
        <span className="filter-label">Status</span>

        {[
          ["all", "All", counts.all],
          ["up", "Up", counts.up],
          ["degraded", "Degraded", counts.degraded],
          ["down", "Down", counts.down],
        ].map(([value, label, count]) => {
          const active = statusFilter === value;

          return (
            <button
              key={value}
              type="button"
              className={`status-filter ${
                active ? "active" : ""
              } ${count === 0 ? "empty" : ""}`}
              onClick={() => setStatusFilter(value)}
              aria-pressed={active}
            >
              <span>{label}</span>
              <strong>{count}</strong>
            </button>
          );
        })}

        <div className="device-results-meta">
          <span>
            {visibleCount} {visibleCount === 1 ? "device" : "devices"}
          </span>

          {lastUpdated && (
            <span>Updated {formatRelativeTime(lastUpdated)}</span>
          )}
        </div>
      </section>

      {/* DEVICE GRID */}
      <section className="devices-grid-section">
        {filteredDevices.length === 0 ? (
          <div className="state-panel empty-state">
            <strong>No devices found</strong>

            <span>
              {searchQuery
                ? "Try a different search."
                : "No devices match the selected status."}
            </span>
          </div>
        ) : (
          <DeviceList
            devices={filteredDevices}
            onSelectDevice={onSelectDevice}
          />
        )}
      </section>
    </div>
  );
}

function formatRelativeTime(date) {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 5) {
    return "just now";
  }

  if (seconds < 60) {
    return `${seconds}s ago`;
  }

  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) {
    return `${minutes}m ago`;
  }

  const hours = Math.floor(minutes / 60);

  return `${hours}h ago`;
}

export default Devices;
