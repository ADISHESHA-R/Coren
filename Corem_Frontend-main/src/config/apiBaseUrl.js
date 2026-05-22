/**
 * API origin (cross-origin to Render in production).
 *
 * Default when not overridden: https://backendclientapi.onrender.com
 *
 * For local browsing (localhost / 127.0.0.1), base is "" so requests use `/api/...`
 * on the same origin and `vite.config.js` proxies to the backend — avoids CORS.
 * (Also covers `vite preview` on localhost, where `import.meta.env.DEV` is false.)
 *
 * Override in `.env` / `.env.development`:
 *   VITE_API_BASE_URL=https://other-host.com
 * Force same-origin proxy even when overriding other vars:
 *   VITE_API_BASE_URL=
 */
const PRODUCTION_DEFAULT = "https://backendclientapi.onrender.com";

function isLocalBrowserHost() {
  if (typeof window === "undefined") return false;
  const h = window.location.hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

function resolveApiBaseUrl() {
  const raw = import.meta.env.VITE_API_BASE_URL;
  const explicit = typeof raw === "string" ? raw.trim() : undefined;

  if (explicit === "") return "";
  if (explicit != null && explicit !== "") return explicit.replace(/\/$/, "");
  if (isLocalBrowserHost()) return "";
  if (import.meta.env.DEV) return "";
  return PRODUCTION_DEFAULT;
}

export const API_BASE_URL = resolveApiBaseUrl();
