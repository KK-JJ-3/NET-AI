const API_BASE_URL = "http://localhost:5000/api";

async function request(endpoint, options = {}) {
  const token = localStorage.getItem("netfault_token");

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE_URL}${endpoint}`, {
    ...options,
    headers,
  });

  let result;

  try {
    result = await response.json();
  } catch {
    throw new Error(`Request failed with status ${response.status}`);
  }

  if (!response.ok) {
    throw new Error(result.error || "Something went wrong");
  }

  return result.data;
}

export async function login(username, password) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify({
      username,
      password,
    }),
  });
}

export async function getCurrentUser() {
  return request("/auth/me");
}

export async function getDashboardSummary() {
  return request("/dashboard/summary");
}

export async function getDevices() {
  return request("/devices");
}

export function logout() {
  localStorage.removeItem("netfault_token");
}
export async function getDevice(id) {
  return request(`/devices/${id}`);
}

export async function getDeviceTelemetry(id, range = "1h") {
  return request(`/devices/${id}/telemetry?range=${range}`);
}

export async function createDevice(deviceData) {
  return request("/devices", {
    method: "POST",
    body: JSON.stringify(deviceData),
  });
}

export async function updateDevice(id, deviceData) {
  return request(`/devices/${id}`, {
    method: "PATCH",
    body: JSON.stringify(deviceData),
  });
}

export async function deleteDevice(id) {
  return request(`/devices/${id}`, {
    method: "DELETE",
  });
}

export async function getDeviceInterfaces(deviceId) {
  return request(`/interfaces/device/${deviceId}`);
}

export async function createInterface(deviceId, interfaceData) {
  return request(`/interfaces/device/${deviceId}`, {
    method: "POST",
    body: JSON.stringify(interfaceData),
  });
}

export async function updateInterface(id, interfaceData) {
  return request(`/interfaces/${id}`, {
    method: "PATCH",
    body: JSON.stringify(interfaceData),
  });
}

export async function deleteInterface(id) {
  return request(`/interfaces/${id}`, {
    method: "DELETE",
  });
}

export async function getPredictions(filters = {}) {
  const params = new URLSearchParams();

  if (filters.status) {
    params.set("status", filters.status);
  }

  const query = params.toString();

  return request(`/predictions${query ? `?${query}` : ""}`);
}

export async function getPrediction(id) {
  return request(`/predictions/${id}`);
}

export async function getFaults(filters = {}) {
  const params = new URLSearchParams();

  if (filters.deviceId) {
    params.set("deviceId", filters.deviceId);
  }

  if (filters.status) {
    params.set("status", filters.status);
  }

  const query = params.toString();

  return request(`/faults${query ? `?${query}` : ""}`);
}
export async function getFault(id) {
  return request(`/faults/${id}`);
}

export async function getAlerts(filters = {}) {
  const params = new URLSearchParams();

  if (typeof filters.acknowledged === "boolean") {
    params.set("acknowledged", filters.acknowledged);
  }

  const query = params.toString();

  return request(`/alerts${query ? `?${query}` : ""}`);
}

export async function acknowledgeAlert(id) {
  return request(`/alerts/${id}/ack`, {
    method: "POST",
  });
}
