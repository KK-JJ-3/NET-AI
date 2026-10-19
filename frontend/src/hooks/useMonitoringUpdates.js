import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, "");

export function useMonitoringUpdates() {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const token = localStorage.getItem("netfault_token");

    if (!token) {
      return undefined;
    }

    const socket = io(SOCKET_URL, {
      auth: { token },
      reconnection: true,
      timeout: 5000,
    });

    // Coalesce related events (e.g. telemetry followed by prediction and alert)
    // into one refresh, rather than starting multiple REST requests in a burst.
    let refreshTimeout;

    socket.on("monitoring:update", () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);

      refreshTimeout = setTimeout(() => {
        setRevision((current) => current + 1);
      }, 250);
    });

    socket.on("connect_error", (error) => {
      // Keep the UI usable if realtime is unavailable; manual refresh still works.
      console.warn("Realtime connection unavailable:", error.message);
    });

    return () => {
      if (refreshTimeout) clearTimeout(refreshTimeout);
      socket.removeAllListeners();
      socket.disconnect();
    };
  }, []);

  return revision;
}
