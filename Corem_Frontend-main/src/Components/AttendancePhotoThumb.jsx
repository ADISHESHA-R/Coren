import { useEffect, useState } from "react";
import "./AttendancePhotoThumb.css";
import { resolveAttendancePhotoFetchUrl } from "../utils/attendancePhotoUrl.js";
import { API_BASE_URL as BASE_URL } from "../config/apiBaseUrl.js";

function getAuthHeader() {
  const tokenType = (localStorage.getItem("tokenType") || "Bearer").trim();
  let accessToken = (localStorage.getItem("accessToken") || "").trim();
  if (/^bearer\s+/i.test(accessToken)) {
    accessToken = accessToken.replace(/^bearer\s+/i, "").trim();
  }
  return accessToken ? `${tokenType} ${accessToken}` : "";
}

const PLACEHOLDER =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect fill="%23e9ecef" width="48" height="48" rx="4"/><text x="24" y="30" font-size="18" fill="%236c757d" text-anchor="middle" font-family="sans-serif">—</text></svg>',
  );

/**
 * Loads attendance proof via fetch + Authorization (FileController /api/files).
 *
 * @param {{ row?: object, fetchUrl?: string, className?: string, alt?: string }} props
 * — pass `fetchUrl` or `row` (URL is derived with {@link resolveAttendancePhotoFetchUrl}).
 */
export default function AttendancePhotoThumb({ row, fetchUrl: fetchUrlProp, className = "", alt = "" }) {
  const [src, setSrc] = useState(null);
  const fetchUrl =
    fetchUrlProp != null && String(fetchUrlProp).trim() !== ""
      ? String(fetchUrlProp).trim()
      : row
        ? resolveAttendancePhotoFetchUrl(row, BASE_URL)
        : "";

  useEffect(() => {
    let cancelled = false;
    let objectUrl = null;

    if (!fetchUrl) {
      return () => {
        cancelled = true;
        setSrc(null);
      };
    }

    const auth = getAuthHeader();
    fetch(fetchUrl, { headers: auth ? { Authorization: auth } : {} })
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(String(r.status)))))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setSrc(null);
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setSrc(null);
    };
  }, [fetchUrl]);

  if (!fetchUrl) {
    return (
      <span className={`attendance-photo-thumb attendance-photo-thumb--empty ${className}`.trim()} aria-hidden>
        <img src={PLACEHOLDER} alt="" width={40} height={40} className="attendance-photo-thumb__img" />
      </span>
    );
  }
  if (!src) {
    return (
      <span className={`attendance-photo-thumb attendance-photo-thumb--loading ${className}`.trim()} aria-hidden>
        <span className="attendance-photo-thumb__spinner" />
      </span>
    );
  }
  return (
    <span className={`attendance-photo-thumb ${className}`.trim()}>
      <img src={src} alt={alt || "Attendance"} className="attendance-photo-thumb__img" width={40} height={40} loading="lazy" />
    </span>
  );
}
