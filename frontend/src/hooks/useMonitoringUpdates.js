import { useEffect, useState } from "react";
import { io } from "socket.io-client";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:5000/api";
const SOCKET_URL = API_BASE_URL.replace(/\/api\/?$/, "");

let socket;
let revision = 0;
let connectionStatus = "connecting";
let refreshTimeout;
const subscribers = new Set();

function publish() {
  subscribers.forEach((subscriber) =>
    subscriber({ revision, connectionStatus }),
  );
}

function ensureSocket() {
  if (socket) return;
  const token = localStorage.getItem("netfault_token");
  if (!token) {
    connectionStatus = "disconnected";
    return;
  }

  connectionStatus = "connecting";
  socket = io(SOCKET_URL, {
    auth: { token },
    reconnection: true,
    timeout: 5000,
  });
  socket.on("connect", () => {
    connectionStatus = "connected";
    publish();
  });
  socket.on("disconnect", () => {
    connectionStatus = "disconnected";
    publish();
  });
  socket.on("connect_error", (error) => {
    connectionStatus = "disconnected";
    console.warn("Realtime connection unavailable:", error.message);
    publish();
  });
  socket.on("monitoring:update", () => {
    if (refreshTimeout) clearTimeout(refreshTimeout);
    refreshTimeout = setTimeout(() => {
      revision += 1;
      publish();
    }, 250);
  });
}

export function useMonitoringUpdates() {
  const [state, setState] = useState({ revision, connectionStatus });

  useEffect(() => {
    const subscriber = (nextState) => setState(nextState);
    subscribers.add(subscriber);
    ensureSocket();
    subscriber({ revision, connectionStatus });

    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0 && socket) {
        if (refreshTimeout) clearTimeout(refreshTimeout);
        socket.removeAllListeners();
        socket.disconnect();
        socket = undefined;
        connectionStatus = "connecting";
      }
    };
  }, []);

  return state;
}
