import { API_BASE_URL } from "./apiBaseUrl.js";

/**
 * Anonymous customer feedback POST (no JWT). Override if your backend path differs.
 * Use `{siteId}` placeholder. Relative paths are resolved against `API_BASE_URL`.
 * Examples:
 *   /api/public/sites/{siteId}/customer-feedback
 *   https://api.example.com/api/v1/public/feedback/{siteId}
 */
const DEFAULT_POST_TEMPLATE = "/api/public/sites/{siteId}/customer-feedback";

/**
 * Full URL for POST (no Authorization header). Same-origin in dev when `API_BASE_URL` is "".
 */
export function resolvePublicCustomerFeedbackPostUrl(siteId) {
  const id = encodeURIComponent(String(siteId ?? "").trim());
  const raw = (import.meta.env.VITE_PUBLIC_CUSTOMER_FEEDBACK_POST_URL_TEMPLATE || DEFAULT_POST_TEMPLATE).trim();
  const template = raw || DEFAULT_POST_TEMPLATE;
  const replaced = template.replace(/\{siteId\}/gi, id);
  if (/^https?:\/\//i.test(replaced)) {
    return replaced;
  }
  const path = replaced.startsWith("/") ? replaced : `/${replaced}`;
  const base = String(API_BASE_URL ?? "").replace(/\/$/, "");
  return `${base}${path}`;
}

/**
 * Shareable SPA URL for customers (no login). Respects Vite `base` when non-root.
 */
export function buildCustomerFeedbackFrontDoorUrl(siteId) {
  const id = encodeURIComponent(String(siteId ?? "").trim());
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  if (typeof window === "undefined") {
    return `${base}/customer-feedback/${id}`;
  }
  return `${window.location.origin}${base}/customer-feedback/${id}`;
}
