import { API_BASE_URL as DEFAULT_API_BASE } from "../config/apiBaseUrl.js";

/**
 * First non-empty photo field from AttendanceResponse (backend sets photoUrl, imageUrl, image, photo to same value).
 * Falls back to photoPath (storage key) for older payloads.
 */
export function pickAttendancePhotoField(row) {
  if (!row || typeof row !== "object") return "";
  for (const k of ["photoUrl", "imageUrl", "image", "photo"]) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  const p = row.photoPath;
  if (p != null && String(p).trim() !== "") return String(p).trim();
  return "";
}

/**
 * Full URL to pass to fetch() for an authenticated file GET.
 * Handles absolute URLs, root-relative `/api/files?...`, and bare storage keys.
 *
 * @param {object} row - attendance DTO
 * @param {string} [apiBaseUrl] - same as Vite `API_BASE_URL` (default from config)
 */
export function resolveAttendancePhotoFetchUrl(row, apiBaseUrl = DEFAULT_API_BASE) {
  const raw = pickAttendancePhotoField(row);
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  const base = (apiBaseUrl ?? "").replace(/\/$/, "");
  if (raw.startsWith("/")) {
    return base ? `${base}${raw}` : raw;
  }
  const b = base || "";
  return b ? `${b}/api/files?path=${encodeURIComponent(raw)}` : `/api/files?path=${encodeURIComponent(raw)}`;
}
