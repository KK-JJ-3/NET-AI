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
