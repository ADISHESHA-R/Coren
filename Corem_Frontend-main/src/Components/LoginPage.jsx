import { useEffect, useState } from "react";
import LoginForm from "./LoginForm";
import LoginResult from "./LoginResult";
import { useToast } from "./Toast";
import { extractTokensFromAuthPayload, refreshAccessToken } from "../utils/refreshAccessToken";

import { API_BASE_URL as BASE_URL } from "../config/apiBaseUrl.js";
const SESSION_LIMIT_MS = 24 * 60 * 60 * 1000;
const REFRESH_EARLY_MS = 60 * 1000;
const DEFAULT_REFRESH_MS = 29 * 60 * 1000;

const LOGIN_ATTEMPTS = [
  { role: "ADMIN", endpoint: "/api/auth/admin/login" },
  { role: "EMPLOYEE", endpoint: "/api/auth/employee/login" },
];

const notifyAuthChanged = () => {
  window.dispatchEvent(new Event("auth-updated"));
};

function normalizeStoredToken(value) {
  let t = String(value ?? "").trim();
  if (/^bearer\s+/i.test(t)) t = t.replace(/^bearer\s+/i, "").trim();
  return t;
}

async function loginByRole(endpoint, credentials) {
  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(credentials),
    cache: "no-store",
  });

  const text = await response.text();
  const trimmed = text.trim();
  const contentLength = response.headers.get("content-length");
  let payload = {};
  if (trimmed) {
    try {
      const parsed = JSON.parse(trimmed);
      payload =
        parsed != null && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : { __nonJson: true };
    } catch {
      payload = { __nonJson: true };
    }
  }

  const looksHtml = /^<!DOCTYPE/i.test(trimmed) || /^<html/i.test(trimmed);
  const bodyEmpty = !trimmed || contentLength === "0";
  return { response, payload, bodyEmpty, looksHtml, contentLength };
}

function LoginPage() {
  const showToast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [sessionMessage, setSessionMessage] = useState("");

  const clearStoredAuth = () => {
    localStorage.removeItem("authRole");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("tokenType");
    localStorage.removeItem("expiresIn");
    localStorage.removeItem("loginAt");
    localStorage.removeItem("accessIssuedAt");
    localStorage.removeItem("email");
    localStorage.removeItem("profileName");
    localStorage.removeItem("profilePhotoPath");
    localStorage.removeItem("userId");
  };

  const storeAuthState = (loginResult, userEmail, isInitialLogin) => {
    localStorage.setItem("authRole", loginResult.role);
    localStorage.setItem("accessToken", normalizeStoredToken(loginResult.accessToken));
    localStorage.setItem("refreshToken", normalizeStoredToken(loginResult.refreshToken));
    localStorage.setItem("tokenType", loginResult.tokenType);
    localStorage.setItem("expiresIn", String(loginResult.expiresIn));
    localStorage.setItem("email", userEmail);
    localStorage.setItem("accessIssuedAt", String(Date.now()));
    if (isInitialLogin) {
      localStorage.setItem("loginAt", String(Date.now()));
    }
    notifyAuthChanged();
  };

  const performLogout = async (logoutReason = "You have been logged out.") => {
    const refreshToken = localStorage.getItem("refreshToken");

    if (refreshToken) {
      try {
        await fetch(`${BASE_URL}/api/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
      } catch (logoutError) {
        // Ignore network errors and still clear local session.
      }
    }

    clearStoredAuth();
    notifyAuthChanged();
    setResult(null);
    setPassword("");
    setSessionMessage(logoutReason);
  };

  const refreshSessionToken = async () => {
    const role = localStorage.getItem("authRole") || "EMPLOYEE";
    const currentEmail = localStorage.getItem("email") || email.trim();

    if (!localStorage.getItem("refreshToken")) {
      return;
    }

    try {
      const result = await refreshAccessToken();
      if (!result.ok) {
        throw new Error(result.message || "Session refresh failed.");
      }

      const refreshedResult = {
        role,
        message: "Token refreshed",
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        tokenType: result.tokenType,
        expiresIn: result.expiresIn,
      };

      storeAuthState(refreshedResult, currentEmail, false);
      setResult(refreshedResult);
    } catch (refreshError) {
      await performLogout("Session refresh failed. Please login again.");
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setSessionMessage("");
    setResult(null);
    setLoading(true);

    try {
      const credentials = { email: email.trim(), password };
      let firstErrorMessage = "Login failed. Please check your credentials.";

      for (const attempt of LOGIN_ATTEMPTS) {
        const { response, payload, bodyEmpty, looksHtml, contentLength } = await loginByRole(attempt.endpoint, credentials);

        if (!response.ok) {
          if (payload?.message && firstErrorMessage === "Login failed. Please check your credentials.") {
            firstErrorMessage = payload.message;
          }
          continue;
        }

        // HTTP 200 but unusable body (common when CDN /api rewrite returns empty or HTML instead of API JSON).
        if (bodyEmpty) {
          firstErrorMessage =
            `Login returned an empty body (HTTP ${response.status}, content-length: ${contentLength ?? "?"}). ` +
            "This is not wrong credentials — the browser did not get JSON from your API. " +
            "Fix Render **Redirects/Rewrites**: rewrite `/api/*` → `https://backendclientapi.onrender.com/api/*` before the SPA `/*` rule, then hard-refresh. " +
            "If you use “Install app”, open DevTools → Application → Service Workers → Unregister, then reload. See RENDER_DEPLOY.md.";
          continue;
        }
        if (looksHtml || payload.__nonJson) {
          firstErrorMessage =
            "Login returned HTML or non-JSON instead of the API response. Your /api/* route is probably serving the SPA, not the backend. Fix Redirects/Rewrites on Render.";
          continue;
        }
        if (payload.success !== true) {
          if (payload?.message) {
            firstErrorMessage = payload.message;
          } else if (firstErrorMessage === "Login failed. Please check your credentials.") {
            firstErrorMessage = "Login was not accepted (API did not return success: true).";
          }
          continue;
        }

        const extracted = extractTokensFromAuthPayload(payload);
        if (!extracted) {
          firstErrorMessage = payload?.message || "Login response was missing tokens.";
          continue;
        }

        const loginResult = {
          role: attempt.role,
          message: payload.message || "Login successful",
          accessToken: extracted.accessToken,
          refreshToken: extracted.refreshToken,
          tokenType: extracted.tokenType,
          expiresIn: extracted.expiresIn,
        };

        storeAuthState(loginResult, credentials.email, true);
        const dataObj = payload.data && typeof payload.data === "object" ? payload.data : {};
        if (dataObj.id != null || dataObj.employeeId != null) {
          localStorage.setItem("userId", String(dataObj.id ?? dataObj.employeeId));
        }

        setResult(loginResult);
        notifyAuthChanged();
        if (showToast) showToast("Login successful.");
        return;
      }

      throw new Error(firstErrorMessage);
    } catch (submitError) {
      setError(submitError.message || "Unable to login right now.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const logoutMessage = sessionStorage.getItem("logoutMessage");
    if (logoutMessage) {
      sessionStorage.removeItem("logoutMessage");
      setSessionMessage(logoutMessage);
    }

    const accessToken = localStorage.getItem("accessToken");
    const refreshToken = localStorage.getItem("refreshToken");
    const authRole = localStorage.getItem("authRole");
    const tokenType = localStorage.getItem("tokenType");
    const expiresIn = Number(localStorage.getItem("expiresIn") || 0);
    const savedEmail = localStorage.getItem("email") || "";

    if (savedEmail) {
      setEmail(savedEmail);
    }

    if (accessToken && refreshToken) {
      setResult({
        role: authRole || "EMPLOYEE",
        message: "Session restored",
        accessToken,
        refreshToken,
        tokenType: tokenType || "Bearer",
        expiresIn,
      });
    }
  }, []);

  useEffect(() => {
    if (!result) {
      return undefined;
    }

    const loginAt = Number(localStorage.getItem("loginAt") || Date.now());
    const remainingSessionMs = SESSION_LIMIT_MS - (Date.now() - loginAt);
    if (remainingSessionMs <= 0) {
      performLogout("Session expired after 24 hours. Please login again.");
      return undefined;
    }

    const logoutTimer = setTimeout(() => {
      performLogout("Session expired after 24 hours. Please login again.");
    }, remainingSessionMs);

    const expiresIn = Number(localStorage.getItem("expiresIn") || DEFAULT_REFRESH_MS);
    const refreshDelay = Math.max(expiresIn - REFRESH_EARLY_MS, 30 * 1000);
    const refreshTimer = setTimeout(() => {
      refreshSessionToken();
    }, refreshDelay);

    return () => {
      clearTimeout(logoutTimer);
      clearTimeout(refreshTimer);
    };
  }, [result]);

  return (
    <section className="auth-card">
      <h1 className="auth-title">Welcome Back</h1>
      <p className="auth-subtitle">
        Use your company email and password.
      </p>

      <LoginForm
        email={email}
        password={password}
        loading={loading}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        onSubmit={handleSubmit}
      />

      {error ? <div className="alert alert-danger mt-3 mb-0">{error}</div> : null}
      {sessionMessage ? <div className="alert alert-warning mt-3 mb-0">{sessionMessage}</div> : null}
      <LoginResult result={result} />

      {result ? (
        <button type="button" className="btn btn-outline-secondary w-100 mt-3" onClick={() => performLogout()}>
          Logout
        </button>
      ) : null}
    </section>
  );
}

export default LoginPage;
