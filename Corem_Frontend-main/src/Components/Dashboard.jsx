import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AddRecordModal from "./AddRecordModal";
import AttendancePhotoThumb from "./AttendancePhotoThumb.jsx";
import { useToast } from "./Toast";
import { refreshAccessToken } from "../utils/refreshAccessToken";

import { API_BASE_URL as BASE_URL } from "../config/apiBaseUrl.js";
const SESSION_LIMIT_MS = 24 * 60 * 60 * 1000;
const REFRESH_EARLY_MS = 60 * 1000;
const DEFAULT_REFRESH_MS = 29 * 60 * 1000;
const DATE_CHECK_INTERVAL_MS = 60 * 1000;

function getAuthHeader() {
  const tokenType = (localStorage.getItem("tokenType") || "Bearer").trim();
  let accessToken = (localStorage.getItem("accessToken") || "").trim();
  if (/^bearer\s+/i.test(accessToken)) {
    accessToken = accessToken.replace(/^bearer\s+/i, "").trim();
  }
  return accessToken ? `${tokenType} ${accessToken}` : "";
}

/** Fetches current user profile; tries /api/users/me then /api/user/me on 404. */
async function fetchUserProfile(baseUrl, authHeader) {
  const urls = [`${baseUrl}/api/users/me`, `${baseUrl}/api/user/me`];
  for (const url of urls) {
    const res = await fetch(url, { headers: { Authorization: authHeader } });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return data;
    if (res.status === 404) continue;
    return data;
  }
  return {};
}

function todayDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Local calendar date YYYY-MM-DD for attendance (avoids UTC shift from toISOString). */
function recordDateString(dateVal) {
  if (!dateVal) return "";
  if (typeof dateVal === "string") {
    const s = dateVal.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  }
  const d = new Date(dateVal);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toLocalYMD(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function startOfWeekSunday(d) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  x.setDate(x.getDate() - day);
  return x;
}

function endOfWeekSaturday(d) {
  const s = startOfWeekSunday(d);
  const e = new Date(s);
  e.setDate(e.getDate() + 6);
  return e;
}

/** Previous calendar week (Sun–Sat) relative to `d`. */
function startOfLastWeekSunday(d = new Date()) {
  const thisStart = startOfWeekSunday(d);
  const last = new Date(thisStart.getFullYear(), thisStart.getMonth(), thisStart.getDate());
  last.setDate(last.getDate() - 7);
  return last;
}

function lastCalendarMonthRange(d = new Date()) {
  const firstThisMonth = new Date(d.getFullYear(), d.getMonth(), 1);
  const lastDayPrev = new Date(firstThisMonth);
  lastDayPrev.setDate(lastDayPrev.getDate() - 1);
  const start = new Date(lastDayPrev.getFullYear(), lastDayPrev.getMonth(), 1);
  return { start, end: lastDayPrev };
}

function lastCalendarYearRange(d = new Date()) {
  const y = d.getFullYear() - 1;
  return { start: new Date(y, 0, 1), end: new Date(y, 11, 31) };
}

function extractMyAttendanceList(payload) {
  const root = payload?.data !== undefined ? payload.data : payload;
  if (Array.isArray(root)) return root;
  if (root?.content && Array.isArray(root.content)) return root.content;
  const raw = payload?.list ?? payload;
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) return [raw];
  return [];
}

function getRecordStatus(r) {
  return (r.status ?? r.attendanceStatus ?? "PENDING").toString().trim().toUpperCase();
}

/** Calendar cell: if any record is approved → present; else pending / rejected / none. */
function aggregateDayAttendanceKind(recordsForDay) {
  if (!recordsForDay?.length) return "absent";
  const statuses = recordsForDay.map((r) => getRecordStatus(r));
  if (statuses.some((s) => s === "APPROVED")) return "approved";
  if (statuses.some((s) => s === "PENDING")) return "pending";
  if (statuses.some((s) => s === "REJECTED")) return "rejected";
  return "absent";
}

const CALENDAR_DAY_TITLE = {
  approved: "Present (approved attendance)",
  pending: "Submitted — pending approval",
  rejected: "Attendance rejected",
  absent: "No attendance recorded",
};

function recordKey(r) {
  const dateStr = recordDateString(r.date);
  return r.id ?? `${r.site?.id ?? r.siteId ?? ""}-${dateStr}`;
}

function Dashboard({ onLogout }) {
  const role = localStorage.getItem("authRole") || "User";
  const email = localStorage.getItem("email") || "";
  const name = localStorage.getItem("profileName") || email;
  const showToast = useToast();
  const prevRecordsRef = useRef(null);
  const [addRecordOpen, setAddRecordOpen] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [records, setRecords] = useState([]);
  const [loadingRecords, setLoadingRecords] = useState(false);
  const [recordsError, setRecordsError] = useState("");
  const [timeTick, setTimeTick] = useState(0);
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  /**
   * this_week | last_week | calendar_month | last_month | last_year
   * calendar_month uses currentMonth from the calendar navigator.
   */
  const [recordsPeriod, setRecordsPeriod] = useState("this_week");

  const isEmployee = role === "EMPLOYEE";
  const [todayAttendance, setTodayAttendance] = useState([]);
  const [todayAttendanceLoading, setTodayAttendanceLoading] = useState(false);

  const fetchRecords = useCallback(async () => {
    const auth = getAuthHeader();
    if (!auth || !isEmployee) return;
    setLoadingRecords(true);
    try {
      setRecordsError("");
      const pageSize = 100;
      const maxPages = 25;
      const all = [];
      for (let page = 0; page < maxPages; page += 1) {
        const response = await fetch(`${BASE_URL}/api/attendance/my-attendance?page=${page}&size=${pageSize}`, {
          headers: { Authorization: auth },
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          if (page === 0) {
            if (response.status === 404) {
              setRecords([]);
            } else {
              setRecordsError(data?.message || "Could not load records.");
              setRecords([]);
            }
          }
          setLoadingRecords(false);
          return;
        }
        const list = extractMyAttendanceList(data);
        all.push(...list);
        if (list.length < pageSize) break;
      }
      setRecords(all);
    } catch (_) {
      setRecordsError("Could not load records.");
      setRecords([]);
    }
    setLoadingRecords(false);
  }, [isEmployee]);

  const fetchTodayAttendance = useCallback(async () => {
    const auth = getAuthHeader();
    if (!auth || !isEmployee) return;
    setTodayAttendanceLoading(true);
    try {
      const todayStr = todayDateString();
      const url = `${BASE_URL}/api/attendance/my-attendance/date?date=${todayStr}`;
      const response = await fetch(url, { headers: { Authorization: auth } });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        const raw = data?.data;
        setTodayAttendance(Array.isArray(raw) ? raw : []);
      } else {
        setTodayAttendance([]);
      }
    } catch (_) {
      setTodayAttendance([]);
    }
    setTodayAttendanceLoading(false);
  }, [isEmployee]);

  useEffect(() => {
    if (isEmployee) {
      fetchRecords();
      fetchTodayAttendance();
    }
  }, [isEmployee, fetchRecords, fetchTodayAttendance]);

  useEffect(() => {
    if (!isEmployee) return;
    const onFocus = () => {
      fetchRecords();
      fetchTodayAttendance();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isEmployee, fetchRecords, fetchTodayAttendance]);

  useEffect(() => {
    if (!isEmployee) return;
    const interval = setInterval(() => {
      fetchRecords();
      fetchTodayAttendance();
    }, 60 * 1000);
    return () => clearInterval(interval);
  }, [isEmployee, fetchRecords, fetchTodayAttendance]);

  useEffect(() => {
    const t = setInterval(() => setTimeTick((n) => n + 1), DATE_CHECK_INTERVAL_MS);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!isEmployee || !records.length || !showToast) {
      if (records.length) prevRecordsRef.current = records.map((r) => ({ key: recordKey(r), status: getRecordStatus(r) }));
      return;
    }
    const prev = prevRecordsRef.current;
    const current = records.map((r) => ({ key: recordKey(r), status: getRecordStatus(r) }));
    if (prev && prev.length) {
      const prevByKey = Object.fromEntries(prev.map((p) => [p.key, p.status]));
      for (const { key, status } of current) {
        const oldStatus = prevByKey[key];
        if (oldStatus === "PENDING" && status === "APPROVED") {
          showToast("Approved");
          break;
        }
        if (oldStatus === "PENDING" && status === "REJECTED") {
          showToast("Rejected");
          break;
        }
      }
    }
    prevRecordsRef.current = current;
  }, [isEmployee, records, showToast]);

  const todayStr = todayDateString();
  const hasRejectedToday = todayAttendance.some((r) => getRecordStatus(r) === "REJECTED");
  const hasApprovedOrPendingOnlyToday =
    todayAttendance.length > 0 &&
    todayAttendance.every((r) => {
      const s = getRecordStatus(r);
      return s === "APPROVED" || s === "PENDING";
    });
  const addRecordDisabled = todayAttendanceLoading ? true : hasApprovedOrPendingOnlyToday;

  const thisWeekRangeLabel = useMemo(() => {
    const n = new Date();
    const ws = startOfWeekSunday(n);
    const we = endOfWeekSaturday(n);
    const a = ws.toLocaleDateString("default", { weekday: "short", month: "short", day: "numeric" });
    const b = we.toLocaleDateString("default", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    return `${a} – ${b}`;
  }, [timeTick]);

  const lastWeekRangeLabel = useMemo(() => {
    const n = new Date();
    const ws = startOfLastWeekSunday(n);
    const we = endOfWeekSaturday(ws);
    const a = ws.toLocaleDateString("default", { weekday: "short", month: "short", day: "numeric" });
    const b = we.toLocaleDateString("default", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
    return `${a} – ${b}`;
  }, [timeTick]);

  const previousCalendarMonthLabel = useMemo(() => {
    const { start } = lastCalendarMonthRange(new Date());
    return start.toLocaleString("default", { month: "long", year: "numeric" });
  }, [timeTick]);

  const previousCalendarYear = useMemo(() => new Date().getFullYear() - 1, [timeTick]);

  const displayedRecords = useMemo(() => {
    if (!isEmployee) return [];
    let rangeStart;
    let rangeEnd;
    const now = new Date();
    switch (recordsPeriod) {
      case "this_week":
        rangeStart = startOfWeekSunday(now);
        rangeEnd = endOfWeekSaturday(now);
        break;
      case "last_week":
        rangeStart = startOfLastWeekSunday(now);
        rangeEnd = endOfWeekSaturday(rangeStart);
        break;
      case "calendar_month":
        rangeStart = new Date(currentMonth.year, currentMonth.month, 1);
        rangeEnd = new Date(currentMonth.year, currentMonth.month + 1, 0);
        break;
      case "last_month": {
        const r = lastCalendarMonthRange(now);
        rangeStart = r.start;
        rangeEnd = r.end;
        break;
      }
      case "last_year": {
        const r = lastCalendarYearRange(now);
        rangeStart = r.start;
        rangeEnd = r.end;
        break;
      }
      default:
        rangeStart = startOfWeekSunday(now);
        rangeEnd = endOfWeekSaturday(now);
    }
    const startYmd = toLocalYMD(rangeStart);
    const endYmd = toLocalYMD(rangeEnd);
    return records
      .filter((r) => {
        const ds = recordDateString(r.date);
        return ds && ds >= startYmd && ds <= endYmd;
      })
      .sort((a, b) => recordDateString(b.date).localeCompare(recordDateString(a.date)));
  }, [records, recordsPeriod, currentMonth, isEmployee, timeTick]);

  const recordsByYmd = useMemo(() => {
    const map = new Map();
    for (const r of records) {
      const ymd = recordDateString(r.date);
      if (!ymd) continue;
      if (!map.has(ymd)) map.set(ymd, []);
      map.get(ymd).push(r);
    }
    return map;
  }, [records]);

  const calendarTodayYmd = useMemo(() => todayDateString(), [timeTick]);

  const refreshTimeoutRef = useRef(null);

  const refreshSessionToken = useCallback(async () => {
    if (!localStorage.getItem("refreshToken")) return;

    try {
      const result = await refreshAccessToken();
      if (!result.ok) throw new Error(result.message || "Refresh failed");

      const expiresIn = result.expiresIn || Number(localStorage.getItem("expiresIn") || DEFAULT_REFRESH_MS);
      const nextDelay = Math.max(expiresIn - REFRESH_EARLY_MS, 30 * 1000);
      refreshTimeoutRef.current = setTimeout(refreshSessionToken, nextDelay);
    } catch {
      onLogout("Session refresh failed. Please login again.");
    }
  }, [onLogout]);

  useEffect(() => {
    const loginAt = Number(localStorage.getItem("loginAt") || Date.now());
    const remainingSessionMs = SESSION_LIMIT_MS - (Date.now() - loginAt);
    if (remainingSessionMs <= 0) {
      onLogout("Session expired after 24 hours. Please login again.");
      return;
    }

    const logoutTimer = setTimeout(() => {
      onLogout("Session expired after 24 hours. Please login again.");
    }, remainingSessionMs);

    const expiresIn = Number(localStorage.getItem("expiresIn") || DEFAULT_REFRESH_MS);
    const refreshDelay = Math.max(expiresIn - REFRESH_EARLY_MS, 30 * 1000);
    refreshTimeoutRef.current = setTimeout(refreshSessionToken, refreshDelay);

    return () => {
      clearTimeout(logoutTimer);
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
    };
  }, [onLogout, refreshSessionToken]);

  const handleAddRecordSuccess = (payload) => {
    setSuccessMessage("Attendance marked successfully.");
    setTimeout(() => setSuccessMessage(""), 4000);
    setRecordsError("");
    const newRecord = payload?.data;
    if (newRecord && typeof newRecord === "object") {
      setRecords((prev) => [newRecord, ...prev]);
    } else {
      fetchRecords();
    }
    fetchTodayAttendance();
  };

  const monthName = new Date(currentMonth.year, currentMonth.month).toLocaleString("default", { month: "long", year: "numeric" });
  const firstDay = new Date(currentMonth.year, currentMonth.month, 1).getDay();
  const daysInMonth = new Date(currentMonth.year, currentMonth.month + 1, 0).getDate();

  const prevMonth = () => {
    setCurrentMonth((prev) => (prev.month === 0 ? { year: prev.year - 1, month: 11 } : { year: prev.year, month: prev.month - 1 }));
  };
  const nextMonth = () => {
    setCurrentMonth((prev) => (prev.month === 11 ? { year: prev.year + 1, month: 0 } : { year: prev.year, month: prev.month + 1 }));
  };

  const blankDays = Array.from({ length: firstDay }, (_, i) => ({ key: `b-${i}`, blank: true }));
  const dayCells = Array.from({ length: daysInMonth }, (_, i) => ({ key: `d-${i + 1}`, day: i + 1 }));

  return (
    <div className="dashboard-page">
      <div className="dashboard-layout">
        {/* Add Record section - top */}
        <section className="dashboard-section add-record-section">
          <h2 className="section-title">Add Record</h2>
          {isEmployee ? (
            <>
              <p className="section-hint">Mark your attendance with a photo and site.</p>
              <button
                type="button"
                className="btn btn-primary btn-add-record"
                onClick={() => setAddRecordOpen(true)}
                disabled={addRecordDisabled}
              >
                Add Record
              </button>
              {addRecordDisabled && !hasRejectedToday && (
                <p className="section-hint text-muted mt-1 mb-0 small">You can add another record when the new day starts.</p>
              )}
              {hasRejectedToday && (
                <p className="section-hint text-warning mt-1 mb-0 small">Your submission for today was rejected. You can mark attendance again.</p>
              )}
              {successMessage ? <div className="alert alert-success mt-2 mb-0 py-2">{successMessage}</div> : null}
            </>
          ) : (
            <p className="text-muted mb-0">Only employees can mark attendance.</p>
          )}
        </section>

        {/* Records list - visible after adding */}
        {isEmployee && (
          <section className="dashboard-section records-section">
            <div className="records-section-head">
              <h2 className="section-title mb-0">Your Records</h2>
              <div className="records-head-controls">
                <label htmlFor="records-period-filter" className="visually-hidden">
                  Time period for records
                </label>
                <select
                  id="records-period-filter"
                  className="form-select form-select-sm records-period-select"
                  value={recordsPeriod}
                  onChange={(e) => setRecordsPeriod(e.target.value)}
                  aria-label="Time period for records"
                >
                  <option value="this_week">This week</option>
                  <option value="last_week">Last week</option>
                  <option value="calendar_month">Month (calendar)</option>
                  <option value="last_month">Last month</option>
                  <option value="last_year">Last year</option>
                </select>
                {recordsPeriod !== "this_week" ? (
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setRecordsPeriod("this_week")}>
                    This week
                  </button>
                ) : null}
              </div>
            </div>
            <p className="section-hint records-scope-hint mb-2">
              {recordsPeriod === "this_week" ? (
                <>
                  Showing <strong>this week</strong> ({thisWeekRangeLabel}).
                </>
              ) : recordsPeriod === "last_week" ? (
                <>
                  Showing <strong>last week</strong> ({lastWeekRangeLabel}).
                </>
              ) : recordsPeriod === "calendar_month" ? (
                <>
                  Showing <strong>{monthName}</strong> — use the calendar arrows to change month.
                </>
              ) : recordsPeriod === "last_month" ? (
                <>
                  Showing <strong>{previousCalendarMonthLabel}</strong> (full previous calendar month).
                </>
              ) : (
                <>
                  Showing <strong>{previousCalendarYear}</strong> (January 1 – December 31, previous calendar year).
                </>
              )}
            </p>
            {loadingRecords ? (
              <p className="text-muted mb-0">Loading records...</p>
            ) : recordsError ? (
              <p className="text-danger small mb-0">{recordsError}</p>
            ) : displayedRecords.length === 0 ? (
              <p className="text-muted mb-0">
                {records.length === 0 ? "No attendance records yet." : "No records in this period."}
              </p>
            ) : (
              <ul className="records-list">
                {displayedRecords.map((rec) => {
                  const status = (rec.status ?? rec.attendanceStatus ?? "PENDING").toString().trim().toUpperCase();
                  const isApproved = status === "APPROVED";
                  const isRejected = status === "REJECTED";
                  const rejectionReason = rec.rejectionReason?.trim() || null;
                  const dateStr = recordDateString(rec.date) || "—";
                  const displayDate =
                    dateStr !== "—" ? new Date(`${dateStr}T12:00:00`).toLocaleDateString("default", { dateStyle: "medium" }) : "—";
                  const statusClass = isApproved ? "approved" : isRejected ? "rejected" : "pending";
                  const statusLabel = isApproved ? "Approved" : isRejected ? "Rejected" : "Pending";
                  const rejectedTooltip = isRejected
                    ? (rejectionReason ? `Reason: ${rejectionReason}` : "Rejected (no reason provided)")
                    : undefined;
                  return (
                    <li key={rec.id ?? `${rec.site?.id ?? rec.siteId}-${dateStr}-${rec.date}`} className="record-item">
                      <AttendancePhotoThumb row={rec} alt="" />
                      <span className="record-site">{rec.site?.name ?? rec.siteName ?? `Site ${rec.site?.id ?? rec.siteId ?? "—"}`}</span>
                      <span className="record-date">{displayDate}</span>
                      <span
                        className={`record-status record-status--${statusClass}${isRejected ? " record-status--has-tooltip" : ""}`}
                        title={rejectedTooltip}
                        aria-label={rejectedTooltip}
                      >
                        {isApproved ? (
                          <span className="record-status-icon record-status-icon--approved" title="Approved" aria-hidden="true">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </span>
                        ) : isRejected ? (
                          <span className="record-status-icon record-status-icon--rejected" aria-hidden="true">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="15" y1="9" x2="9" y2="15" />
                              <line x1="9" y1="9" x2="15" y2="15" />
                            </svg>
                          </span>
                        ) : (
                          <span className="record-status-icon record-status-icon--pending" title="Pending" aria-hidden="true">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10" />
                              <polyline points="12 6 12 12 16 14" />
                            </svg>
                          </span>
                        )}
                        <span className="record-status-label">{statusLabel}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        )}

        {/* Calendar section - below */}
        <section className="dashboard-section calendar-section">
          <h2 className="section-title">Calendar</h2>
          {isEmployee ? (
            <p className="section-hint small text-muted mb-2">
              {/* Days are colored by attendance: green = present (approved), gray = no record, amber = pending, red = rejected. Select the month name to match{" "} */}
              <strong>Your Records</strong>.
            </p>
          ) : null}
          <div className="calendar-controls">
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={prevMonth} aria-label="Previous month">
              ‹
            </button>
            {isEmployee ? (
              <button
                type="button"
                className="calendar-month-label-btn"
                onClick={() => setRecordsPeriod("calendar_month")}
                title="Show attendance for this month"
              >
                {monthName}
              </button>
            ) : (
              <span className="calendar-month-label">{monthName}</span>
            )}
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={nextMonth} aria-label="Next month">
              ›
            </button>
          </div>
          <div className="calendar-grid">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="calendar-weekday">{d}</div>
            ))}
            {blankDays.map((cell) => (
              <div key={cell.key} className="calendar-day calendar-day--blank" />
            ))}
            {dayCells.map((cell) => {
              const ymd = `${currentMonth.year}-${String(currentMonth.month + 1).padStart(2, "0")}-${String(cell.day).padStart(2, "0")}`;
              let dayModifier = "";
              let dayTitle;
              if (isEmployee) {
                if (ymd > calendarTodayYmd) {
                  dayModifier = "calendar-day--future";
                } else {
                  const kind = aggregateDayAttendanceKind(recordsByYmd.get(ymd) || []);
                  dayModifier = `calendar-day--att-${kind}`;
                  dayTitle = CALENDAR_DAY_TITLE[kind];
                }
              }
              return (
                <div
                  key={cell.key}
                  className={dayModifier ? `calendar-day ${dayModifier}` : "calendar-day"}
                  title={dayTitle}
                >
                  {cell.day}
                </div>
              );
            })}
          </div>
          {isEmployee ? (
            <div className="calendar-legend" aria-hidden="true">
              <span className="calendar-legend-item">
                <span className="calendar-legend-swatch calendar-legend-swatch--approved" /> Present
              </span>
              <span className="calendar-legend-item">
                <span className="calendar-legend-swatch calendar-legend-swatch--absent" /> Absent
              </span>
              <span className="calendar-legend-item">
                <span className="calendar-legend-swatch calendar-legend-swatch--pending" /> Pending
              </span>
              <span className="calendar-legend-item">
                <span className="calendar-legend-swatch calendar-legend-swatch--rejected" /> Rejected
              </span>
            </div>
          ) : null}
        </section>

        {/* <div className="dashboard-card dashboard-footer-card">
          <p className="dashboard-role mb-1">Logged in as <strong>{role}</strong></p>
          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => { if (window.confirm("Are you sure you want to logout?")) onLogout(); }}>
            Logout
          </button>
        </div> */}
      </div>

      {isEmployee && (
        <AddRecordModal
          open={addRecordOpen}
          onClose={() => setAddRecordOpen(false)}
          onSuccess={handleAddRecordSuccess}
          getAuthHeader={getAuthHeader}
          onOpen={() => { fetchRecords(); fetchTodayAttendance(); }}
          hasRejectedToday={hasRejectedToday}
        />
      )}
    </div>
  );
}

export default Dashboard;
