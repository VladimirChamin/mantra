// lib/api.js — обёртки над backend (api_server.py)

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

async function req(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...options,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || `Ошибка ${res.status}`);
  }
  return data;
}

export const api = {
  base: API,
  health: () => req("/api/health"),
  meta: () => req("/api/meta"),
  models: () => req("/api/models"),
  setDataSource: (provider, payload = {}) =>
    req("/api/datasource", { method: "POST", body: JSON.stringify({ provider, ...payload }) }),
  train: (payload) =>
    req("/api/train", { method: "POST", body: JSON.stringify(payload) }),
  trainUniversal: (payload) =>
    req("/api/train_universal", { method: "POST", body: JSON.stringify(payload) }),
  assetClasses: () => req("/api/asset_classes"),
  detectAssetClass: (symbol) => req(`/api/asset_classes/${symbol}`),
  backtest: (payload) =>
    req("/api/backtest", { method: "POST", body: JSON.stringify(payload) }),
  predict: (payload) =>
    req("/api/predict", { method: "POST", body: JSON.stringify(payload) }),
  forecast: (payload) =>
    req("/api/forecast", { method: "POST", body: JSON.stringify(payload) }),
  job: (id) => req(`/api/jobs/${id}`),
  jobs: () => req("/api/jobs"),
  mySignals: () => req("/api/signals"),
  allSignals: () => req("/api/signals/all"),
  me: () => req("/api/auth/me"),
  aiQuota: () => req("/api/ai_quota"),
  analysis: (payload) =>
    req("/api/analysis", { method: "POST", body: JSON.stringify(payload) }),
  changePassword: (payload) =>
    req("/api/auth/change-password", { method: "POST", body: JSON.stringify(payload) }),
  // Подписки на сигналы
  getSubscriptions: () => req("/api/subscriptions"),
  addSubscription: (payload) =>
    req("/api/subscriptions", { method: "POST", body: JSON.stringify(payload) }),
  deleteSubscription: (id) =>
    req(`/api/subscriptions/${id}`, { method: "DELETE" }),
  toggleSubscription: (id, active) =>
    req(`/api/subscriptions/${id}`, { method: "PATCH", body: JSON.stringify({ active }) }),
  // Переобучение по расписанию (admin)
  getRetrainHistory: () => req("/api/retrain/history"),
  saveRetrainSchedules: (schedules) =>
    req("/api/retrain/schedules", { method: "POST", body: JSON.stringify({ schedules }) }),
  triggerRetrain: (interval) =>
    req("/api/retrain/trigger", { method: "POST", body: JSON.stringify({ interval }) }),
};
