import { API_BASE_URL } from "./apiBaseUrl.js";

/**
 * Anonymous customer feedback POST (no JWT). Override if your backend path differs.
 * Use `{siteId}` placeholder. Relative paths are resolved against `API_BASE_URL`.
 * Examples:
 *   /api/public/sites/{siteId}/customer-feedback
 *   https://api.example.com/api/v1/public/feedback/{siteId}
 */
const DEFAULT_POST_TEMPLATE = "/api/public/sites/{siteId}/customer-feedback";

/** Score fields stored inside `feedbackJson` on the server (see parseCustomerFeedbackRecord). */
const CUSTOMER_FEEDBACK_RATING_KEYS = [
  "productQuality",
  "customerService",
  "machiningQuality",
  "pricing",
  "shippingDelivery",
  "likelihoodRecommend",
];

const CUSTOMER_FEEDBACK_TEXT_KEYS = [
  "name",
  "email",
  "phone",
  "companyName",
  "otherCategoryNote",
  "specificFeedback",
  "suggestions",
  "additionalComments",
];

/**
 * Normalise form values for the API: trimmed strings; ratings as integers or null (never "").
 * Empty rating → null so Jackson can bind to `Integer`, not empty string.
 */
export function sanitizeCustomerFeedbackFormFields(form) {
  const f = form && typeof form === "object" ? form : {};
  const out = {};
  for (const k of CUSTOMER_FEEDBACK_TEXT_KEYS) {
    out[k] = String(f[k] ?? "").trim();
  }
  for (const k of CUSTOMER_FEEDBACK_RATING_KEYS) {
    const s = String(f[k] ?? "").trim();
    if (s === "") out[k] = null;
    else {
      const n = Number.parseInt(s, 10);
      out[k] = Number.isFinite(n) ? n : null;
    }
  }
  return out;
}

/**
 * POST body for anonymous customer feedback.
 * - Default `feedback_json`: `{ feedbackJson: "<stringified inner>" }` — matches admin GET `data.feedbackJson`.
 * - `flat`: send the inner object only (legacy / alternate backends). Set `VITE_PUBLIC_CUSTOMER_FEEDBACK_BODY_MODE=flat`.
 */
export function buildPublicCustomerFeedbackPostBody(form) {
  const mode = String(import.meta.env.VITE_PUBLIC_CUSTOMER_FEEDBACK_BODY_MODE ?? "feedback_json")
    .trim()
    .toLowerCase();
  const inner = sanitizeCustomerFeedbackFormFields(form);
  if (mode === "flat") return inner;
  return { feedbackJson: JSON.stringify(inner) };
}

/**
 * Client-side checks before POST. Returns an error message or "" if OK.
 * Keeps typical 0–10 score ranges aligned with the form labels / backend validation.
 */
export function validateCustomerFeedbackFormForSubmit(form) {
  const inner = sanitizeCustomerFeedbackFormFields(form);
  if (!inner.name?.trim()) return "Please enter your name.";
  const scoreKeys = [
    ["productQuality", "Product quality"],
    ["customerService", "Customer service"],
    ["machiningQuality", "Machining quality"],
    ["pricing", "Pricing"],
    ["shippingDelivery", "Shipping / delivery"],
  ];
  for (const [key, label] of scoreKeys) {
    const v = inner[key];
    if (v == null) continue;
    if (v < 0 || v > 10) return `${label} must be between 0 and 10 (you entered ${v}).`;
  }
  const lr = inner.likelihoodRecommend;
  if (lr != null && (lr < 0 || lr > 10)) {
    return `Likelihood to recommend must be between 0 and 10 (you entered ${lr}).`;
  }
  return "";
}

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
