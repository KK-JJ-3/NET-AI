import { useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, SlidersHorizontal, X, Pencil } from "lucide-react";

import {
  createDevice,
  getDevices,
  updateDevice,
  deleteDevice,
} from "../api/client";

import DeviceList from "../components/devices/DeviceList";

import "../styles/devices.css";

const INITIAL_FORM = {
  name: "",
  type: "router",
  ipAddress: "",
  status: "up",
  location: "",
};

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

  const [showAddDevice, setShowAddDevice] = useState(false);
  const [showEditDevice, setShowEditDevice] = useState(false);
  const [showDeleteDevice, setShowDeleteDevice] = useState(false);

  const [formData, setFormData] = useState(INITIAL_FORM);
  const [editDevice, setEditDevice] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const [formError, setFormError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  function openAddDeviceModal() {
    setFormData(INITIAL_FORM);
    setFormError("");
    setShowAddDevice(true);
  }

  function closeAddDeviceModal() {
    if (submitting) {
      return;
    }

    setShowAddDevice(false);
    setFormData(INITIAL_FORM);
    setFormError("");
  }

  function openEditDeviceModal(device) {
    setEditDevice(device);

    setFormData({
      name: device.name || "",
      type: device.type || "router",
      ipAddress: device.ipAddress || "",
      status: device.status || "up",
      location: device.location || "",
    });

    setFormError("");
    setShowEditDevice(true);
  }

  function closeEditDeviceModal() {
    if (submitting) {
      return;
    }

    setShowEditDevice(false);
    setEditDevice(null);
    setFormData(INITIAL_FORM);
    setFormError("");
  }

  function openDeleteDeviceModal(device) {
    setDeleteTarget(device);
    setFormError("");
    setShowDeleteDevice(true);
  }

  function closeDeleteDeviceModal() {
    if (deleting) {
      return;
    }

    setShowDeleteDevice(false);
    setDeleteTarget(null);
    setFormError("");
  }

  function handleFormChange(event) {
    const { name, value } = event.target;

    setFormData((current) => ({
      ...current,
      [name]: value,
    }));

    if (formError) {
      setFormError("");
    }
  }

  async function handleCreateDevice(event) {
    event.preventDefault();

    setFormError("");

    if (!formData.name.trim()) {
      setFormError("Device name is required.");
      return;
    }

    if (!formData.ipAddress.trim()) {
      setFormError("IP address is required.");
      return;
    }

    try {
      setSubmitting(true);

      await createDevice({
        name: formData.name.trim(),
        type: formData.type,
        ipAddress: formData.ipAddress.trim(),
        status: formData.status,
        location: formData.location.trim() || null,
      });

      setShowAddDevice(false);
      setFormData(INITIAL_FORM);

      await loadDevices();
    } catch (err) {
      setFormError(err.message || "Failed to create device");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateDevice(event) {
    event.preventDefault();

    setFormError("");

    if (!editDevice) {
      return;
    }

    if (!formData.name.trim()) {
      setFormError("Device name is required.");
      return;
    }

    if (!formData.ipAddress.trim()) {
      setFormError("IP address is required.");
      return;
    }

    try {
      setSubmitting(true);

      await updateDevice(editDevice.id, {
        name: formData.name.trim(),
        type: formData.type,
        ipAddress: formData.ipAddress.trim(),
        status: formData.status,
        location: formData.location.trim() || null,
      });

      setShowEditDevice(false);
      setEditDevice(null);
      setFormData(INITIAL_FORM);

      await loadDevices();
    } catch (err) {
      setFormError(err.message || "Failed to update device");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteDevice() {
    if (!deleteTarget) {
      return;
    }

    try {
      setDeleting(true);
      setFormError("");

      await deleteDevice(deleteTarget.id);

      setShowDeleteDevice(false);
      setDeleteTarget(null);

      await loadDevices();
    } catch (err) {
      setFormError(err.message || "Failed to delete device");
    } finally {
      setDeleting(false);
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

        <div className="devices-hero-total">
          <div className="total-card">
            <span className="total-card-label">Total</span>

            <strong>{String(devices.length).padStart(2, "0")}</strong>

            <span className="total-card-caption">Devices</span>
          </div>
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
        <DeviceList
          devices={filteredDevices}
          onSelectDevice={onSelectDevice}
          onEditDevice={openEditDeviceModal}
          onDeleteDevice={openDeleteDeviceModal}
          onAddDevice={openAddDeviceModal}
        />
      </section>

      {/* ADD DEVICE MODAL */}
      {showAddDevice && (
        <div
          className="device-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeAddDeviceModal();
            }
          }}
        >
          <section
            className="device-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-device-title"
          >
            <div className="device-modal-header">
              <div>
                <span className="device-modal-kicker">Infrastructure</span>

                <h2 id="add-device-title">Add device</h2>

                <p>Register a new network device in NetFault AI.</p>
              </div>

              <button
                type="button"
                className="device-modal-close"
                onClick={closeAddDeviceModal}
                disabled={submitting}
                aria-label="Close add device form"
              >
                <X size={20} />
              </button>
            </div>

            <form className="device-form" onSubmit={handleCreateDevice}>
              {formError && (
                <div className="device-form-error" role="alert">
                  {formError}
                </div>
              )}

              <DeviceFormFields
                formData={formData}
                onChange={handleFormChange}
                submitting={submitting}
              />

              <div className="device-form-actions">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={closeAddDeviceModal}
                  disabled={submitting}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="primary-action"
                  disabled={submitting}
                >
                  {submitting ? "Adding device..." : "Add Device"}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* EDIT DEVICE MODAL */}
      {showEditDevice && (
        <div
          className="device-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeEditDeviceModal();
            }
          }}
        >
          <section
            className="device-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-device-title"
          >
            <div className="device-modal-header">
              <div>
                <span className="device-modal-kicker">Infrastructure</span>

                <h2 id="edit-device-title">Edit device</h2>

                <p>
                  Update the configuration of{" "}
                  <strong>{editDevice?.name || "this device"}</strong>.
                </p>
              </div>

              <button
                type="button"
                className="device-modal-close"
                onClick={closeEditDeviceModal}
                disabled={submitting}
                aria-label="Close edit device form"
              >
                <X size={20} />
              </button>
            </div>

            <form className="device-form" onSubmit={handleUpdateDevice}>
              {formError && (
                <div className="device-form-error" role="alert">
                  {formError}
                </div>
              )}

              <DeviceFormFields
                formData={formData}
                onChange={handleFormChange}
                submitting={submitting}
              />

              <div className="device-form-actions">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={closeEditDeviceModal}
                  disabled={submitting}
                >
                  Cancel
                </button>

                <button
                  type="submit"
                  className="primary-action"
                  disabled={submitting}
                >
                  {submitting ? (
                    "Saving changes..."
                  ) : (
                    <>
                      <Pencil size={16} />
                      Save Changes
                    </>
                  )}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}

      {/* DELETE DEVICE MODAL */}
      {showDeleteDevice && (
        <div
          className="device-modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closeDeleteDeviceModal();
            }
          }}
        >
          <section
            className="device-modal device-delete-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-device-title"
          >
            <div className="device-modal-header">
              <div>
                <span className="device-modal-kicker">Destructive action</span>

                <h2 id="delete-device-title">Delete device</h2>

                <p>This action cannot be undone.</p>
              </div>

              <button
                type="button"
                className="device-modal-close"
                onClick={closeDeleteDeviceModal}
                disabled={deleting}
                aria-label="Close delete confirmation"
              >
                <X size={20} />
              </button>
            </div>

            <div className="device-delete-content">
              {formError && (
                <div className="device-form-error" role="alert">
                  {formError}
                </div>
              )}

              <p>
                Are you sure you want to delete{" "}
                <strong>{deleteTarget?.name || "this device"}</strong>?
              </p>

              <p className="device-delete-warning">
                The device and its associated interfaces, telemetry, faults,
                predictions, and alerts will be permanently removed.
              </p>

              <div className="device-form-actions">
                <button
                  type="button"
                  className="secondary-action"
                  onClick={closeDeleteDeviceModal}
                  disabled={deleting}
                >
                  Cancel
                </button>

                <button
                  type="button"
                  className="delete-confirm-button"
                  onClick={handleDeleteDevice}
                  disabled={deleting}
                >
                  {deleting ? "Deleting..." : "Delete Device"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function DeviceFormFields({ formData, onChange, submitting }) {
  return (
    <div className="device-form-grid">
      <label className="device-form-field">
        <span>Device name</span>

        <input
          type="text"
          name="name"
          value={formData.name}
          onChange={onChange}
          placeholder="e.g. Branch-Router-01"
          disabled={submitting}
          autoFocus
        />
      </label>

      <label className="device-form-field">
        <span>Device type</span>

        <select
          name="type"
          value={formData.type}
          onChange={onChange}
          disabled={submitting}
        >
          <option value="router">Router</option>
          <option value="switch">Switch</option>
          <option value="firewall">Firewall</option>
          <option value="access_point">Access Point</option>
          <option value="server">Server</option>
        </select>
      </label>

      <label className="device-form-field">
        <span>IP address</span>

        <input
          type="text"
          name="ipAddress"
          value={formData.ipAddress}
          onChange={onChange}
          placeholder="e.g. 192.168.10.20"
          disabled={submitting}
        />
      </label>

      <label className="device-form-field">
        <span>Status</span>

        <select
          name="status"
          value={formData.status}
          onChange={onChange}
          disabled={submitting}
        >
          <option value="up">Up</option>
          <option value="degraded">Degraded</option>
          <option value="down">Down</option>
        </select>
      </label>

      <label className="device-form-field device-form-field-full">
        <span>Location</span>

        <input
          type="text"
          name="location"
          value={formData.location}
          onChange={onChange}
          placeholder="e.g. Main Server Room"
          disabled={submitting}
        />
      </label>
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
