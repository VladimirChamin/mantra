"use client";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const LANDING = process.env.NEXT_PUBLIC_LANDING_URL || "http://localhost:3001";

export function getToken() {
  if (typeof window === "undefined") return null;
  return localStorage.getItem("token");
}

export function getUser() {
  if (typeof window === "undefined") return null;
  try { return JSON.parse(localStorage.getItem("user") || "null"); } catch { return null; }
}

export function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("user");
  document.cookie = "token=; path=/; max-age=0";
  window.location.href = `${LANDING}/login`;
}

export async function fetchMe() {
  const token = getToken();
  if (!token) return null;
  try {
    const res = await fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return null;
    return res.json();
  } catch { return null; }
}

export function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}
