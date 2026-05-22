/**
 * POST /api/auth/refresh — no Authorization header.
 * On success: updates access + refresh tokens, extends rolling 24h session (loginAt).
 */

import { API_BASE_URL as BASE_URL } from "../config/apiBaseUrl.js";

/**
 * Pull tokens from login/refresh payloads (nested `data`, `data.tokens`, root `tokens`, snake_case).
 * Never returns without a non-empty access token.
 *
 * @param {object} payload
 * @returns {{ accessToken: string, refreshToken: string, tokenType: string, expiresIn: number } | null}
 */
export function extractTokensFromAuthPayload(payload) {
  if (!payload || typeof payload !== "object") return null;

  const d = payload.data;
  const nested = d && typeof d === "object" ? d : {};
  const nestedTokens = nested.tokens && typeof nested.tokens === "object" ? nested.tokens : {};
  const topTokens = payload.tokens && typeof payload.tokens === "object" ? payload.tokens : {};

  const accessRaw =
    nested.accessToken ??
    nested.access_token ??
    nestedTokens.accessToken ??
    nestedTokens.access_token ??
    topTokens.accessToken ??
    topTokens.access_token ??
    nested.token ??
    payload.accessToken ??
    payload.access_token ??
    "";

  let accessToken = String(accessRaw).trim();
  if (/^bearer\s+/i.test(accessToken)) {
    accessToken = accessToken.replace(/^bearer\s+/i, "").trim();
  }

  const refreshRaw =
    nested.refreshToken ??
    nested.refresh_token ??
    nestedTokens.refreshToken ??
    nestedTokens.refresh_token ??
    topTokens.refreshToken ??
    topTokens.refresh_token ??
    payload.refreshToken ??
    payload.refresh_token ??
    "";

  const refreshToken = String(refreshRaw).trim();

  const tokenType = String(
    nested.tokenType ??
      nested.token_type ??
      nestedTokens.tokenType ??
      nestedTokens.token_type ??
      topTokens.tokenType ??
      payload.tokenType ??
      "Bearer"
  ).trim();

  const expiresIn = Number(
    nested.expiresIn ??
      nested.expires_in ??
      nestedTokens.expiresIn ??
      nestedTokens.expires_in ??
      topTokens.expiresIn ??
      payload.expiresIn ??
      payload.expires_in ??
      0
  );

  if (!accessToken) return null;

  return { accessToken, refreshToken, tokenType: tokenType || "Bearer", expiresIn };
}

/**
 * @returns {Promise<{ ok: true, accessToken: string, refreshToken: string, tokenType: string, expiresIn: number } | { ok: false, message?: string }>}
 */
export async function refreshAccessToken() {
  const storedRefresh = localStorage.getItem("refreshToken");
  const refreshToken = storedRefresh ? storedRefresh.trim() : "";
  if (!refreshToken) {
    return { ok: false, message: "No refresh token" };
  }

  const authRole = localStorage.getItem("authRole") || "EMPLOYEE";
  const currentEmail = localStorage.getItem("email") || "";

  try {
    const response = await fetch(`${BASE_URL}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });

    let payload = {};
    try {
      payload = await response.json();
    } catch {
      payload = {};
    }

    if (!response.ok) {
      return { ok: false, message: payload?.message || `Refresh failed (${response.status})` };
    }

    if (payload && typeof payload === "object" && payload.success === false) {
      return { ok: false, message: payload.message || "Refresh failed" };
    }

    const extracted = extractTokensFromAuthPayload(payload);
    if (!extracted) {
      return {
        ok: false,
        message: payload?.message || "Refresh response missing access token",
      };
    }

    const newRefreshToken = extracted.refreshToken || refreshToken;
    const { accessToken, tokenType, expiresIn } = extracted;

    localStorage.setItem("authRole", authRole);
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", newRefreshToken);
    localStorage.setItem("tokenType", tokenType);
    localStorage.setItem("expiresIn", String(expiresIn));
    localStorage.setItem("email", currentEmail);
    localStorage.setItem("accessIssuedAt", String(Date.now()));
    localStorage.setItem("loginAt", String(Date.now()));

    window.dispatchEvent(new Event("auth-updated"));

    return { ok: true, accessToken, refreshToken: newRefreshToken, tokenType, expiresIn };
  } catch (e) {
    return { ok: false, message: e?.message || "Network error" };
  }
}
