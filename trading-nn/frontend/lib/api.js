// lib/api.js — обёртки над backend (api_server.py)

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function req(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json" },
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
};
