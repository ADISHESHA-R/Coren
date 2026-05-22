import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL as BASE_URL } from "../config/apiBaseUrl.js";
import { CHECKLIST_CATEGORY_OPTIONS } from "../data/toolChecklistCatalog.js";

function getAuthHeader() {
  const tokenType = (localStorage.getItem("tokenType") || "Bearer").trim();
  let accessToken = (localStorage.getItem("accessToken") || "").trim();
  if (/^bearer\s+/i.test(accessToken)) {
    accessToken = accessToken.replace(/^bearer\s+/i, "").trim();
  }
  return accessToken ? `${tokenType} ${accessToken}` : "";
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function toYMD(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseQty(v) {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function normalizeUsageLine(line) {
  return {
    machineryId: line.machineryId,
    code: line.code ?? "",
    name: line.name ?? "",
    itemDescription: line.itemDescription ?? "",
    catalogStatus: line.catalogStatus ?? line.status ?? "ACTIVE",
    imagePath: line.imagePath ?? null,
    qty: parseQty(line.qty),
    uom: (line.uom && String(line.uom).trim()) || "HOUR",
    jobCode: line.jobCode != null && line.jobCode !== "" ? String(line.jobCode) : "",
    notes: line.notes != null && line.notes !== "" ? String(line.notes) : "",
    checklistCategoryKey: line.checklistCategoryKey ?? line.toolChecklistCategoryKey ?? "",
  };
}

function MachineryThumb({ imagePath }) {
  const [src, setSrc] = useState(null);

  useEffect(() => {
    if (!imagePath || typeof imagePath !== "string") {
      setSrc(null);
      return;
    }
    const auth = getAuthHeader();
    const url = `${BASE_URL}/api/files?path=${encodeURIComponent(imagePath.trim())}`;
    let cancelled = false;
    let objectUrl = null;
    fetch(url, { headers: auth ? { Authorization: auth } : {} })
      .then((r) => (r.ok ? r.blob() : Promise.reject()))
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
    };
  }, [imagePath]);

  if (!imagePath) {
    return <div className="machinery-thumb machinery-thumb--placeholder" aria-hidden />;
  }
  if (!src) {
    return <div className="machinery-thumb machinery-thumb--loading" aria-hidden />;
  }
  return <img src={src} alt="" className="machinery-thumb" />;
}

const STATUS_OPTIONS = [
  { value: "ACTIVE", label: "Active" },
  { value: "MAINTENANCE", label: "Maintenance" },
  { value: "RETIRED", label: "Retired" },
];

const UOM_PRESETS = ["HOUR", "DAY", "PIECE", "LITER", "KM"];

/**
 * @param {{ showSuccess: (msg: string) => void, onCatalogChange?: () => void }} props
 */
export default function AdminMachineryPanel({ showSuccess, onCatalogChange }) {
  const [tab, setTab] = useState("daily");
  const [sites, setSites] = useState([]);
  const [sitesLoading, setSitesLoading] = useState(false);
  const [siteId, setSiteId] = useState("");

  const [dailyDate, setDailyDate] = useState(() => toYMD(new Date()));
  const [lines, setLines] = useState([]);
  const [dailyLoading, setDailyLoading] = useState(false);
  const [dailyError, setDailyError] = useState("");
  const [dailySaving, setDailySaving] = useState(false);

  const [summaryYear, setSummaryYear] = useState(() => new Date().getFullYear());
  const [summaryMonth, setSummaryMonth] = useState(() => new Date().getMonth() + 1);
  const [monthlyData, setMonthlyData] = useState(null);
  const [monthlyLoading, setMonthlyLoading] = useState(false);
  const [monthlyError, setMonthlyError] = useState("");

  const [yearlyData, setYearlyData] = useState(null);
  const [yearlyLoading, setYearlyLoading] = useState(false);
  const [yearlyError, setYearlyError] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [deleteTargetId, setDeleteTargetId] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  const selectedSiteLabel = useMemo(() => {
    const id = Number(siteId);
    const s = sites.find((x) => Number(x.id) === id);
    return s ? `${s.name ?? "Site"} (#${id})` : "";
  }, [sites, siteId]);

  const fetchSites = useCallback(async () => {
    const auth = getAuthHeader();
    if (!auth) return;
    setSitesLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/admin/sites`, { headers: { Authorization: auth } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        const raw = data.data;
        setSites(Array.isArray(raw) ? raw : []);
      } else {
        setSites([]);
      }
    } catch {
      setSites([]);
    }
    setSitesLoading(false);
  }, []);

  useEffect(() => {
    fetchSites();
  }, [fetchSites]);

  const loadDailySelection = useCallback(async () => {
    const auth = getAuthHeader();
    const sid = Number(siteId);
    if (!auth || !Number.isFinite(sid) || sid <= 0 || !dailyDate) return;
    setDailyLoading(true);
    setDailyError("");
    try {
      const url = `${BASE_URL}/api/admin/machinery/usage/selection?siteId=${sid}&date=${encodeURIComponent(dailyDate)}`;
      const res = await fetch(url, { headers: { Authorization: auth } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success && data.data?.lines) {
        setLines(data.data.lines.map(normalizeUsageLine));
      } else {
        setDailyError(data?.message || "Failed to load daily usage.");
        setLines([]);
      }
    } catch {
      setDailyError("Failed to load daily usage.");
      setLines([]);
    }
    setDailyLoading(false);
  }, [siteId, dailyDate]);

  const loadMonthlySummary = useCallback(async () => {
    const auth = getAuthHeader();
    const sid = Number(siteId);
    if (!auth || !Number.isFinite(sid) || sid <= 0) return;
    setMonthlyLoading(true);
    setMonthlyError("");
    try {
      const url = `${BASE_URL}/api/admin/machinery/usage/summary/month?siteId=${sid}&year=${summaryYear}&month=${summaryMonth}`;
      const res = await fetch(url, { headers: { Authorization: auth } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setMonthlyData(data.data || null);
      } else {
        setMonthlyError(data?.message || "Failed to load monthly summary.");
        setMonthlyData(null);
      }
    } catch {
      setMonthlyError("Failed to load monthly summary.");
      setMonthlyData(null);
    }
    setMonthlyLoading(false);
  }, [siteId, summaryYear, summaryMonth]);

  const loadYearlySummary = useCallback(async () => {
    const auth = getAuthHeader();
    const sid = Number(siteId);
    if (!auth || !Number.isFinite(sid) || sid <= 0) return;
    setYearlyLoading(true);
    setYearlyError("");
    try {
      const url = `${BASE_URL}/api/admin/machinery/usage/summary/year?siteId=${sid}&year=${summaryYear}`;
      const res = await fetch(url, { headers: { Authorization: auth } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setYearlyData(data.data || null);
      } else {
        setYearlyError(data?.message || "Failed to load yearly summary.");
        setYearlyData(null);
      }
    } catch {
      setYearlyError("Failed to load yearly summary.");
      setYearlyData(null);
    }
    setYearlyLoading(false);
  }, [siteId, summaryYear]);

  useEffect(() => {
    if (tab === "monthly" && siteId) loadMonthlySummary();
  }, [tab, siteId, loadMonthlySummary]);

  useEffect(() => {
    if (tab === "yearly" && siteId) loadYearlySummary();
  }, [tab, siteId, loadYearlySummary]);

  const setLineField = (index, key, value) => {
    setLines((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], [key]: value };
      return next;
    });
  };

  const toggleUsed = (index, checked) => {
    setLines((prev) => {
      const next = [...prev];
      const row = { ...next[index] };
      if (checked) {
        row.qty = row.qty > 0 ? row.qty : 1;
      } else {
        row.qty = 0;
      }
      next[index] = row;
      return next;
    });
  };

  const saveDailySelection = async () => {
    const auth = getAuthHeader();
    const sid = Number(siteId);
    if (!auth || !Number.isFinite(sid) || sid <= 0) return;
    setDailySaving(true);
    setDailyError("");
    try {
      const outLines = lines
        .filter((l) => parseQty(l.qty) > 0)
        .map((l) => ({
          machineryId: l.machineryId,
          qty: parseQty(l.qty),
          uom: (l.uom && String(l.uom).trim()) || "HOUR",
          jobCode: l.jobCode?.trim() || null,
          notes: l.notes?.trim() || null,
        }));
      const res = await fetch(`${BASE_URL}/api/admin/machinery/usage/selection`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ siteId: sid, date: dailyDate, lines: outLines }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success !== false) {
        showSuccess(data.message || "Usage saved.");
        onCatalogChange?.();
        await loadDailySelection();
      } else {
        setDailyError(data?.message || "Failed to save usage.");
      }
    } catch {
      setDailyError("Failed to save usage.");
    }
    setDailySaving(false);
  };

  const goToDailyDate = (ymd) => {
    setDailyDate(ymd);
    setTab("daily");
  };

  const monthlyDayMap = useMemo(() => {
    const days = monthlyData?.days;
    if (!Array.isArray(days)) return new Map();
    return new Map(days.map((d) => [d.date, d]));
  }, [monthlyData]);

  const calendarCells = useMemo(() => {
    const y = summaryYear;
    const m = summaryMonth;
    const first = new Date(y, m - 1, 1);
    const pad = first.getDay();
    const dim = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < pad; i += 1) cells.push({ kind: "pad" });
    for (let d = 1; d <= dim; d += 1) {
      const ymd = `${y}-${pad2(m)}-${pad2(d)}`;
      cells.push({ kind: "day", day: d, ymd, info: monthlyDayMap.get(ymd) });
    }
    return cells;
  }, [summaryYear, summaryMonth, monthlyDayMap]);

  const handleDeleteMachinery = async (id) => {
    const auth = getAuthHeader();
    if (!auth) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/admin/machinery/${id}`, {
        method: "DELETE",
        headers: { Authorization: auth },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success !== false) {
        showSuccess(data.message || "Machinery deleted.");
        setDeleteTargetId(null);
        onCatalogChange?.();
        await loadDailySelection();
      } else {
        setDailyError(data?.message || "Could not delete machinery.");
        setDeleteTargetId(null);
      }
    } catch {
      setDailyError("Could not delete machinery.");
      setDeleteTargetId(null);
    }
    setDeleteLoading(false);
  };

  const siteIdNum = Number(siteId);

  return (
    <div className="machinery-panel dashboard-section">
      <div className="machinery-panel__header">
        <div>
          <h2 className="section-title mb-1">Machinery usage</h2>
          {selectedSiteLabel ? (
            <p className="small text-muted mb-0">Site: {selectedSiteLabel}</p>
          ) : (
            <p className="small text-muted mb-0">Select a site to continue.</p>
          )}
        </div>
        <div className="machinery-panel__site">
          <label className="form-label small mb-0 me-2" htmlFor="machinery-site-select">
            Site
          </label>
          <select
            id="machinery-site-select"
            className="form-select form-select-sm machinery-site-select"
            value={siteId}
            disabled={sitesLoading}
            onChange={(e) => setSiteId(e.target.value)}
          >
            <option value="">— Choose site —</option>
            {sites.map((s) => (
              <option key={s.id} value={String(s.id)}>
                {s.name ?? `Site ${s.id}`}
                {s.jobCode ? ` (${s.jobCode})` : ""}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="machinery-tabs btn-group btn-group-sm mb-3" role="group" aria-label="Machinery view">
        <button type="button" className={`btn ${tab === "daily" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setTab("daily")}>
          Daily
        </button>
        <button type="button" className={`btn ${tab === "monthly" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setTab("monthly")}>
          Monthly
        </button>
        <button type="button" className={`btn ${tab === "yearly" ? "btn-primary" : "btn-outline-primary"}`} onClick={() => setTab("yearly")}>
          Yearly
        </button>
      </div>
      <p className="small text-muted mb-3">
        <strong>Daily</strong> edits usage for one date; <strong>Monthly</strong> shows a calendar of the selected month; <strong>Yearly</strong> shows months of the selected year.
      </p>

      {!siteId ? (
        <p className="text-muted mb-0">Choose a site above to load machinery and usage.</p>
      ) : tab === "daily" ? (
        <>
          <div className="d-flex flex-wrap align-items-end gap-2 mb-3">
            <div>
              <label className="form-label small mb-0" htmlFor="machinery-daily-date">
                Date
              </label>
              <input
                id="machinery-daily-date"
                type="date"
                className="form-control form-control-sm"
                value={dailyDate}
                onChange={(e) => setDailyDate(e.target.value)}
              />
            </div>
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={dailyLoading} onClick={() => loadDailySelection()}>
              {dailyLoading ? "Loading…" : "Load"}
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={dailySaving || dailyLoading} onClick={() => saveDailySelection()}>
              {dailySaving ? "Saving…" : "Save selection"}
            </button>
            <button type="button" className="btn btn-success btn-sm" disabled={!siteId} onClick={() => setCreateOpen(true)}>
              + Add new machine
            </button>
          </div>
          {dailyError ? <div className="alert alert-danger py-2 mb-2">{dailyError}</div> : null}
          {!dailyLoading && lines.length === 0 ? (
            <p className="text-muted mb-0">No machines for this site yet. Add one or load after catalog exists.</p>
          ) : dailyLoading ? (
            <p className="text-muted mb-0">Loading…</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-bordered table-sm table-hover align-middle machinery-table">
                <thead>
                  <tr>
                    <th className="machinery-col-used">Used</th>
                    <th className="machinery-col-img"> </th>
                    <th>Code</th>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Qty</th>
                    <th>UOM</th>
                    <th>Job code</th>
                    <th>Notes</th>
                    <th>Checklist</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((row, idx) => {
                    const used = parseQty(row.qty) > 0;
                    return (
                      <tr key={row.machineryId ?? idx}>
                        <td>
                          <input
                            type="checkbox"
                            className="form-check-input m-0"
                            checked={used}
                            onChange={(e) => toggleUsed(idx, e.target.checked)}
                            aria-label={`Mark ${row.code} as used`}
                          />
                        </td>
                        <td>
                          <MachineryThumb imagePath={row.imagePath} />
                        </td>
                        <td className="text-nowrap">{row.code || "—"}</td>
                        <td>{row.name || "—"}</td>
                        <td>
                          <span className="small">{row.catalogStatus || "—"}</span>
                        </td>
                        <td style={{ maxWidth: "5rem" }}>
                          <input
                            type="number"
                            className="form-control form-control-sm"
                            min={0}
                            step={0.1}
                            disabled={!used}
                            value={used ? row.qty : 0}
                            onChange={(e) => setLineField(idx, "qty", parseQty(e.target.value))}
                          />
                        </td>
                        <td style={{ maxWidth: "6rem" }}>
                          <input
                            type="text"
                            className="form-control form-control-sm"
                            list={`uom-preset-${row.machineryId}`}
                            disabled={!used}
                            value={row.uom}
                            onChange={(e) => setLineField(idx, "uom", e.target.value)}
                          />
                          <datalist id={`uom-preset-${row.machineryId}`}>
                            {UOM_PRESETS.map((u) => (
                              <option key={u} value={u} />
                            ))}
                          </datalist>
                        </td>
                        <td style={{ minWidth: "7rem" }}>
                          <input
                            type="text"
                            className="form-control form-control-sm"
                            disabled={!used}
                            value={row.jobCode}
                            onChange={(e) => setLineField(idx, "jobCode", e.target.value)}
                            placeholder="—"
                          />
                        </td>
                        <td style={{ minWidth: "8rem" }}>
                          <input
                            type="text"
                            className="form-control form-control-sm"
                            disabled={!used}
                            value={row.notes}
                            onChange={(e) => setLineField(idx, "notes", e.target.value)}
                            placeholder="—"
                          />
                        </td>
                        <td className="small text-nowrap">{row.checklistCategoryKey ? String(row.checklistCategoryKey).toUpperCase() : "—"}</td>
                        <td>
                          <div className="admin-actions">
                            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setEditTarget(row)}>
                              Edit
                            </button>
                            <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => setDeleteTargetId(row.machineryId)}>
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {lines.length > 0 ? (
            <div className="mt-2">
              <button type="button" className="btn btn-primary btn-sm" disabled={dailySaving} onClick={() => saveDailySelection()}>
                {dailySaving ? "Saving…" : "Save selection"}
              </button>
            </div>
          ) : null}
        </>
      ) : tab === "monthly" ? (
        <>
          <div className="d-flex flex-wrap align-items-end gap-2 mb-3">
            <div>
              <label className="form-label small mb-0">Year</label>
              <input
                type="number"
                className="form-control form-control-sm"
                style={{ width: "6rem" }}
                value={summaryYear}
                onChange={(e) => setSummaryYear(Number(e.target.value) || summaryYear)}
              />
            </div>
            <div>
              <label className="form-label small mb-0">Month</label>
              <select className="form-select form-select-sm" value={summaryMonth} onChange={(e) => setSummaryMonth(Number(e.target.value))}>
                {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
                  <option key={m} value={m}>
                    {new Date(2000, m - 1, 1).toLocaleString("default", { month: "long" })}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={monthlyLoading} onClick={() => loadMonthlySummary()}>
              {monthlyLoading ? "Loading…" : "Apply"}
            </button>
          </div>
          {monthlyError ? <div className="alert alert-danger py-2 mb-2">{monthlyError}</div> : null}
          {monthlyLoading && !monthlyData ? (
            <p className="text-muted mb-0">Loading…</p>
          ) : (
            <>
              <p className="small text-muted mb-2">
                ✓<em>n</em> = machines recorded that day. Click a day to open the Daily tab.
              </p>
              <div className="machinery-cal-weekdays">
                {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
                  <div key={d} className="machinery-cal-weekday">
                    {d}
                  </div>
                ))}
              </div>
              <div className="machinery-cal-grid">
                {calendarCells.map((cell, i) =>
                  cell.kind === "pad" ? (
                    <div key={`pad-${i}`} className="machinery-cal-cell machinery-cal-cell--pad" />
                  ) : (
                    <button
                      key={cell.ymd}
                      type="button"
                      className={`machinery-cal-cell machinery-cal-cell--day ${cell.info ? "machinery-cal-cell--has" : ""}`}
                      onClick={() => goToDailyDate(cell.ymd)}
                    >
                      <span className="machinery-cal-daynum">{cell.day}</span>
                      {cell.info ? <span className="machinery-cal-badge">✓{cell.info.machineCount ?? 0}</span> : <span className="machinery-cal-dash">—</span>}
                    </button>
                  )
                )}
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="d-flex flex-wrap align-items-end gap-2 mb-3">
            <div>
              <label className="form-label small mb-0">Year</label>
              <input
                type="number"
                className="form-control form-control-sm"
                style={{ width: "6rem" }}
                value={summaryYear}
                onChange={(e) => setSummaryYear(Number(e.target.value) || summaryYear)}
              />
            </div>
            <button type="button" className="btn btn-outline-secondary btn-sm" disabled={yearlyLoading} onClick={() => loadYearlySummary()}>
              {yearlyLoading ? "Loading…" : "Apply"}
            </button>
          </div>
          {yearlyError ? <div className="alert alert-danger py-2 mb-2">{yearlyError}</div> : null}
          {yearlyLoading && !yearlyData ? (
            <p className="text-muted mb-0">Loading…</p>
          ) : (
            <div className="table-responsive">
              <table className="table table-bordered table-sm">
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Days with usage</th>
                    <th>Total machine-days</th>
                    <th>Top machines</th>
                  </tr>
                </thead>
                <tbody>
                  {(yearlyData?.months ?? []).map((m) => (
                    <tr key={m.month}>
                      <td>
                        <button type="button" className="btn btn-link btn-sm p-0 text-start" onClick={() => { setSummaryMonth(m.month); setTab("monthly"); }}>
                          {m.monthName ?? `Month ${m.month}`}
                        </button>
                      </td>
                      <td>{m.daysWithUsage ?? 0}</td>
                      <td>{m.totalMachineDays ?? 0}</td>
                      <td className="small">{(m.topMachineCodes ?? []).join(", ") || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {createOpen && (
        <CreateMachineryModal
          siteId={siteIdNum}
          sites={sites}
          dailyDate={dailyDate}
          onClose={() => setCreateOpen(false)}
          onSaved={async (msg) => {
            showSuccess(msg);
            setCreateOpen(false);
            onCatalogChange?.();
            await loadDailySelection();
          }}
        />
      )}

      {editTarget && (
        <EditMachineryModal
          siteId={siteIdNum}
          row={editTarget}
          onClose={() => setEditTarget(null)}
          onSaved={async (msg) => {
            showSuccess(msg);
            setEditTarget(null);
            onCatalogChange?.();
            await loadDailySelection();
          }}
        />
      )}

      {deleteTargetId != null && (
        <div className="admin-modal-backdrop" role="dialog">
          <div className="admin-modal">
            <p>Delete this machinery item? If usage history exists, the server may reject — consider retiring instead.</p>
            <div className="d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-outline-secondary" onClick={() => setDeleteTargetId(null)} disabled={deleteLoading}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger" onClick={() => handleDeleteMachinery(deleteTargetId)} disabled={deleteLoading}>
                {deleteLoading ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateMachineryModal({ siteId, sites, dailyDate, onClose, onSaved }) {
  const site = sites.find((s) => Number(s.id) === siteId);
  const [form, setForm] = useState({
    code: "",
    name: "",
    itemDescription: "",
    jobCode: site?.jobCode ?? "",
    defaultUom: "HOUR",
    serialNumber: "",
    model: "",
    status: "ACTIVE",
    markUsedOnDate: false,
    checklistCategoryKey: "",
  });
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setForm((f) => ({ ...f, jobCode: site?.jobCode ?? f.jobCode }));
  }, [site?.jobCode]);

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const auth = getAuthHeader();
    if (!auth || !Number.isFinite(siteId) || siteId <= 0) {
      setError("Invalid site.");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const ck = (form.checklistCategoryKey || "").trim().toUpperCase();
      const dataObj = {
        code: form.code.trim(),
        name: form.name.trim(),
        itemDescription: form.itemDescription.trim() || undefined,
        jobCode: form.jobCode.trim(),
        defaultUom: form.defaultUom.trim() || "HOUR",
        siteId,
        serialNumber: form.serialNumber.trim() || undefined,
        model: form.model.trim() || undefined,
        status: form.status,
        markUsedOnDate: form.markUsedOnDate ? dailyDate : null,
        ...(ck ? { checklistCategoryKey: ck } : {}),
      };
      const fd = new FormData();
      fd.append("data", new Blob([JSON.stringify(dataObj)], { type: "application/json" }));
      if (imageFile) fd.append("image", imageFile);

      const res = await fetch(`${BASE_URL}/api/admin/machinery`, {
        method: "POST",
        headers: { Authorization: auth },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        await onSaved(data.message || "Machinery created", form.markUsedOnDate);
      } else {
        setError(data?.message || "Failed to create machinery.");
      }
    } catch {
      setError("Failed to create machinery.");
    }
    setLoading(false);
  };

  return (
    <div className="admin-modal-backdrop" role="dialog">
      <div className="admin-modal admin-modal--wide machinery-modal">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h3 className="h5 mb-0">Add new machine</h3>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </div>
        {error ? <div className="alert alert-danger py-2 mb-2">{error}</div> : null}
        <form onSubmit={handleSubmit}>
          <div className="row g-2 mb-2">
            <div className="col-4">
              <div className="machinery-create-preview mb-2">
                {previewUrl ? <img src={previewUrl} alt="" className="img-fluid rounded border" /> : <div className="machinery-create-preview--empty text-muted small">No image</div>}
              </div>
              <input type="file" accept="image/jpeg,image/png,image/jpg" className="form-control form-control-sm" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="col-8">
              <div className="mb-2">
                <label className="form-label small">Code *</label>
                <input className="form-control form-control-sm" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} required />
              </div>
              <div className="mb-2">
                <label className="form-label small">Name *</label>
                <input className="form-control form-control-sm" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="mb-2">
                <label className="form-label small">Site *</label>
                <select className="form-select form-select-sm" value={String(siteId)} disabled>
                  <option value={String(siteId)}>{site ? `${site.name} (#${siteId})` : `#${siteId}`}</option>
                </select>
              </div>
              <div className="mb-2">
                <label className="form-label small">Job code</label>
                <input className="form-control form-control-sm" value={form.jobCode} onChange={(e) => setForm((f) => ({ ...f, jobCode: e.target.value }))} />
              </div>
              <div className="row g-1">
                <div className="col-6">
                  <label className="form-label small">Serial</label>
                  <input className="form-control form-control-sm" value={form.serialNumber} onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))} />
                </div>
                <div className="col-6">
                  <label className="form-label small">Model</label>
                  <input className="form-control form-control-sm" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>
          <div className="mb-2">
            <label className="form-label small">Tools checklist category (site job workflow step 3)</label>
            <select
              className="form-select form-select-sm"
              value={form.checklistCategoryKey}
              onChange={(e) => setForm((f) => ({ ...f, checklistCategoryKey: e.target.value }))}
            >
              {CHECKLIST_CATEGORY_OPTIONS.map((o) => (
                <option key={o.key || "none"} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="small text-muted mb-0 mt-1">
              Used when you <strong>Import machinery into checklist</strong> on the site workflow tools step.
            </p>
          </div>
          <div className="mb-2">
            <label className="form-label small">Description</label>
            <textarea className="form-control form-control-sm" rows={2} value={form.itemDescription} onChange={(e) => setForm((f) => ({ ...f, itemDescription: e.target.value }))} />
          </div>
          <div className="mb-2">
            <label className="form-label small">Default UOM</label>
            <input className="form-control form-control-sm" list="create-uom-presets" value={form.defaultUom} onChange={(e) => setForm((f) => ({ ...f, defaultUom: e.target.value }))} />
            <datalist id="create-uom-presets">
              {UOM_PRESETS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>
          <div className="mb-3">
            <span className="form-label small d-block">Status</span>
            <div className="d-flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((s) => (
                <label key={s.value} className="form-check form-check-inline small">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="m-status"
                    checked={form.status === s.value}
                    onChange={() => setForm((f) => ({ ...f, status: s.value }))}
                  />
                  <span className="form-check-label">{s.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="form-check mb-3">
            <input
              type="checkbox"
              className="form-check-input"
              id="mark-used-create"
              checked={form.markUsedOnDate}
              onChange={(e) => setForm((f) => ({ ...f, markUsedOnDate: e.target.checked }))}
            />
            <label className="form-check-label small" htmlFor="mark-used-create">
              Also mark as used on {dailyDate}
            </label>
          </div>
          <div className="d-flex gap-2 justify-content-end">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Saving…" : "Save & add to list"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditMachineryModal({ siteId, row, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: row.name ?? "",
    itemDescription: row.itemDescription ?? "",
    jobCode: row.jobCode ?? "",
    defaultUom: row.uom ?? "HOUR",
    serialNumber: "",
    model: "",
    status: row.catalogStatus ?? "ACTIVE",
    checklistCategoryKey: row.checklistCategoryKey ?? row.toolChecklistCategoryKey ?? "",
  });
  const [imageFile, setImageFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const auth = getAuthHeader();
    const sid = Number(siteId);
    const mid = row.machineryId;
    if (!auth || !Number.isFinite(sid) || mid == null) return;
    fetch(`${BASE_URL}/api/admin/machinery?siteId=${sid}`, { headers: { Authorization: auth } })
      .then((r) => r.json())
      .then((data) => {
        const list = data?.data;
        if (!Array.isArray(list)) return;
        const m = list.find((x) => Number(x.id) === Number(mid));
        if (!m) return;
        setForm((f) => ({
          ...f,
          jobCode: m.jobCode ?? f.jobCode,
          defaultUom: m.defaultUom ?? f.defaultUom,
          serialNumber: m.serialNumber != null ? String(m.serialNumber) : f.serialNumber,
          model: m.model != null ? String(m.model) : f.model,
          status: m.status ?? f.status,
          checklistCategoryKey: m.checklistCategoryKey ?? m.toolChecklistCategoryKey ?? f.checklistCategoryKey,
        }));
      })
      .catch(() => {});
  }, [siteId, row.machineryId]);

  useEffect(() => {
    if (!imageFile) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const auth = getAuthHeader();
    const id = row.machineryId;
    if (!auth || id == null) return;
    setLoading(true);
    setError("");
    try {
      const ck = (form.checklistCategoryKey || "").trim().toUpperCase();
      const dataObj = {
        name: form.name.trim(),
        itemDescription: form.itemDescription.trim() || undefined,
        jobCode: form.jobCode.trim(),
        defaultUom: form.defaultUom.trim() || "HOUR",
        serialNumber: form.serialNumber.trim() || undefined,
        model: form.model.trim() || undefined,
        status: form.status,
      };
      if (ck) dataObj.checklistCategoryKey = ck;
      else dataObj.checklistCategoryKey = null;
      const fd = new FormData();
      fd.append("data", new Blob([JSON.stringify(dataObj)], { type: "application/json" }));
      if (imageFile) fd.append("image", imageFile);

      const res = await fetch(`${BASE_URL}/api/admin/machinery/${id}`, {
        method: "PUT",
        headers: { Authorization: auth },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        await onSaved(data.message || "Machinery updated");
      } else {
        setError(data?.message || "Failed to update machinery.");
      }
    } catch {
      setError("Failed to update machinery.");
    }
    setLoading(false);
  };

  return (
    <div className="admin-modal-backdrop" role="dialog">
      <div className="admin-modal admin-modal--wide machinery-modal">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h3 className="h5 mb-0">
            Edit {row.code ? `${row.code} — ` : ""}
            {row.name}
          </h3>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </div>
        {error ? <div className="alert alert-danger py-2 mb-2">{error}</div> : null}
        <form onSubmit={handleSubmit}>
          <p className="small text-muted">New image replaces the existing file when provided.</p>
          <div className="row g-2 mb-2">
            <div className="col-4">
              <div className="machinery-create-preview mb-2">
                {previewUrl ? <img src={previewUrl} alt="" className="img-fluid rounded border" /> : <MachineryThumb imagePath={row.imagePath} />}
              </div>
              <input type="file" accept="image/jpeg,image/png,image/jpg" className="form-control form-control-sm" onChange={(e) => setImageFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="col-8">
              <div className="mb-2">
                <label className="form-label small">Name</label>
                <input className="form-control form-control-sm" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
              </div>
              <div className="mb-2">
                <label className="form-label small">Job code</label>
                <input className="form-control form-control-sm" value={form.jobCode} onChange={(e) => setForm((f) => ({ ...f, jobCode: e.target.value }))} />
              </div>
              <div className="row g-1">
                <div className="col-6">
                  <label className="form-label small">Serial</label>
                  <input className="form-control form-control-sm" value={form.serialNumber} onChange={(e) => setForm((f) => ({ ...f, serialNumber: e.target.value }))} />
                </div>
                <div className="col-6">
                  <label className="form-label small">Model</label>
                  <input className="form-control form-control-sm" value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
                </div>
              </div>
            </div>
          </div>
          <div className="mb-2">
            <label className="form-label small">Description</label>
            <textarea className="form-control form-control-sm" rows={2} value={form.itemDescription} onChange={(e) => setForm((f) => ({ ...f, itemDescription: e.target.value }))} />
          </div>
          <div className="mb-2">
            <label className="form-label small">Tools checklist category</label>
            <select
              className="form-select form-select-sm"
              value={form.checklistCategoryKey}
              onChange={(e) => setForm((f) => ({ ...f, checklistCategoryKey: e.target.value }))}
            >
              {CHECKLIST_CATEGORY_OPTIONS.map((o) => (
                <option key={o.key || "none"} value={o.key}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="mb-2">
            <label className="form-label small">Default UOM</label>
            <input className="form-control form-control-sm" list="edit-uom-presets" value={form.defaultUom} onChange={(e) => setForm((f) => ({ ...f, defaultUom: e.target.value }))} />
            <datalist id="edit-uom-presets">
              {UOM_PRESETS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </div>
          <div className="mb-3">
            <span className="form-label small d-block">Status</span>
            <div className="d-flex flex-wrap gap-2">
              {STATUS_OPTIONS.map((s) => (
                <label key={s.value} className="form-check form-check-inline small">
                  <input
                    className="form-check-input"
                    type="radio"
                    name="m-edit-status"
                    checked={form.status === s.value}
                    onChange={() => setForm((f) => ({ ...f, status: s.value }))}
                  />
                  <span className="form-check-label">{s.label}</span>
                </label>
              ))}
            </div>
          </div>
          <div className="d-flex gap-2 justify-content-end">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
