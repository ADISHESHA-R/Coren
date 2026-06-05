import { API_BASE_URL } from "./apiBaseUrl.js";

/**
 * Anonymous customer feedback on the same path (no JWT). Override if your backend differs.
 * Use `{siteId}` placeholder. Relative paths are resolved against `API_BASE_URL`.
 *
 * - **GET** (bootstrap): `GET …/api/public/sites/{siteId}/customer-feedback` — no token; returns
 *   `PublicFeedbackContextResponse` (jobCode, customerName, certificateClientStatus, expired, revoked, …).
 * - **POST** (submit): same URL; body matches your backend (`feedbackJson` vs flat). **token** in the
 *   body is optional when using the tokenless public URL; legacy links may still use `?token=…`.
 * Examples:
 *   /api/public/sites/{siteId}/customer-feedback
 *   https://api.example.com/api/v1/public/feedback/{siteId}
 */
const DEFAULT_POST_TEMPLATE = "/api/public/sites/{siteId}/customer-feedback";

/** When not `"false"` / `"0"`, submit requires `?token=` in the URL (stricter legacy flow). Default false = tokenless POST allowed. */
export function isPublicCustomerFeedbackTokenRequired() {
  const v = String(import.meta.env.VITE_PUBLIC_CUSTOMER_FEEDBACK_TOKEN_REQUIRED ?? "false")
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

/**
 * Merge **GET …/customer-feedback** with **GET …/sites/{id}** so the completion step shows stored answers
 * when the backend mirrors `customer_feedback_payload` as **`customerFeedbackJson`** on the site row
 * (e.g. after wizard-only saves merged on the server), or when the dedicated GET omits `feedbackJson`.
 * The endpoint DTO wins on overlapping top-level fields; site blob fills empty `feedbackJson`.
 */
export function mergeSiteAndEndpointCustomerFeedbackForAdmin(site, customerFeedbackDto) {
  const siteObj = site && typeof site === "object" ? site : {};
  const out = customerFeedbackDto && typeof customerFeedbackDto === "object" ? { ...customerFeedbackDto } : {};

  const siteBlob =
    siteObj.customerFeedbackJson ??
    siteObj.customer_feedback_json ??
    siteObj.customerFeedbackPayload ??
    siteObj.customer_feedback_payload;
  let siteBlobStr = "";
  if (typeof siteBlob === "string") {
    siteBlobStr = String(siteBlob).trim();
  } else if (siteBlob != null && typeof siteBlob === "object") {
    siteBlobStr = JSON.stringify(siteBlob);
  }

  const existingJson = String(out.feedbackJson ?? out.feedback_json ?? "").trim();
  if (siteBlobStr && !existingJson) {
    out.feedbackJson = siteBlobStr;
  }

  if (out.certificateClientStatus == null && siteObj.certificateClientStatus != null) {
    out.certificateClientStatus = siteObj.certificateClientStatus;
  }
  if (out.customerFeedbackApprovedAt == null && siteObj.customerFeedbackApprovedAt != null) {
    out.customerFeedbackApprovedAt = siteObj.customerFeedbackApprovedAt;
  }
  if (out.jobCode == null && siteObj.jobCode != null) {
    out.jobCode = siteObj.jobCode;
  }
  if (out.siteId == null && (siteObj.id != null || siteObj.siteId != null)) {
    out.siteId = siteObj.id ?? siteObj.siteId;
  }

  const hasPayload =
    Object.keys(out).length > 0 ||
    siteBlobStr ||
    siteObj.certificateClientStatus != null ||
    siteObj.customerFeedbackApprovedAt != null;
  if (!hasPayload) return null;
  return out;
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
 * - **token** (invite): include in the body when present (`?token=`). Omit entirely when tokenless
 *   (do not send `null` unless your backend expects it — this helper omits the key).
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

function resolvePublicCustomerFeedbackApiUrl(siteId) {
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

/** Full URL for GET bootstrap (no Authorization header). Same path template as POST. */
export function resolvePublicCustomerFeedbackGetUrl(siteId) {
  return resolvePublicCustomerFeedbackApiUrl(siteId);
}

/**
 * Full URL for POST (no Authorization header). Same-origin in dev when `API_BASE_URL` is "".
 */
export function resolvePublicCustomerFeedbackPostUrl(siteId) {
  return resolvePublicCustomerFeedbackApiUrl(siteId);
}

/** Unwrap `{ success, data }` or return object as-is. */
export function unwrapPublicCustomerFeedbackEnvelope(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.success === true && raw.data != null && typeof raw.data === "object") return raw.data;
  if (raw.data != null && typeof raw.data === "object") return raw.data;
  return raw;
}

/**
 * Normalised public GET context (`PublicFeedbackContextResponse`-shaped).
 * @param {unknown} raw — parsed JSON from GET
 */
export function parsePublicFeedbackContextResponse(raw) {
  const d = unwrapPublicCustomerFeedbackEnvelope(raw);
  if (!d || typeof d !== "object") return null;
  return {
    jobCode: String(d.jobCode ?? "").trim(),
    customerName: String(d.customerName ?? "").trim(),
    companyNameHint: String(d.companyNameHint ?? "").trim(),
    certificateClientStatus: String(d.certificateClientStatus ?? "NONE").trim(),
    expired: Boolean(d.expired),
    revoked: Boolean(d.revoked),
  };
}

const OPEN_FEEDBACK_STATUSES = new Set([
  "",
  "NONE",
  "PENDING",
  "PENDING_CLIENT_FEEDBACK",
  "AWAITING_CLIENT_FEEDBACK",
  "AWAITING_FEEDBACK",
]);

/** True when the customer may still fill the form (subject to expired/revoked). */
export function publicFeedbackContextAllowsForm(ctx) {
  if (!ctx || typeof ctx !== "object") return false;
  if (ctx.expired || ctx.revoked) return false;
  const s = String(ctx.certificateClientStatus ?? "NONE").trim().toUpperCase();
  return OPEN_FEEDBACK_STATUSES.has(s);
}

/** `"submitted"` | `"approved"` | null — drives thank-you / already-done copy. */
export function publicFeedbackContextTerminalKind(ctx) {
  if (!ctx || typeof ctx !== "object") return null;
  const s = String(ctx.certificateClientStatus ?? "").trim().toUpperCase();
  if (s === "FEEDBACK_SUBMITTED") return "submitted";
  if (s === "APPROVED_BY_CLIENT") return "approved";
  return null;
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
