import { API_BASE_URL } from "./apiBaseUrl.js";

/**
 * Anonymous customer feedback POST (no JWT). Override if your backend path differs.
 * Use `{siteId}` placeholder. Relative paths are resolved against `API_BASE_URL`.
 *
 * ProjectC-style API: POST body must include a non-blank **token** (opaque invite) that belongs to
 * `{siteId}`; the SPA should open `/customer-feedback/{siteId}?token=…` (see `buildCustomerFeedbackFrontDoorUrl`).
 * Examples:
 *   /api/public/sites/{siteId}/customer-feedback
 *   https://api.example.com/api/v1/public/feedback/{siteId}
 */
const DEFAULT_POST_TEMPLATE = "/api/public/sites/{siteId}/customer-feedback";

/** When not `"false"` / `"0"`, the public form requires `?token=` (production default). */
export function isPublicCustomerFeedbackTokenRequired() {
  const v = String(import.meta.env.VITE_PUBLIC_CUSTOMER_FEEDBACK_TOKEN_REQUIRED ?? "true")
    .trim()
    .toLowerCase();
  return v !== "false" && v !== "0";
}

/**
 * Best-effort read of invite token from admin site payloads (field names vary by API version).
 */
export function getSiteCustomerFeedbackInviteToken(site) {
  if (!site || typeof site !== "object") return "";
  const candidates = [
    site.customerFeedbackInviteToken,
    site.customerFeedbackToken,
    site.publicFeedbackToken,
    site.feedbackInviteToken,
    site.feedbackPublicToken,
    site.feedbackToken,
    site.inviteToken,
  ];
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (s) return s;
  }
  return "";
}

/**
 * Invite token from **GET /api/admin/sites/{id}/customer-feedback** when the backend returns it here
 * (e.g. FeedbackInviteResponse) but not on **GET /api/admin/sites/{id}**.
 */
export function getCustomerFeedbackInviteTokenFromAdminDto(data) {
  if (!data || typeof data !== "object") return "";
  const candidates = [
    data.token,
    data.inviteToken,
    data.feedbackInviteToken,
    data.customerFeedbackInviteToken,
    data.publicFeedbackToken,
    data.feedbackToken,
    data.feedbackInvite?.token,
    data.invite?.token,
  ];
  for (const c of candidates) {
    const s = String(c ?? "").trim();
    if (s) return s;
  }
  return "";
}

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
 * - Default `feedback_json`: `{ token?, feedbackJson: "<stringified inner>" }` — matches admin GET `data.feedbackJson`.
 * - `flat`: `{ token?, ...inner }`. Set `VITE_PUBLIC_CUSTOMER_FEEDBACK_BODY_MODE=flat`.
 * - **token** (invite) is required by ProjectC `POST /api/public/sites/{siteId}/customer-feedback`; omit only when testing with `VITE_PUBLIC_CUSTOMER_FEEDBACK_TOKEN_REQUIRED=false`.
 */
export function buildPublicCustomerFeedbackPostBody(form, inviteToken) {
  const mode = String(import.meta.env.VITE_PUBLIC_CUSTOMER_FEEDBACK_BODY_MODE ?? "feedback_json")
    .trim()
    .toLowerCase();
  const inner = sanitizeCustomerFeedbackFormFields(form);
  const token = String(inviteToken ?? "").trim();
  const withToken = (body) => {
    if (!token) return body;
    return { token, ...body };
  };
  if (mode === "flat") return withToken(inner);
  return withToken({ feedbackJson: JSON.stringify(inner) });
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

/** True when the invite token is missing but required for submit (see `isPublicCustomerFeedbackTokenRequired`). */
export function validatePublicCustomerFeedbackInviteToken(inviteToken) {
  if (!isPublicCustomerFeedbackTokenRequired()) return "";
  if (!String(inviteToken ?? "").trim()) {
    return "This link is missing the invite token. Open the full URL your administrator sent you (it should include ?token=…), or ask them to resend the feedback link.";
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
 * Pass **inviteToken** when the API requires `?token=` (ProjectC public feedback).
 */
export function buildCustomerFeedbackFrontDoorUrl(siteId, inviteToken) {
  const id = encodeURIComponent(String(siteId ?? "").trim());
  const token = String(inviteToken ?? "").trim();
  const qs = token ? `?token=${encodeURIComponent(token)}` : "";
  const base = (import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  if (typeof window === "undefined") {
    return `${base}/customer-feedback/${id}${qs}`;
  }
  return `${window.location.origin}${base}/customer-feedback/${id}${qs}`;
}
