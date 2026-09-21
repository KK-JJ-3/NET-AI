import { useState } from "react";

import "./App.css";
import "./styles/netfault-ui-fixes.css";

import { useAuth } from "./auth/AuthContext";
import ProtectedRoute from "./components/ProtectedRoute";
import AppLayout from "./components/layout/AppLayout";

import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Devices from "./pages/Devices";
import DeviceDetails from "./pages/DeviceDetails";

function App() {
  const { isAuthenticated } = useAuth();

  const [activePage, setActivePage] = useState("devices");

  const [selectedDeviceId, setSelectedDeviceId] = useState(null);

  if (!isAuthenticated) {
    return <Login />;
  }

  function handleNavigate(page) {
    setSelectedDeviceId(null);
    setActivePage(page);
  }

  function handleSelectDevice(id) {
    setSelectedDeviceId(id);
  }

  function handleBackToDevices() {
    setSelectedDeviceId(null);
    setActivePage("devices");
  }

  function renderPage() {
    if (selectedDeviceId) {
      return (
        <DeviceDetails
          deviceId={selectedDeviceId}
          onBack={handleBackToDevices}
        />
      );
    }

    if (activePage === "dashboard") {
      return <Dashboard />;
    }

    if (activePage === "devices") {
      return <Devices onSelectDevice={handleSelectDevice} />;
    }

    return (
      <div className="page-scroll">
        <div className="coming-soon-page">
          <span className="page-eyebrow">{activePage.toUpperCase()}</span>

          <h1>
            {activePage === "dashboard"
              ? "Dashboard"
              : activePage === "predictions"
                ? "Predictions"
                : activePage === "faults"
                  ? "Fault intelligence"
                  : activePage === "alerts"
                    ? "Alerts"
                    : "Network topology"}
          </h1>

          <p>
            This module is prepared for integration. The current interface is
            intentionally showing its loading structure rather than fabricated
            network data.
          </p>

          <div className="skeleton-grid">
            <div />
            <div />
            <div />
            <div />
          </div>
        </div>
      </div>
    );
  }

  return (
    <ProtectedRoute>
      <AppLayout activePage={activePage} onNavigate={handleNavigate}>
        {renderPage()}
      </AppLayout>
    </ProtectedRoute>
  );
}

export default App;
