import { useCallback, useEffect, useLayoutEffect, Fragment, useId, useMemo, useRef, useState } from "react";
import { refreshAccessToken } from "../utils/refreshAccessToken";
import { API_BASE_URL as BASE_URL } from "../config/apiBaseUrl.js";
import {
  buildCustomerFeedbackFrontDoorUrl,
  getCustomerFeedbackInviteTokenFromAdminDto,
  getSiteCustomerFeedbackInviteToken,
  isPublicCustomerFeedbackTokenRequired,
  mergeSiteAndEndpointCustomerFeedbackForAdmin,
} from "../config/customerFeedbackPublic.js";
import { siteWorkflowPathSegment } from "../utils/adminSiteRoutes.js";
import {
  CHECKLIST_CATEGORY_OPTIONS,
  CHECKLIST_KEY_TO_LABEL,
  calendarDayForCell,
  formatYearMonthHeading,
  getMachineryChecklistKey,
  getSeededToolChecklistCategories,
  hydrateEquipmentPortalCategoriesWithPaperTemplate,
  isToolChecklistEmptyForAutoSeed,
  normalizeToolChecklistFromWizard,
  toolDayBlockLength,
  toolDayBlockStartCol,
} from "../data/toolChecklistCatalog.js";
import "../styles/site-job-workflow.css";
import {
  BEHAVIOUR_ISSUE_ROWS,
  BEHAVIOUR_MEMBER_MAX,
  BEHAVIOUR_MEMBER_MIN,
  CHALLENGE_HEADS_FALLBACK,
  TECHNICIAN_PAYMENT_SLOTS,
  WORKFLOW_JOB_TABLE_MAX_ROWS,
  WORKFLOW_JOB_TABLE_MIN_ROWS,
  buildChallengeLineWorkflowState,
  emptyAdvanceExpenseRow,
  emptyBehaviourState,
  emptyChallengeLineRow,
  extractChallengeLinesArrayFromResponse,
  emptyTechnicianPaymentRow,
  emptyToolIssueRow,
  emptyTeamMovementRow,
  mergeTechnicianPaymentLinesByPerson,
  normalizeAdvanceLines,
  normalizeTechnicianPaymentLines,
  normalizeToolIssueLines,
  normalizeTeamMovementRegister,
  TEAM_MOVEMENT_REGISTER_ROW_COUNT,
  parseBehaviourReport,
  adminResponseSuccess,
  parseCustomerFeedbackRecord,
  extractCustomerFeedbackDtoFromAdminResponse,
  resizeBehaviourMemberColumns,
  serializeBehaviourReport,
  stripChallengeLineForApi,
  sumTechnicianPaymentAmounts,
} from "../data/siteJobWorkflowForms.js";
import UserDirectoryCombobox from "./UserDirectoryCombobox.jsx";
import { directorySelectValue } from "../utils/userDirectoryDisplay.js";
import { buildAdminAttendanceQuery, parseAdminAttendancePage } from "../utils/adminAttendanceQuery.js";
import AttendancePhotoThumb from "./AttendancePhotoThumb.jsx";

const WIZARD_VERSION = 1;
/** Attendance register API uses 15-day blocks (unchanged). */
const DAYS_CHECKLIST = 15;

/** `/api/admin/sites/{segment}/…` — server accepts numeric id, job code, or slug; always encode the segment. */
function adminSitesApiBase(siteId) {
  return `${BASE_URL}/api/admin/sites/${encodeURIComponent(String(siteId ?? "").trim())}`;
}
/** Attendance register cell codes (no ✓). */
const REGISTER_ATT_CODES = ["", "P", "A", "S", "HQ", "LS", "INJ"];

/** API / legacy cells may use ✓ for present; `<select>` options only use letter codes. */
function normalizeRegisterCellCodeForUi(raw) {
  let s = String(raw ?? "").trim();
  if (s === "✓" || s === "\u2713") return "P";
  const upper = s.toUpperCase();
  if (REGISTER_ATT_CODES.includes(upper)) return upper;
  if (REGISTER_ATT_CODES.includes(s)) return s;
  return "";
}

/** Dimensional details: numeric value + unit (stored separately). */
const DIMENSION_UNITS = ["mm", "cm", "dm", "m", "km"];

function parseLegacyDimensionString(dim) {
  const str = String(dim ?? "").trim();
  if (!str) return { dimensionValue: "", dimensionUnit: "mm" };
  const sortedUnits = [...DIMENSION_UNITS].sort((a, b) => b.length - a.length);
  let dimensionUnit = "mm";
  let rest = str;
  for (const u of sortedUnits) {
    const re = new RegExp(`\\s*${u}\\s*$`, "i");
    if (re.test(rest)) {
      dimensionUnit = u;
      rest = rest.replace(re, "").trim();
      break;
    }
  }
  const numMatch = rest.match(/\d+/);
  const dimensionValue = numMatch ? numMatch[0] : "";
  return { dimensionValue, dimensionUnit };
}

function sanitizeDimensionIntegerInput(raw) {
  return String(raw ?? "").replace(/\D/g, "");
}

/** Tool checklist row date: `type="date"` needs YYYY-MM-DD; migrate common legacy patterns. */
function coerceToolItemDateToIsoInput(raw) {
  const s = String(raw ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/);
  if (!m) return "";
  const d = Number(m[1]);
  const mo = Number(m[2]);
  let y = Number(m[3]);
  if (!Number.isFinite(d) || !Number.isFinite(mo) || !Number.isFinite(y)) return "";
  if (y < 100) y += y >= 70 ? 1900 : 2000;
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return "";
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return "";
  return `${String(y).padStart(4, "0")}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Page size for GET /api/admin/users (User Management directory). */
const USER_DIRECTORY_PAGE_SIZE = 500;

/**
 * Optional timeout for the workflow-only user-directory fetch (same page size as before).
 * Uses `AbortSignal.timeout` when supported; otherwise behavior matches a plain fetch.
 */
const WORKFLOW_USER_LIST_FETCH_TIMEOUT_MS = 120_000;

function userDirectoryFetchInit() {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return { signal: AbortSignal.timeout(WORKFLOW_USER_LIST_FETCH_TIMEOUT_MS) };
  }
  return {};
}

const TOOL_ISSUE_CELL_FIELDS_BEFORE = [
  ["packingListSlNo", "text"],
  ["itemDescription", "text"],
  ["missingDate", "date"],
  ["damageDate", "date"],
  ["repairDate", "date"],
];

/** `data-label` for mobile stacked rows (advance expense line, same order as field tuples). */
const ADVANCE_EXPENSE_COLUMN_LABELS = [
  "Adv. date",
  "Opening bal.",
  "Amount",
  "Food",
  "Convey.",
  "Medical",
  "Add. manpower",
  "Welding",
  "Site exp.",
  "Bal. in hand",
  "Dispersion / notes",
];

const TOOL_ISSUE_FIELD_LABELS = {
  packingListSlNo: "Pkg list Sl.",
  itemDescription: "Item description",
  missingDate: "Missing date",
  damageDate: "Damage date",
  repairDate: "Repair date",
};

/** Head indices for user-added challenge rows (not in catalog); avoids clashing with API head indexes. */
function nextSupplementalChallengeHeadIndex(rows) {
  const used = new Set(rows.map((r) => Number(r.headIndex)).filter((n) => Number.isFinite(n)));
  let id = 90000;
  while (used.has(id)) id += 1;
  return id;
}

const STEPS = [
  { id: "intro", title: "Project introduction" },
  { id: "engineering", title: "Engineering procedure" },
  { id: "tools", title: "Tools checklist (by category)" },
  { id: "expenses", title: "Site advance & technician payments" },
  { id: "teamMovement", title: "Team members movement register" },
  { id: "toolIssues", title: "Tools missing / damage / repair" },
  { id: "challenges", title: "Challenges at site" },
  { id: "behaviour", title: "Site behaviour report" },
  { id: "attendance", title: "Attendance register" },
  { id: "completion", title: "Completion & feedback" },
];

/** Distinct trimmed string values from a row list for column filter dropdowns. */
function wfDistinctValues(rows, accessor) {
  const s = new Set();
  for (const row of rows || []) {
    const v = String(accessor(row) ?? "").trim();
    if (v) s.add(v);
  }
  return [...s].sort((a, b) => a.localeCompare(b));
}

/**
 * Row indices visible under search (any of textSearchFields) + exact column match (exactColMatchers[colKey](row) === cols[colKey]).
 */
function filterRowIndices(rows, filter, textSearchFields, exactColMatchers) {
  const f = filter || { search: "", cols: {} };
  const q = String(f.search || "").trim().toLowerCase();
  const cols = f.cols || {};
  return (rows || []).map((_, i) => i).filter((i) => {
    const row = rows[i];
    if (q) {
      const hay = textSearchFields.map((fn) => String(fn(row) ?? "").toLowerCase()).join("\n");
      if (!hay.includes(q)) return false;
    }
    for (const [key, want] of Object.entries(cols)) {
      if (!want) continue;
      const fn = exactColMatchers[key];
      if (fn && String(fn(row) ?? "").trim() !== want) return false;
    }
    return true;
  });
}

/** Top search + “Filter” button; column filters open in a right-hand drawer (accordion + FILTER / CLEAR ALL). */
function WorkflowSearchFilterShell({ drawerTitle, search, onSearchChange, columnSpec, cols, onApplyColumnFilters }) {
  const drawerTitleId = useId();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [draftCols, setDraftCols] = useState({});
  const [expanded, setExpanded] = useState({});

  const hasColumns = Array.isArray(columnSpec) && columnSpec.length > 0;

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOpen]);

  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);

  const openDrawer = () => {
    if (!hasColumns) return;
    setDraftCols({ ...(cols || {}) });
    setDrawerOpen(true);
  };

  const applyAndClose = () => {
    onApplyColumnFilters({ ...draftCols });
    setDrawerOpen(false);
  };

  const clearAllFilters = () => {
    setDraftCols({});
    onApplyColumnFilters({});
  };

  const toggleAccordion = (key) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <>
      <div className="site-job-workflow__sf-bar">
        <div className="site-job-workflow__sf-search-wrap">
          <input
            type="search"
            className="form-control site-job-workflow__sf-search"
            placeholder="Search…"
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            aria-label="Search"
          />
          <span className="site-job-workflow__sf-search-icon" aria-hidden="true">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398h-.001c.03.04.062.078.098.115l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.85-3.85a1.007 1.007 0 0 0-.115-.1zM12 6.5a5.5 5.5 0 1 1-11 0 5.5 5.5 0 0 1 11 0z" />
            </svg>
          </span>
        </div>
        {hasColumns ? (
          <button type="button" className="btn site-job-workflow__sf-filter-btn" onClick={openDrawer}>
            <span className="site-job-workflow__sf-filter-icon" aria-hidden="true" />
            Filter
          </button>
        ) : null}
      </div>
      {drawerOpen && hasColumns ? (
        <>
          <div className="site-job-workflow__sf-backdrop" onClick={() => setDrawerOpen(false)} role="presentation" />
          <div
            className="site-job-workflow__sf-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby={drawerTitleId}
          >
            <div className="site-job-workflow__sf-drawer-head">
              <h2 id={drawerTitleId} className="site-job-workflow__sf-drawer-title">
                Filter {drawerTitle}
              </h2>
              <button type="button" className="site-job-workflow__sf-drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Close filters">
                ×
              </button>
            </div>
            <div className="site-job-workflow__sf-drawer-body">
              {columnSpec.map(({ key, label, options }) => (
                <div key={key} className="site-job-workflow__sf-accordion">
                  <button type="button" className="site-job-workflow__sf-accordion-head" onClick={() => toggleAccordion(key)} aria-expanded={Boolean(expanded[key])}>
                    <span>{label}</span>
                    <span className={`site-job-workflow__sf-accordion-chevron ${expanded[key] ? "is-open" : ""}`} aria-hidden />
                  </button>
                  {expanded[key] ? (
                    <div className="site-job-workflow__sf-accordion-panel">
                      <label className="site-job-workflow__sf-panel-label" htmlFor={`${drawerTitleId}-${key}`}>
                        {label}
                      </label>
                      <select
                        id={`${drawerTitleId}-${key}`}
                        className="form-select form-select-sm"
                        value={draftCols[key] ?? ""}
                        onChange={(e) => setDraftCols((d) => ({ ...d, [key]: e.target.value }))}
                      >
                        <option value="">All</option>
                        {(options || []).map((o) => (
                          <option key={o} value={o}>
                            {o.length > 56 ? `${o.slice(0, 56)}…` : o}
                          </option>
                        ))}
                      </select>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
            <div className="site-job-workflow__sf-drawer-footer">
              <button type="button" className="site-job-workflow__sf-btn-filter" onClick={applyAndClose}>
                FILTER
              </button>
              <button type="button" className="site-job-workflow__sf-btn-clear" onClick={clearAllFilters}>
                CLEAR ALL
              </button>
            </div>
          </div>
        </>
      ) : null}
    </>
  );
}

function getAuthHeader() {
  const tokenType = (localStorage.getItem("tokenType") || "Bearer").trim();
  let accessToken = (localStorage.getItem("accessToken") || "").trim();
  if (/^bearer\s+/i.test(accessToken)) {
    accessToken = accessToken.replace(/^bearer\s+/i, "").trim();
  }
  return accessToken ? `${tokenType} ${accessToken}` : "";
}

function parseWizardPayload(raw) {
  if (raw == null || raw === "") return { step: 1, data: {} };
  try {
    let obj = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (typeof obj === "string") obj = JSON.parse(obj);
    if (!obj || typeof obj !== "object") return { step: 1, data: {} };
    const step = Number(obj.step) > 0 ? Number(obj.step) : 1;
    const data = obj.data && typeof obj.data === "object" && !Array.isArray(obj.data) ? obj.data : {};
    if (!data.version) data.version = WIZARD_VERSION;
    return { step, data };
  } catch {
    return { step: 1, data: { version: WIZARD_VERSION } };
  }
}

/** YYYY-MM for this calendar month (tools checklist heading fallback). */
function currentYearMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Resolve year + month (1–12) from intro “Tools checklist month” or current calendar month. */
function parseYearMonthFromIntroToolsChecklist(yyyyMm) {
  const m = String(yyyyMm ?? "").trim();
  if (/^\d{4}-\d{2}$/.test(m)) {
    const [y, mo] = m.split("-").map(Number);
    if (Number.isFinite(y) && mo >= 1 && mo <= 12) return { year: y, month: mo };
  }
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

function normalizeDayPresentMap(dp) {
  if (!dp || typeof dp !== "object") return {};
  const out = {};
  for (const [k, v] of Object.entries(dp)) {
    const day = Number(k);
    if (!(day >= 1 && day <= 31)) continue;
    if (v === true) out[String(day)] = true;
  }
  return out;
}

function normalizeEquipmentPortalPayload(raw) {
  if (!raw || typeof raw !== "object") {
    const { year, month } = parseYearMonthFromIntroToolsChecklist("");
    return { year, month, categories: [] };
  }
  const y = raw.year != null ? Number(raw.year) : null;
  const mo = raw.month != null ? Number(raw.month) : null;
  const categories = Array.isArray(raw.categories)
    ? raw.categories.map((cat, ci) => ({
        id: cat.id != null && cat.id !== "" ? Number(cat.id) : null,
        title: String(cat.title ?? ""),
        sortOrder: cat.sortOrder != null ? Number(cat.sortOrder) : ci,
        items: Array.isArray(cat.items)
          ? cat.items.map((it, ii) => ({
              id: it.id != null && it.id !== "" ? Number(it.id) : null,
              lineOrder: it.lineOrder != null ? Number(it.lineOrder) : ii,
              itemDescription: it.itemDescription != null ? String(it.itemDescription) : "",
              uom: it.uom != null ? String(it.uom) : "",
              qty: it.qty != null ? String(it.qty) : "",
              dateNote:
                it.dateNote != null && String(it.dateNote).trim() !== "" ? String(it.dateNote).trim() : null,
              dayPresent: normalizeDayPresentMap(it.dayPresent),
            }))
          : [],
      }))
    : [];
  return {
    year: Number.isFinite(y) ? y : null,
    month: Number.isFinite(mo) && mo >= 1 && mo <= 12 ? mo : null,
    categories,
  };
}

function emptyEquipmentPortalItem(lineOrder) {
  return {
    id: null,
    lineOrder,
    itemDescription: "",
    uom: "",
    qty: "",
    dateNote: null,
    dayPresent: {},
  };
}

/** Default A/B/C/I/J/K section titles so machinery import (`A.` prefix match) works. */
function buildDefaultEquipmentPortalTemplateCategories() {
  return CHECKLIST_CATEGORY_OPTIONS.filter((o) => o.key).map((o, i) => {
    const label = CHECKLIST_KEY_TO_LABEL[o.key] || o.key;
    return {
      id: null,
      title: `${o.key}. ${label}`,
      sortOrder: i,
      items: [emptyEquipmentPortalItem(0)],
    };
  });
}

/** Build PUT body for /job-data/equipment-portal (full tree + month availability). */
function buildEquipmentPortalPutBody(portal) {
  const y = portal?.year;
  const mo = portal?.month;
  const includeMonth = Number.isFinite(y) && Number.isFinite(mo) && mo >= 1 && mo <= 12;
  const categories = Array.isArray(portal?.categories) ? portal.categories : [];
  const body = {
    categories: categories.map((cat, ci) => ({
      id: cat.id,
      title: String(cat.title ?? "").trim() || "Untitled",
      sortOrder: cat.sortOrder != null ? Number(cat.sortOrder) : ci,
      items: (cat.items || []).map((it, ii) => {
        const item = {
          id: it.id,
          lineOrder: it.lineOrder != null ? Number(it.lineOrder) : ii,
          itemDescription: it.itemDescription != null ? String(it.itemDescription) : "",
          uom: it.uom != null ? String(it.uom) : "",
          qty: it.qty != null ? String(it.qty) : "",
          dateNote:
            it.dateNote != null && String(it.dateNote).trim() !== "" ? String(it.dateNote).trim() : null,
        };
        if (includeMonth) {
          const map = {};
          const dp = it.dayPresent && typeof it.dayPresent === "object" ? it.dayPresent : {};
          for (let d = 1; d <= 31; d += 1) {
            const key = String(d);
            if (dp[key] === true) map[key] = true;
          }
          item.dayPresent = map;
        } else {
          item.dayPresent = null;
        }
        return item;
      }),
    })),
  };
  if (includeMonth) {
    body.availabilityYear = y;
    body.availabilityMonth = mo;
  }
  return body;
}

/**
 * Build JSON body for `PUT|POST /api/admin/sites/{id}/job-data/workflow-batch`.
 * Keys omitted when not applicable; must stay aligned with `executeStepSave` payloads.
 * @see ../docs/SITE_JOB_WORKFLOW_API.md
 */
function buildWorkflowBatchRequestBody(ci, saveCtx, wizardStep1ForPut, wizardDataSnapshot) {
  const body = {
    wizard: {
      step: wizardStep1ForPut,
      data: { ...wizardDataSnapshot },
    },
  };
  if (ci <= 1) return body;
  if (ci === 2) {
    if (saveCtx.equipmentPortal) {
      body.equipmentPortal = buildEquipmentPortalPutBody(saveCtx.equipmentPortal);
    }
    return body;
  }
  if (ci === 3) {
    if (!Array.isArray(saveCtx.advanceLines) || !Array.isArray(saveCtx.technicianPaymentLines)) {
      throw new Error("Advance or technician payments invalid.");
    }
    body.advanceExpenseLines = saveCtx.advanceLines;
    body.technicianPayments = normalizeTechnicianPaymentLines(
      mergeTechnicianPaymentLinesByPerson(saveCtx.technicianPaymentLines),
    );
    return body;
  }
  if (ci === 4) return body;
  if (ci === 5) {
    if (!Array.isArray(saveCtx.toolIssueLines)) throw new Error("Tool issues invalid.");
    body.toolIssues = saveCtx.toolIssueLines;
    return body;
  }
  if (ci === 6) {
    body.challengeLines = saveCtx.challengeLineRows.map(stripChallengeLineForApi);
    return body;
  }
  if (ci === 7) {
    body.behaviourReport = serializeBehaviourReport(saveCtx.behaviourState);
    return body;
  }
  if (ci === 8) {
    const cells = [];
    const dirty = saveCtx.attendanceDirtyCells;
    if (dirty && typeof dirty.forEach === "function") {
      dirty.forEach((code, key) => {
        const [employeeUserId, date] = String(key).split("|");
        if (!employeeUserId || !date || !code) return;
        cells.push({ employeeUserId: Number(employeeUserId), date, code });
      });
    }
    if (cells.length > 0) {
      body.attendanceRegisterCells = { cells };
    }
    return body;
  }
  return body;
}

function findEquipmentCategoryIndexForMachineryKey(categories, ck) {
  const k = String(ck || "").toUpperCase().trim();
  if (!k) return -1;
  return (categories || []).findIndex((c) => String(c.title || "").trim().toUpperCase().startsWith(`${k}.`));
}

const EQUIPMENT_ROW_DND_MIME = "application/x-corem-equipment-row";

function parseEquipmentDnDTransfer(e) {
  try {
    const raw = e.dataTransfer.getData(EQUIPMENT_ROW_DND_MIME) || e.dataTransfer.getData("text/plain");
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (!Number.isFinite(Number(o.fromCi)) || !Number.isFinite(Number(o.fromIi))) return null;
    return { fromCi: Number(o.fromCi), fromIi: Number(o.fromIi) };
  } catch {
    return null;
  }
}

/** Move one item so it ends up before index `toIi` in `toCi` (after removal from source). */
function moveEquipmentItemToIndex(categories, fromCi, fromIi, toCi, toIi) {
  const next = categories.map((c) => ({ ...c, items: [...(c.items || [])] }));
  if (fromCi < 0 || fromCi >= next.length || toCi < 0 || toCi >= next.length) return categories;
  const fromItems = next[fromCi].items;
  if (fromIi < 0 || fromIi >= fromItems.length) return categories;
  const [moved] = fromItems.splice(fromIi, 1);
  const toItems = next[toCi].items;
  let insertAt = toIi;
  if (fromCi === toCi && fromIi < insertAt) insertAt -= 1;
  if (insertAt < 0) insertAt = 0;
  if (insertAt > toItems.length) insertAt = toItems.length;
  toItems.splice(insertAt, 0, moved);
  return next.map((c) => ({
    ...c,
    items: c.items.map((it, idx) => ({ ...it, lineOrder: idx })),
  }));
}

function appendEquipmentItemToCategory(categories, fromCi, fromIi, toCi) {
  const len = (categories[toCi]?.items || []).length;
  return moveEquipmentItemToIndex(categories, fromCi, fromIi, toCi, len);
}

function portalEligibleForLayoutApi(portal) {
  const cats = portal?.categories;
  if (!Array.isArray(cats) || cats.length === 0) return false;
  for (const c of cats) {
    if (c.id == null || !Number.isFinite(Number(c.id))) return false;
    for (const it of c.items || []) {
      if (it.id == null || !Number.isFinite(Number(it.id))) return false;
    }
  }
  return true;
}

/** Body for PUT .../equipment-portal/layout — persisted categories only, every item id once. */
function buildEquipmentLayoutRequestBody(portal) {
  const categories = portal?.categories || [];
  return {
    categories: categories
      .filter((c) => c.id != null && Number.isFinite(Number(c.id)))
      .map((c) => ({
        categoryId: Number(c.id),
        itemIds: (c.items || [])
          .map((it) => it.id)
          .filter((id) => id != null && Number.isFinite(Number(id)))
          .map(Number),
      })),
  };
}

function emptyIntroFromSite(site) {
  return {
    clientName: site?.customerName ?? "",
    siteLocation: site?.address ?? site?.name ?? "",
    jobDescription: "",
    scheduledDays: site?.totalProjectDays != null ? String(site.totalProjectDays) : site?.estimatedDays != null ? String(site.estimatedDays) : "",
    proposedEquipment: Array.from({ length: 5 }, (_, i) => ({ line: i + 1, text: "" })),
    dimensionalRows: Array.from({ length: 5 }, (_, i) => ({
      slNo: i + 1,
      activity: "Machining of stay ring surfaces",
      dimensionValue: "",
      dimensionUnit: "mm",
      description: "",
    })),
    mobilization: [
      { slNo: 1, activity: "Eqmt Despatched on", date: "" },
      { slNo: 2, activity: "Eqmt Reached site on", date: "" },
      { slNo: 3, activity: "Eqmt Set up started on", date: "" },
      { slNo: 4, activity: "Machining Started on", date: "" },
      { slNo: 5, activity: "Job Completed on", date: "" },
      { slNo: 6, activity: "Eqmt Dspatchd from site", date: "" },
      { slNo: 7, activity: "Eqmt Reached HO on", date: "" },
      { slNo: 8, activity: "Manpower Mobilised on", date: "" },
    ],
    teamMembers: Array.from({ length: 4 }, (_, i) => ({
      slNo: i + 1,
      name: "",
      employeeUserId: null,
    })),
    /** YYYY-MM; empty means “use current month” on the tools checklist step. */
    toolsChecklistMonth: "",
  };
}

/** Normalize saved intro so new fields (employeeUserId, row counts) always work. */
function normalizeProjectIntroduction(intro) {
  if (!intro || typeof intro !== "object") return intro;
  let pe = Array.isArray(intro.proposedEquipment) ? intro.proposedEquipment : [];
  if (pe.length === 0) pe = [{ line: 1, text: "" }];
  pe = pe.map((r, i) => ({ line: i + 1, text: r?.text ?? "" }));

  let dr = Array.isArray(intro.dimensionalRows) ? intro.dimensionalRows : [];
  if (dr.length === 0) {
    dr = [{ slNo: 1, activity: "Machining of stay ring surfaces", dimensionValue: "", dimensionUnit: "mm", description: "" }];
  }
  dr = dr.map((r, i) => {
    let dimensionValue =
      r?.dimensionValue != null ? sanitizeDimensionIntegerInput(String(r.dimensionValue)) : "";
    let dimensionUnit = String(r?.dimensionUnit ?? "mm").toLowerCase();
    if (!DIMENSION_UNITS.includes(dimensionUnit)) dimensionUnit = "mm";
    const legacyDim = r?.dimensions != null ? String(r.dimensions) : "";
    if (!dimensionValue && legacyDim.trim()) {
      const parsed = parseLegacyDimensionString(legacyDim);
      dimensionValue = parsed.dimensionValue;
      dimensionUnit = parsed.dimensionUnit;
    }
    return {
      slNo: i + 1,
      activity: r?.activity ?? "Machining of stay ring surfaces",
      dimensionValue,
      dimensionUnit,
      description: r?.description ?? "",
    };
  });

  let mob = Array.isArray(intro.mobilization) ? intro.mobilization : [];
  if (mob.length === 0) {
    mob = emptyIntroFromSite(null).mobilization;
  }
  mob = mob.map((r, i) => ({
    slNo: i + 1,
    activity: r?.activity ?? "",
    date: r?.date ?? "",
  }));

  let tm = Array.isArray(intro.teamMembers) ? intro.teamMembers : [];
  if (tm.length === 0) tm = [{ slNo: 1, name: "", employeeUserId: null }];
  tm = tm.map((r, i) => {
    const rawId = r?.employeeUserId;
    const employeeUserId =
      rawId != null && rawId !== "" && !Number.isNaN(Number(rawId)) ? Number(rawId) : null;
    return {
      slNo: i + 1,
      name: r?.name ?? "",
      employeeUserId,
    };
  });

  let tcm = intro.toolsChecklistMonth != null ? String(intro.toolsChecklistMonth).trim() : "";
  if (!/^\d{4}-\d{2}$/.test(tcm)) tcm = "";

  return { ...intro, proposedEquipment: pe, dimensionalRows: dr, mobilization: mob, teamMembers: tm, toolsChecklistMonth: tcm };
}

function defaultEngineeringRows() {
  return Array.from({ length: 8 }, (_, i) => ({
    slNo: i + 1,
    activity: "",
    day: "",
    targetTime: "",
    actualTime: "",
    reasonDelay: "",
  }));
}

/** Keep engineering rows + target days aligned with intro.scheduledDays when present. */
function ensureEngineeringProcedure(eng, projectIntroduction, sitePayload) {
  const introStr = (projectIntroduction?.scheduledDays != null ? String(projectIntroduction.scheduledDays) : "").trim();
  const siteDays =
    sitePayload?.totalProjectDays != null
      ? String(sitePayload.totalProjectDays)
      : sitePayload?.estimatedDays != null
        ? String(sitePayload.estimatedDays)
        : "";
  const existingTarget = (eng?.targetScheduleDays != null ? String(eng.targetScheduleDays) : "").trim();
  const targetScheduleDays = introStr || existingTarget || siteDays;

  let rows = Array.isArray(eng?.rows) && eng.rows.length > 0 ? [...eng.rows] : defaultEngineeringRows();
  rows = rows.map((r, i) => ({
    slNo: i + 1,
    activity: r?.activity ?? "",
    day: r?.day ?? "",
    targetTime: r?.targetTime ?? "",
    actualTime: r?.actualTime ?? "",
    reasonDelay: r?.reasonDelay ?? "",
  }));

  return { ...eng, targetScheduleDays, rows };
}

async function adminFetchJson(url, options = {}) {
  const authHeader = getAuthHeader();
  if (!authHeader) throw new Error("Not authenticated.");
  const headers = { Authorization: authHeader, ...(options.headers || {}) };
  let res = await fetch(url, { ...options, headers });
  if (res.status === 401 && localStorage.getItem("refreshToken")) {
    const refreshed = await refreshAccessToken();
    if (refreshed.ok) {
      const h = getAuthHeader();
      if (h) res = await fetch(url, { ...options, headers: { ...options.headers, Authorization: h } });
    }
  }
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

const SHIFT_LABELS = {
  FIRST_HALF: "First Half",
  SECOND_HALF: "Second Half",
  FULL_DAY: "Full Day",
};

/** Jackson / DB may return LocalDate as "YYYY-MM-DD", epoch millis, or [y,m,d]. */
function normalizeBoundaryValue(raw) {
  if (raw == null) return "";
  if (Array.isArray(raw) && raw.length >= 3) {
    const y = Number(raw[0]);
    const m = Number(raw[1]);
    const d = Number(raw[2]);
    if (Number.isFinite(y) && Number.isFinite(m) && Number.isFinite(d)) {
      return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    }
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const dt = new Date(raw);
    if (!Number.isNaN(dt.getTime())) {
      return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
    }
  }
  const s = String(raw).trim();
  if (!s) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return s;
}

function firstBoundary(...raws) {
  for (const r of raws) {
    const n = normalizeBoundaryValue(r);
    if (n) return n;
  }
  return "";
}

function mobilizationDateBySlNo(intro, slNo) {
  const mob = intro?.mobilization;
  if (!Array.isArray(mob)) return "";
  const row = mob.find((x) => Number(x?.slNo) === slNo);
  return normalizeBoundaryValue(row?.date);
}

/**
 * Register + site payloads vary by API (Lombok / Jackson naming).
 * Falls back to intro mobilization (Machining started / Job completed) when site DTO omits dates.
 */
function siteStartDisplay(site, reg, intro) {
  const v = firstBoundary(
    reg?.siteStartDate,
    reg?.siteStart,
    reg?.startDate,
    reg?.projectStartDate,
    reg?.site_start_date,
    reg?.site_start,
    site?.siteStartDate,
    site?.siteStart,
    site?.startDate,
    site?.projectStartDate,
    site?.projectStart,
    site?.site_start_date,
    site?.site_start,
    site?.workStartDate,
    site?.commencementDate,
    site?.plannedStartDate,
    mobilizationDateBySlNo(intro, 4),
  );
  return v || "—";
}

function siteEndDisplay(site, reg, intro) {
  const v = firstBoundary(
    reg?.siteEndDate,
    reg?.siteEnd,
    reg?.endDate,
    reg?.projectEndDate,
    reg?.site_end_date,
    reg?.site_end,
    site?.siteEndDate,
    site?.siteEnd,
    site?.endDate,
    site?.projectEndDate,
    site?.projectEnd,
    site?.site_end_date,
    site?.site_end,
    site?.workEndDate,
    site?.completionDate,
    site?.plannedEndDate,
    mobilizationDateBySlNo(intro, 5),
  );
  return v || "—";
}

function attendanceRowDateYmd(row) {
  const raw = row?.date ?? row?.attendanceDate;
  if (!raw) return "";
  if (typeof raw === "string") {
    const s = raw.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  }
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function attendanceRowStatus(row) {
  return (row?.status ?? row?.attendanceStatus ?? "PENDING").toString().trim().toUpperCase();
}

/** Flattened fields for portal check-in list search / column filters. */
function attendancePortalFilterFields(row) {
  const ymd = attendanceRowDateYmd(row);
  const emp = row?.employeeName ?? row?.user?.name ?? row?.employee?.name ?? row?.name ?? "";
  const siteName = row?.site?.name ?? row?.siteName ?? "";
  const shiftLabel = SHIFT_LABELS[row?.shift] ?? row?.shift ?? "";
  return {
    employee: String(emp).trim(),
    shift: String(shiftLabel).trim(),
    site: String(siteName).trim(),
    status: attendanceRowStatus(row),
    date: ymd,
  };
}

const BEHAVIOUR_CELL_FILTER_OPTS = ["Has mark", "Has date", "Empty"];

function behaviourIssueRowMatchesFilters(issueRowIndex, behaviourState, filter) {
  const f = filter || { search: "", cols: {} };
  const nMem = behaviourState.members?.length ?? 0;
  const cols = f.cols || {};
  for (let mi = 0; mi < nMem; mi += 1) {
    const want = cols[`m${mi}`];
    if (!want) continue;
    const cell = behaviourState.matrix[issueRowIndex]?.[mi] ?? { checked: false, date: "" };
    const hasDate = Boolean(String(cell.date ?? "").trim());
    if (want === "Has mark" && !cell.checked) return false;
    if (want === "Has date" && !hasDate) return false;
    if (want === "Empty" && (cell.checked || hasDate)) return false;
  }
  const q = String(f.search ?? "").trim().toLowerCase();
  if (q) {
    const issue = BEHAVIOUR_ISSUE_ROWS[issueRowIndex];
    const hay = `${issue?.label ?? ""} ${issue?.slNo ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function formatYmdLocalMedium(ymd) {
  if (!ymd || ymd.length < 10) return "—";
  const parts = ymd.slice(0, 10).split("-").map(Number);
  if (parts.length !== 3 || !parts[0]) return ymd.slice(0, 10);
  const [y, m, d] = parts;
  try {
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { dateStyle: "medium" });
  } catch {
    return ymd.slice(0, 10);
  }
}

export default function AdminSiteJobWorkflow({
  siteId,
  showSuccess,
  showError,
  onExit,
  onNavigateSitesList,
  urlStep1Based = null,
  onStepIndexChange,
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const AUTOSAVE_LS_KEY = "corem.admin.siteJobWorkflow.autosave";
  const [autosaveEnabled, setAutosaveEnabled] = useState(() => {
    try {
      if (typeof localStorage === "undefined") return true;
      const v = localStorage.getItem(AUTOSAVE_LS_KEY);
      if (v === "0") return false;
      return true;
    } catch {
      return true;
    }
  });
  /** Short status for optional autosave (non-blocking). */
  const [autosaveStatus, setAutosaveStatus] = useState("");
  const [site, setSite] = useState(null);
  const [wizardData, setWizardData] = useState({ version: WIZARD_VERSION });
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const [behaviourState, setBehaviourState] = useState(() => emptyBehaviourState());
  const [attendanceBlock, setAttendanceBlock] = useState(0);
  const [attendanceRegister, setAttendanceRegister] = useState(null);
  const [attendanceDirtyCells, setAttendanceDirtyCells] = useState(() => new Map());
  const [customerFeedback, setCustomerFeedback] = useState(null);
  const [toolDayBlock, setToolDayBlock] = useState(0);
  /** Inline feedback on the tools step (dashboard success banner is often off-screen when scrolled). */
  const [toolChecklistActionMessage, setToolChecklistActionMessage] = useState({ kind: "", text: "" });
  const [addCategoryOpen, setAddCategoryOpen] = useState(false);
  const [addCategoryName, setAddCategoryName] = useState("");
  const addCategoryInputRef = useRef(null);
  const [machineryList, setMachineryList] = useState([]);
  const [advanceLines, setAdvanceLines] = useState(() => normalizeAdvanceLines([]));
  const [technicianPaymentLines, setTechnicianPaymentLines] = useState(() =>
    normalizeTechnicianPaymentLines([]),
  );
  const [toolIssueLines, setToolIssueLines] = useState(() => normalizeToolIssueLines([]));
  /** Equipment portal (step 3 — tools checklist): loaded/saved via GET/PUT .../job-data/equipment-portal. */
  const [equipmentPortal, setEquipmentPortal] = useState(null);
  const [equipmentPortalLoadError, setEquipmentPortalLoadError] = useState("");
  const lastEquipmentPortalFetchRef = useRef({ year: null, month: null });
  /** Bumps when a new workflow load starts the user-directory fetch; stale responses are ignored. */
  const workflowUserDirectoryLoadSeqRef = useRef(0);
  /** Visual: which equipment row is being dragged (categoryIndex-itemIndex). */
  const [equipmentDragKey, setEquipmentDragKey] = useState(null);
  const [challengeLineRows, setChallengeLineRows] = useState(() => buildChallengeLineWorkflowState([], CHALLENGE_HEADS_FALLBACK));
  /** Last challenge head catalog from load (meta API or fallback); used when refetching rows after batch save. */
  const challengeHeadsSnapshotRef = useRef(CHALLENGE_HEADS_FALLBACK);
  const [attendanceAdHocPickId, setAttendanceAdHocPickId] = useState("");
  const [siteAttendanceRecords, setSiteAttendanceRecords] = useState([]);
  const [siteAttendanceLoading, setSiteAttendanceLoading] = useState(false);
  const [siteAttendanceError, setSiteAttendanceError] = useState("");
  const [siteAttendanceStatusTab, setSiteAttendanceStatusTab] = useState("ALL");
  const [siteAttRejectId, setSiteAttRejectId] = useState(null);
  const [siteAttRejectReason, setSiteAttRejectReason] = useState("");
  const [siteAttActionId, setSiteAttActionId] = useState(null);
  const [employeeOptions, setEmployeeOptions] = useState([]);
  /** Per-table list UI: { [tableKey]: { search, cols: { columnKey: exactValue } } } */
  const [workflowTableFilters, setWorkflowTableFilters] = useState({});
  const [stepShellCollapsed, setStepShellCollapsed] = useState(false);
  const primaryTabsRef = useRef(null);
  const urlStep1BasedRef = useRef(urlStep1Based);
  urlStep1BasedRef.current = urlStep1Based;
  /** Server wizard `step` (1-based); autosave uses this so we do not regress progress when editing earlier steps. */
  const wizardPersistedStep1Ref = useRef(1);
  const saveCtxRef = useRef({});
  const autosaveRunningRef = useRef(false);
  const showSuccessRef = useRef(showSuccess);
  showSuccessRef.current = showSuccess;
  const showErrorRef = useRef(showError);
  showErrorRef.current = showError;
  const onStepIndexChangeRef = useRef(onStepIndexChange);
  onStepIndexChangeRef.current = onStepIndexChange;

  const patchWfFilter = useCallback((tableKey, patch) => {
    setWorkflowTableFilters((prev) => {
      const cur = prev[tableKey] || { search: "", cols: {} };
      const replaceCols = patch.replaceCols === true;
      const hasCols = Object.prototype.hasOwnProperty.call(patch, "cols");
      const nextCols = hasCols ? (replaceCols ? { ...(patch.cols || {}) } : { ...cur.cols, ...(patch.cols || {}) }) : cur.cols;
      const { cols: _drop, replaceCols: _rc, ...rest } = patch;
      return { ...prev, [tableKey]: { ...cur, ...rest, cols: nextCols } };
    });
  }, []);

  const wizardDataRef = useRef(wizardData);
  wizardDataRef.current = wizardData;
  const currentStepIndexRef = useRef(currentStepIndex);
  currentStepIndexRef.current = currentStepIndex;

  const machineryByCategory = useMemo(() => {
    const map = new Map();
    for (const m of machineryList) {
      const ck = getMachineryChecklistKey(m);
      const label = ck ? `${ck}. ${CHECKLIST_KEY_TO_LABEL[ck] ?? ck}` : (m.itemDescription && String(m.itemDescription).trim()) || "Machinery (catalog)";
      if (!map.has(label)) map.set(label, []);
      map.get(label).push(m);
    }
    return Array.from(map.entries());
  }, [machineryList]);

  const attendanceAddCandidates = useMemo(() => {
    const ids = new Set((attendanceRegister?.rows || []).map((r) => Number(r.employeeId)).filter(Number.isFinite));
    return employeeOptions.filter((u) => u.id != null && !ids.has(Number(u.id)));
  }, [attendanceRegister, employeeOptions]);

  const filteredSiteAttendance = useMemo(() => {
    if (siteAttendanceStatusTab === "ALL") return siteAttendanceRecords;
    return siteAttendanceRecords.filter((r) => attendanceRowStatus(r) === siteAttendanceStatusTab);
  }, [siteAttendanceRecords, siteAttendanceStatusTab]);

  const siteAttendancePortalDisplay = useMemo(() => {
    const rows = filteredSiteAttendance;
    const f = workflowTableFilters.site_att_portal || { search: "", cols: {} };
    return rows.filter((req) => {
      const v = attendancePortalFilterFields(req);
      const q = String(f.search || "").trim().toLowerCase();
      if (q) {
        const hay = [v.employee, v.shift, v.site, v.status, v.date].join("\n").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      const c = f.cols || {};
      if (c.employee && v.employee !== c.employee) return false;
      if (c.shift && v.shift !== c.shift) return false;
      if (c.site && v.site !== c.site) return false;
      if (c.status && v.status !== c.status) return false;
      if (c.date && v.date !== c.date) return false;
      return true;
    });
  }, [filteredSiteAttendance, workflowTableFilters]);

  const siteAttendancePortalColumnSpec = useMemo(() => {
    const rows = filteredSiteAttendance;
    return [
      { key: "employee", label: "Employee", options: wfDistinctValues(rows, (r) => attendancePortalFilterFields(r).employee) },
      { key: "shift", label: "Shift", options: wfDistinctValues(rows, (r) => attendancePortalFilterFields(r).shift) },
      { key: "site", label: "Site", options: wfDistinctValues(rows, (r) => attendancePortalFilterFields(r).site) },
      { key: "status", label: "Status", options: wfDistinctValues(rows, (r) => attendancePortalFilterFields(r).status) },
      { key: "date", label: "Date", options: wfDistinctValues(rows, (r) => attendancePortalFilterFields(r).date) },
    ];
  }, [filteredSiteAttendance]);

  const { customerFeedbackShareUrl, customerFeedbackHasInviteToken } = useMemo(() => {
    const tok =
      getSiteCustomerFeedbackInviteToken(site) || getCustomerFeedbackInviteTokenFromAdminDto(customerFeedback);
    const publicSiteSegment =
      siteWorkflowPathSegment(site) || String(site?.jobCode ?? "").trim() || (site?.id ?? site?.siteId);
    return {
      customerFeedbackShareUrl: buildCustomerFeedbackFrontDoorUrl(publicSiteSegment, tok),
      customerFeedbackHasInviteToken: Boolean(tok),
    };
  }, [site, customerFeedback]);

  const reportWorkflowFailure = useCallback(
    (message, { redirect = false } = {}) => {
      const m = String(message || "").trim() || "Something went wrong.";
      setError(m);
      showError?.(m);
      if (redirect) {
        window.setTimeout(() => {
          onExit?.();
        }, 120);
      }
    },
    [showError, onExit],
  );

  /** Stable for async `loadAll` — avoid re-running initial fetch when parent passes unstable `showError` from context. */
  const reportWorkflowFailureRef = useRef(reportWorkflowFailure);
  reportWorkflowFailureRef.current = reportWorkflowFailure;

  const refreshSiteAttendanceList = useCallback(async () => {
    if (!siteId) return;
    setSiteAttendanceLoading(true);
    setSiteAttendanceError("");
    try {
      const merged = new Map();
      let lastHttpMessage = "";
      for (const status of ["PENDING", "APPROVED", "REJECTED"]) {
        /** Portal marks send siteId only; site jobCode often does not match DB rows and would hide every submission. */
        const qs = buildAdminAttendanceQuery({
          page: 0,
          size: 500,
          status,
          siteId: String(siteId),
          jobCode: "",
          date: "",
          employeeId: "",
        });
        const { res, data } = await adminFetchJson(`${BASE_URL}/api/admin/attendance?${qs}`);
        if (!res.ok) {
          lastHttpMessage = data?.message || res.statusText || `HTTP ${res.status}`;
          continue;
        }
        if (data?.success === false) {
          lastHttpMessage = data?.message || "Request was not successful.";
          continue;
        }
        const { list } = parseAdminAttendancePage(data);
        const fromProp = Number(siteId);
        const fromSite = Number(site?.id ?? site?.siteId);
        const sidNum = Number.isFinite(fromProp) ? fromProp : fromSite;
        const useNumericSiteFilter = Number.isFinite(sidNum);
        for (const row of list) {
          const rowSite = row?.siteId ?? row?.site?.id;
          if (useNumericSiteFilter && rowSite != null && Number(rowSite) !== sidNum) continue;
          const idKey = row?.id ?? row?.attendanceId;
          if (idKey == null || idKey === "") continue;
          merged.set(idKey, row);
        }
      }
      const out = Array.from(merged.values()).sort((a, b) => {
        const da = attendanceRowDateYmd(a);
        const db = attendanceRowDateYmd(b);
        return db.localeCompare(da);
      });
      setSiteAttendanceRecords(out);
      if (out.length === 0 && lastHttpMessage) {
        setSiteAttendanceError(lastHttpMessage);
      }
    } catch (e) {
      setSiteAttendanceRecords([]);
      reportWorkflowFailureRef.current(e?.message || "Failed to load attendance submissions for this site.");
    }
    setSiteAttendanceLoading(false);
  }, [siteId, site]);

  useEffect(() => {
    if (currentStepIndex !== 8 || !siteId) return undefined;
    refreshSiteAttendanceList();
    return undefined;
  }, [currentStepIndex, siteId, refreshSiteAttendanceList]);

  const loadAll = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setError("");
    setEmployeeOptions([]);
    const authHeader = getAuthHeader();
    if (!authHeader) {
      reportWorkflowFailureRef.current("Not authenticated. Returning to dashboard.");
      setLoading(false);
      return;
    }
    try {
      const siteRes = await adminFetchJson(`${adminSitesApiBase(siteId)}`);
      if (!siteRes.res.ok || !siteRes.data?.success) {
        reportWorkflowFailureRef.current(siteRes.data?.message || "Failed to load site.");
        setLoading(false);
        return;
      }
      const sitePayload = siteRes.data.data || {};
      setSite(sitePayload);

      const wizRes = await adminFetchJson(`${adminSitesApiBase(siteId)}/wizard`);
      let parsed = { step: 1, data: { version: WIZARD_VERSION } };
      if (wizRes.res.ok && wizRes.data?.success && wizRes.data.data != null) {
        parsed = parseWizardPayload(wizRes.data.data);
      }
      wizardPersistedStep1Ref.current = Math.min(Math.max(Number(parsed.step) || 1, 1), STEPS.length);
      const merged = { version: WIZARD_VERSION, ...parsed.data };
      if (!merged.projectIntroduction) merged.projectIntroduction = emptyIntroFromSite(sitePayload);
      else {
        merged.projectIntroduction = { ...emptyIntroFromSite(sitePayload), ...merged.projectIntroduction };
      }
      merged.projectIntroduction = normalizeProjectIntroduction(merged.projectIntroduction);
      merged.engineeringProcedure = ensureEngineeringProcedure(
        merged.engineeringProcedure || {},
        merged.projectIntroduction,
        sitePayload,
      );
      merged.toolChecklist = normalizeToolChecklistFromWizard(merged.toolChecklist || {});
      if (isToolChecklistEmptyForAutoSeed(merged.toolChecklist)) {
        merged.toolChecklist = normalizeToolChecklistFromWizard({ categories: getSeededToolChecklistCategories() });
      }
      const certDefaults = {
        recipientName: "Coren Techno Mech",
        projectDescription: "",
        durationFrom: "",
        durationTo: "",
        responsibility1: "",
        responsibility2: "",
        responsibility3: "",
        achievements: "",
        remarks: "",
        completionDate: "",
        signatoryName: "",
        signatoryTitle: "",
        signatoryCompany: "",
      };
      merged.certificateDraft = { ...certDefaults, ...(merged.certificateDraft || {}) };
      merged.teamMovementRegister = normalizeTeamMovementRegister(merged.teamMovementRegister, sitePayload);
      setWizardData(merged);

      const headsRes = await adminFetchJson(`${BASE_URL}/api/meta/challenge-line-heads`);
      const headsFromApi =
        headsRes.res.ok && headsRes.data?.success && Array.isArray(headsRes.data.data) && headsRes.data.data.length > 0
          ? headsRes.data.data
          : CHALLENGE_HEADS_FALLBACK;
      challengeHeadsSnapshotRef.current = headsFromApi;

      const { year: epY, month: epM } = parseYearMonthFromIntroToolsChecklist(merged.projectIntroduction?.toolsChecklistMonth);
      lastEquipmentPortalFetchRef.current = { year: null, month: null };

      const empSeq = ++workflowUserDirectoryLoadSeqRef.current;
      const empPromise = adminFetchJson(
        `${BASE_URL}/api/admin/users?page=0&size=${USER_DIRECTORY_PAGE_SIZE}`,
        userDirectoryFetchInit(),
      );

      const [adv, tech, issues, chall, beh, reg, fb, mach, epRes] = await Promise.all([
        adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/advance-expense-lines`),
        adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/technician-payments`),
        adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/tool-issues`),
        adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/challenge-lines`),
        adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/behaviour-report`),
        adminFetchJson(
          `${adminSitesApiBase(siteId)}/attendance-register?blockIndex=0&daysPerBlock=${DAYS_CHECKLIST}`,
        ),
        adminFetchJson(`${adminSitesApiBase(siteId)}/customer-feedback`),
        adminFetchJson(`${BASE_URL}/api/admin/machinery?siteId=${encodeURIComponent(String(siteId ?? "").trim())}`),
        adminFetchJson(
          `${adminSitesApiBase(siteId)}/job-data/equipment-portal?year=${epY}&month=${epM}`,
        ),
      ]);

      const advArr = Array.isArray(adv.data?.data) ? adv.data.data : [];
      const techArr = Array.isArray(tech.data?.data) ? tech.data.data : [];
      const issArr = Array.isArray(issues.data?.data) ? issues.data.data : [];
      const chArr =
        chall.res.ok && chall.data && adminResponseSuccess(chall.data)
          ? extractChallengeLinesArrayFromResponse(
              Object.prototype.hasOwnProperty.call(chall.data, "data") ? chall.data.data : chall.data,
            )
          : [];
      setAdvanceLines(normalizeAdvanceLines(advArr));
      setTechnicianPaymentLines(
        normalizeTechnicianPaymentLines(mergeTechnicianPaymentLinesByPerson(techArr)),
      );
      setToolIssueLines(normalizeToolIssueLines(issArr));
      setChallengeLineRows(buildChallengeLineWorkflowState(chArr, headsFromApi));

      let br = "{}";
      if (beh.res.ok && beh.data?.success && beh.data.data != null) {
        br = typeof beh.data.data === "string" ? beh.data.data : JSON.stringify(beh.data.data ?? {}, null, 0);
      }
      setBehaviourState(parseBehaviourReport(br));

      if (reg.res.ok && reg.data?.success && reg.data.data) setAttendanceRegister(reg.data.data);
      else setAttendanceRegister(null);

      if (fb.res.ok && adminResponseSuccess(fb.data)) setCustomerFeedback(extractCustomerFeedbackDtoFromAdminResponse(fb.data) ?? null);
      else setCustomerFeedback(null);

      if (mach.res.ok && mach.data?.success && Array.isArray(mach.data.data)) setMachineryList(mach.data.data);
      else setMachineryList([]);

      setEquipmentPortalLoadError("");
      if (epRes.res.ok && epRes.data?.success && epRes.data.data != null) {
        let portal = normalizeEquipmentPortalPayload(epRes.data.data);
        if (portal.year == null || portal.month == null) {
          portal = { ...portal, year: portal.year ?? epY, month: portal.month ?? epM };
        }
        portal = hydrateEquipmentPortalCategoriesWithPaperTemplate(portal);
        setEquipmentPortal(portal);
        lastEquipmentPortalFetchRef.current = { year: epY, month: epM };
      } else {
        setEquipmentPortal(null);
        lastEquipmentPortalFetchRef.current = { year: null, month: null };
        setEquipmentPortalLoadError(epRes.data?.message || "Failed to load equipment portal.");
      }

      const uiStepFromUrl = urlStep1BasedRef.current;
      const serverStep1 = Math.min(Math.max(Number(parsed.step) || 1, 1), STEPS.length);
      const effectiveStep1 =
        uiStepFromUrl != null && Number.isFinite(uiStepFromUrl) && uiStepFromUrl >= 1 && uiStepFromUrl <= STEPS.length
          ? Math.floor(uiStepFromUrl)
          : serverStep1;
      const uiStep = Math.min(Math.max(effectiveStep1 - 1, 0), STEPS.length - 1);
      setCurrentStepIndex(uiStep);
      const urlStep = urlStep1BasedRef.current;
      if (urlStep == null || !Number.isFinite(urlStep) || Math.floor(urlStep) !== effectiveStep1) {
        onStepIndexChangeRef.current?.(uiStep);
      }
      setAttendanceBlock(0);
      setAttendanceDirtyCells(new Map());

      setLoading(false);

      try {
        const emp = await empPromise;
        if (empSeq !== workflowUserDirectoryLoadSeqRef.current) return;
        if (emp.res.ok && emp.data?.success) {
          const root = emp.data.data;
          const rawList = Array.isArray(root?.content) ? root.content : Array.isArray(root) ? root : [];
          const list = [...rawList].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
          setEmployeeOptions(list);
        } else {
          setEmployeeOptions([]);
        }
      } catch {
        if (empSeq === workflowUserDirectoryLoadSeqRef.current) {
          setEmployeeOptions([]);
        }
      }
    } catch (e) {
      workflowUserDirectoryLoadSeqRef.current += 1;
      reportWorkflowFailureRef.current(e?.message || "Failed to load workflow.");
    }
    setLoading(false);
    // Intentionally only [siteId]: callbacks read via refs so unstable `showError`/toast refs do not retrigger this fetch loop.
  }, [siteId]);

  const refreshCustomerFeedback = useCallback(async () => {
    if (!siteId) return;
    if (!getAuthHeader()) return;
    try {
      const fb = await adminFetchJson(`${adminSitesApiBase(siteId)}/customer-feedback`);
      if (fb.res.ok && adminResponseSuccess(fb.data)) setCustomerFeedback(extractCustomerFeedbackDtoFromAdminResponse(fb.data) ?? null);
      else setCustomerFeedback(null);
      const siteRes = await adminFetchJson(`${adminSitesApiBase(siteId)}`);
      if (siteRes.res.ok && siteRes.data?.success && siteRes.data.data) {
        setSite((prev) => ({ ...(prev && typeof prev === "object" ? prev : {}), ...siteRes.data.data }));
      }
    } catch (e) {
      showError?.(e?.message || "Could not refresh customer feedback.");
    }
  }, [siteId, showError]);

  useEffect(() => {
    if (currentStepIndex !== 9 || !siteId) return undefined;
    void refreshCustomerFeedback();
    return undefined;
  }, [currentStepIndex, siteId, refreshCustomerFeedback]);

  const refetchEquipmentPortal = useCallback(async () => {
    if (!siteId) return;
    setEquipmentPortalLoadError("");
    const want = parseYearMonthFromIntroToolsChecklist(wizardDataRef.current?.projectIntroduction?.toolsChecklistMonth);
    const { res, data } = await adminFetchJson(
      `${adminSitesApiBase(siteId)}/job-data/equipment-portal?year=${want.year}&month=${want.month}`,
    );
    if (res.ok && data?.success && data.data != null) {
      let portal = normalizeEquipmentPortalPayload(data.data);
      if (portal.year == null || portal.month == null) {
        portal = { ...portal, year: portal.year ?? want.year, month: portal.month ?? want.month };
      }
      portal = hydrateEquipmentPortalCategoriesWithPaperTemplate(portal);
      setEquipmentPortal(portal);
      lastEquipmentPortalFetchRef.current = { year: want.year, month: want.month };
    } else {
      setEquipmentPortal(null);
      lastEquipmentPortalFetchRef.current = { year: null, month: null };
      setEquipmentPortalLoadError(data?.message || "Failed to load equipment portal.");
    }
  }, [siteId]);

  const applyEquipmentPortalReorderAndSyncLayout = useCallback(
    async (nextPortal) => {
      setEquipmentPortal(nextPortal);
      if (!portalEligibleForLayoutApi(nextPortal)) {
        setToolChecklistActionMessage({
          kind: "info",
          text: 'Rows reordered locally. Use “Save & next” once so new rows/sections receive IDs — then drag-and-drop can save order to the server.',
        });
        return;
      }
      try {
        const body = buildEquipmentLayoutRequestBody(nextPortal);
        const { res, data } = await adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/equipment-portal/layout`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (res.ok && data?.success && data.data != null) {
          let portal = normalizeEquipmentPortalPayload(data.data);
          const y = nextPortal.year;
          const m = nextPortal.month;
          if ((portal.year == null || portal.month == null) && y != null && m != null) {
            portal = { ...portal, year: portal.year ?? y, month: portal.month ?? m };
          }
          setEquipmentPortal(portal);
          setToolChecklistActionMessage({ kind: "success", text: "Tool order saved to the server (layout API)." });
          showSuccess?.("Tool order saved.");
        } else {
          setToolChecklistActionMessage({
            kind: "warning",
            text: data?.message || "Layout save failed — order kept locally until you use Save & next.",
          });
        }
      } catch (e) {
        reportWorkflowFailure(e?.message || "Failed to save tool layout order.");
      }
    },
    [siteId, showSuccess, reportWorkflowFailure],
  );

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (loading) return;
    if (urlStep1Based == null || !Number.isFinite(urlStep1Based)) return;
    const step1 = Math.min(Math.max(Math.floor(urlStep1Based), 1), STEPS.length);
    setCurrentStepIndex(step1 - 1);
  }, [urlStep1Based, loading, siteId]);

  useEffect(() => {
    if (currentStepIndex !== 2 || !siteId || loading) return undefined;
    const want = parseYearMonthFromIntroToolsChecklist(wizardDataRef.current?.projectIntroduction?.toolsChecklistMonth);
    if (
      lastEquipmentPortalFetchRef.current.year === want.year &&
      lastEquipmentPortalFetchRef.current.month === want.month
    ) {
      return undefined;
    }
    let cancelled = false;
    (async () => {
      const { res, data } = await adminFetchJson(
        `${adminSitesApiBase(siteId)}/job-data/equipment-portal?year=${want.year}&month=${want.month}`,
      );
      if (cancelled) return;
      setEquipmentPortalLoadError("");
      if (res.ok && data?.success && data.data != null) {
        let portal = normalizeEquipmentPortalPayload(data.data);
        if (portal.year == null || portal.month == null) {
          portal = { ...portal, year: portal.year ?? want.year, month: portal.month ?? want.month };
        }
        portal = hydrateEquipmentPortalCategoriesWithPaperTemplate(portal);
        setEquipmentPortal(portal);
        lastEquipmentPortalFetchRef.current = { year: want.year, month: want.month };
      } else {
        setEquipmentPortal(null);
        lastEquipmentPortalFetchRef.current = { year: null, month: null };
        setEquipmentPortalLoadError(data?.message || "Failed to load equipment portal.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentStepIndex, wizardData.projectIntroduction?.toolsChecklistMonth, siteId, loading]);

  /** Paper template when the portal has no sections yet (covers SW-cached bundles or missed hydrate on fetch). */
  useLayoutEffect(() => {
    if (currentStepIndex !== 2) return;
    if (!equipmentPortal || equipmentPortalLoadError) return;
    const cats = equipmentPortal.categories;
    if (!Array.isArray(cats) || cats.length === 0) {
      const next = hydrateEquipmentPortalCategoriesWithPaperTemplate(equipmentPortal);
      if (Array.isArray(next.categories) && next.categories.length > 0) {
        setEquipmentPortal(next);
      }
    }
  }, [currentStepIndex, equipmentPortal, equipmentPortalLoadError]);

  useEffect(() => {
    if (!toolChecklistActionMessage.text) return undefined;
    const id = window.setTimeout(() => setToolChecklistActionMessage({ kind: "", text: "" }), 12000);
    return () => window.clearTimeout(id);
  }, [toolChecklistActionMessage.text]);

  useEffect(() => {
    if (addCategoryOpen && addCategoryInputRef.current) {
      addCategoryInputRef.current.focus();
    }
  }, [addCategoryOpen]);

  useEffect(() => {
    if (currentStepIndex !== 2) {
      setAddCategoryOpen(false);
      setAddCategoryName("");
      setToolChecklistActionMessage({ kind: "", text: "" });
    }
  }, [currentStepIndex]);

  const persistWizard = useCallback(async (nextStep1Based, dataSnapshot, options = {}) => {
    const { applyServerResponse = true } = options;
    const snapshot = dataSnapshot ?? wizardDataRef.current;
    const body = {
      step: nextStep1Based,
      data: { ...snapshot },
    };
    const { res, data } = await adminFetchJson(`${adminSitesApiBase(siteId)}/wizard`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || data?.success === false) throw new Error(data?.message || "Failed to save wizard.");
    if (applyServerResponse) {
      if (data?.data != null) {
        const parsed = parseWizardPayload(data.data);
        setWizardData((prev) => ({ ...prev, ...parsed.data }));
      } else {
        setWizardData(body.data);
      }
    }
    return true;
  }, [siteId]);

  const executeStepSave = useCallback(
    async ({ advance, silent }) => {
      const s = saveCtxRef.current;
      const ci = s.currentStepIndex ?? 0;
      const nextIdx = advance ? Math.min(ci + 1, STEPS.length - 1) : ci;
      const persistedStep1 = Math.min(Math.max(Number(wizardPersistedStep1Ref.current) || 1, 1), STEPS.length);
      const uiStep1 = Math.min(Math.max(ci + 1, 1), STEPS.length);
      /** Never send a wizard `step` below the tab being saved (fixes later tabs not persisting when ref lagged). */
      const wizardStep1ForPut = advance ? nextIdx + 1 : Math.max(persistedStep1, uiStep1);

      /** One-call save for autosave / tab switch; falls back to per-endpoint PUTs if batch route is absent (404/405). */
      if (silent) {
        const wizardSnap =
          ci === 4
            ? {
                ...wizardDataRef.current,
                teamMovementRegister: normalizeTeamMovementRegister(wizardDataRef.current.teamMovementRegister, s.site),
              }
            : wizardDataRef.current;
        const batchBody = buildWorkflowBatchRequestBody(ci, s, wizardStep1ForPut, wizardSnap);
        const { res, data } = await adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/workflow-batch`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(batchBody),
        });
        /** Fall back to legacy PUTs if batch is missing, rejects the body, or returns an error (e.g. wizard shape mismatch). */
        const batchOk = res.ok && data?.success !== false;
        if (batchOk) {
          if (ci === 3) {
            const techPayload = normalizeTechnicianPaymentLines(mergeTechnicianPaymentLinesByPerson(s.technicianPaymentLines || []));
            setTechnicianPaymentLines(techPayload);
          }
          if (ci === 4) {
            setWizardData(wizardSnap);
          }
          if (ci === 6) {
            try {
              const r = await adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/challenge-lines`);
              if (r.res.ok && r.data && adminResponseSuccess(r.data)) {
                const inner = Object.prototype.hasOwnProperty.call(r.data, "data") ? r.data.data : r.data;
                const chArr = extractChallengeLinesArrayFromResponse(inner);
                setChallengeLineRows(buildChallengeLineWorkflowState(chArr, challengeHeadsSnapshotRef.current));
              }
            } catch {
              /* keep in-memory rows if refetch fails */
            }
          }
          if (ci === 8) {
            let cellCount = 0;
            const dirty = s.attendanceDirtyCells;
            if (dirty && typeof dirty.forEach === "function") {
              dirty.forEach((code, key) => {
                const [employeeUserId, date] = String(key).split("|");
                if (employeeUserId && date && code) cellCount += 1;
              });
            }
            setAttendanceDirtyCells(new Map());
            if (advance || cellCount > 0) {
              const regRes = await adminFetchJson(
                `${adminSitesApiBase(siteId)}/attendance-register?blockIndex=${s.attendanceBlock}&daysPerBlock=${DAYS_CHECKLIST}`,
              );
              if (!regRes.res.ok || !regRes.data?.success) {
                throw new Error(regRes.data?.message || "Could not reload attendance register after save.");
              }
              setAttendanceRegister(regRes.data.data);
            }
          }
          if (advance) {
            wizardPersistedStep1Ref.current = wizardStep1ForPut;
            setCurrentStepIndex(nextIdx);
            onStepIndexChangeRef.current?.(nextIdx);
          } else {
            wizardPersistedStep1Ref.current = wizardStep1ForPut;
          }
          return;
        }
      }

      if (ci <= 1) {
        await persistWizard(wizardStep1ForPut, wizardDataRef.current, { applyServerResponse: !silent });
      } else if (ci === 2) {
        const portal = s.equipmentPortal;
        if (!portal) {
          if (advance) throw new Error("Equipment checklist not loaded yet.");
          await persistWizard(wizardStep1ForPut, wizardDataRef.current, { applyServerResponse: !silent });
          return;
        }
        const putBody = buildEquipmentPortalPutBody(portal);
        const { res, data } = await adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/equipment-portal`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(putBody),
        });
        if (!res.ok || data?.success === false) throw new Error(data?.message || "Failed to save equipment portal.");
        if (data?.data != null && !silent) {
          let next = normalizeEquipmentPortalPayload(data.data);
          // Keep month context if the server response omits year/month (PUT body still had availabilityYear/Month).
          if (
            (next.year == null || next.month == null) &&
            portal.year != null &&
            portal.month != null &&
            Number.isFinite(Number(portal.year)) &&
            Number.isFinite(Number(portal.month))
          ) {
            next = { ...next, year: next.year ?? Number(portal.year), month: next.month ?? Number(portal.month) };
          }
          setEquipmentPortal(next);
          if (next.year != null && next.month != null) {
            lastEquipmentPortalFetchRef.current = { year: next.year, month: next.month };
          }
        }
        await persistWizard(wizardStep1ForPut, wizardDataRef.current, { applyServerResponse: !silent });
      } else if (ci === 3) {
        const advPayload = s.advanceLines;
        if (!Array.isArray(advPayload)) throw new Error("Advance lines invalid.");
        if (!Array.isArray(s.technicianPaymentLines)) throw new Error("Technician payments invalid.");
        const techPayload = normalizeTechnicianPaymentLines(mergeTechnicianPaymentLinesByPerson(s.technicianPaymentLines));
        const { res: r1, data: d1 } = await adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/advance-expense-lines`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(advPayload),
        });
        if (!r1.ok || d1?.success === false) throw new Error(d1?.message || "Failed to save advance lines.");
        const { res: r2, data: d2 } = await adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/technician-payments`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(techPayload),
        });
        if (!r2.ok || d2?.success === false) throw new Error(d2?.message || "Failed to save technician payments.");
        setTechnicianPaymentLines(techPayload);
        await persistWizard(wizardStep1ForPut, wizardDataRef.current, { applyServerResponse: !silent });
      } else if (ci === 4) {
        const snapshot = {
          ...wizardDataRef.current,
          teamMovementRegister: normalizeTeamMovementRegister(wizardDataRef.current.teamMovementRegister, s.site),
        };
        await persistWizard(wizardStep1ForPut, snapshot, { applyServerResponse: !silent });
        setWizardData(snapshot);
      } else if (ci === 5) {
        const issuesPayload = s.toolIssueLines;
        if (!Array.isArray(issuesPayload)) throw new Error("Tool issues invalid.");
        const { res, data } = await adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/tool-issues`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(issuesPayload),
        });
        if (!res.ok || data?.success === false) throw new Error(data?.message || "Failed to save tool issues.");
        await persistWizard(wizardStep1ForPut, wizardDataRef.current, { applyServerResponse: !silent });
      } else if (ci === 6) {
        const challPayload = s.challengeLineRows.map(stripChallengeLineForApi);
        if (!Array.isArray(challPayload)) throw new Error("Challenge lines invalid.");
        const { res, data } = await adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/challenge-lines`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(challPayload),
        });
        if (!res.ok || data?.success === false) throw new Error(data?.message || "Failed to save challenges.");
        await persistWizard(wizardStep1ForPut, wizardDataRef.current, { applyServerResponse: !silent });
      } else if (ci === 7) {
        const parsedBr = serializeBehaviourReport(s.behaviourState);
        const { res, data } = await adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/behaviour-report`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsedBr),
        });
        if (!res.ok || data?.success === false) throw new Error(data?.message || "Failed to save behaviour report.");
        await persistWizard(wizardStep1ForPut, wizardDataRef.current, { applyServerResponse: !silent });
      } else if (ci === 8) {
        const cells = [];
        const dirty = s.attendanceDirtyCells;
        if (dirty && typeof dirty.forEach === "function") {
          dirty.forEach((code, key) => {
            const [employeeUserId, date] = String(key).split("|");
            if (!employeeUserId || !date || !code) return;
            cells.push({ employeeUserId: Number(employeeUserId), date, code });
          });
        }
        if (cells.length > 0) {
          const { res, data } = await adminFetchJson(`${adminSitesApiBase(siteId)}/job-data/attendance-register-cells`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cells }),
          });
          if (!res.ok || data?.success === false) throw new Error(data?.message || "Failed to save attendance cells.");
        }
        setAttendanceDirtyCells(new Map());
        await persistWizard(wizardStep1ForPut, wizardDataRef.current, { applyServerResponse: !silent });
        if (advance || cells.length > 0) {
          const regRes = await adminFetchJson(
            `${adminSitesApiBase(siteId)}/attendance-register?blockIndex=${s.attendanceBlock}&daysPerBlock=${DAYS_CHECKLIST}`,
          );
          if (!regRes.res.ok || !regRes.data?.success) {
            throw new Error(regRes.data?.message || "Could not reload attendance register after save.");
          }
          setAttendanceRegister(regRes.data.data);
        }
      } else {
        await persistWizard(wizardStep1ForPut, wizardDataRef.current, { applyServerResponse: !silent });
      }

      if (advance) {
        wizardPersistedStep1Ref.current = wizardStep1ForPut;
        setCurrentStepIndex(nextIdx);
        onStepIndexChangeRef.current?.(nextIdx);
        if (!silent) showSuccessRef.current?.("Saved.");
      } else {
        wizardPersistedStep1Ref.current = wizardStep1ForPut;
      }
    },
    [siteId, persistWizard],
  );

  /** Persist the current step before switching tabs or going back, so edits are not lost. */
  const goToWorkflowStep = useCallback(
    async (targetIndex0) => {
      if (targetIndex0 === currentStepIndexRef.current) return;
      if (loading) return;
      setSaving(true);
      setError("");
      try {
        await executeStepSave({ advance: false, silent: true });
        setCurrentStepIndex(targetIndex0);
        onStepIndexChangeRef.current?.(targetIndex0);
      } catch (e) {
        reportWorkflowFailure(e?.message || "Could not save this step before switching away. Fix errors or use Save & next, then try again.");
      } finally {
        setSaving(false);
      }
    },
    [loading, executeStepSave, reportWorkflowFailure],
  );

  const handleSiteAttendanceApprove = useCallback(
    async (attendanceId) => {
      if (!attendanceId) return;
      setSiteAttendanceError("");
      setSiteAttActionId(attendanceId);
      try {
        const { res, data } = await adminFetchJson(`${BASE_URL}/api/admin/attendance/${attendanceId}/approve`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "APPROVED", rejectionReason: null }),
        });
        if (!res.ok || data?.success === false) throw new Error(data?.message || "Failed to approve.");
        showSuccess?.("Attendance approved.");
        await refreshSiteAttendanceList();
      } catch (e) {
        reportWorkflowFailure(e?.message || "Failed to approve attendance.");
      }
      setSiteAttActionId(null);
    },
    [refreshSiteAttendanceList, showSuccess, reportWorkflowFailure],
  );

  const handleSiteAttendanceRejectSubmit = useCallback(async () => {
    if (!siteAttRejectId) return;
    const id = siteAttRejectId;
    const reason = siteAttRejectReason.trim();
    setSiteAttendanceError("");
    setSiteAttActionId(id);
    try {
      const { res, data } = await adminFetchJson(`${BASE_URL}/api/admin/attendance/${id}/approve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "REJECTED",
          rejectionReason: reason || null,
        }),
      });
      if (!res.ok || data?.success === false) throw new Error(data?.message || "Failed to reject.");
      showSuccess?.("Attendance rejected.");
      setSiteAttRejectId(null);
      setSiteAttRejectReason("");
      await refreshSiteAttendanceList();
    } catch (e) {
      reportWorkflowFailure(e?.message || "Failed to reject attendance.");
    }
    setSiteAttActionId(null);
  }, [siteAttRejectId, siteAttRejectReason, refreshSiteAttendanceList, showSuccess, reportWorkflowFailure]);

  const handleNext = async () => {
    setSaving(true);
    setError("");
    try {
      await executeStepSave({ advance: true, silent: false });
    } catch (e) {
      reportWorkflowFailure(e?.message || "Save failed. Nothing was saved for this step.");
    } finally {
      setSaving(false);
    }
  };

  useEffect(() => {
    if (!autosaveEnabled || loading || saving || !siteId || !getAuthHeader()) {
      return undefined;
    }
    const id = window.setTimeout(() => {
      if (autosaveRunningRef.current) return;
      autosaveRunningRef.current = true;
      setAutosaveStatus("Saving…");
      void (async () => {
        try {
          await executeStepSave({ advance: false, silent: true });
          const t = new Date().toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          setAutosaveStatus(`Autosaved at ${t}`);
        } catch (e) {
          const msg = e?.message || "Autosave failed";
          setAutosaveStatus(msg);
          showErrorRef.current?.(msg);
        } finally {
          autosaveRunningRef.current = false;
        }
      })();
    }, 4000);
    return () => window.clearTimeout(id);
  }, [
    autosaveEnabled,
    loading,
    saving,
    siteId,
    currentStepIndex,
    wizardData,
    equipmentPortal,
    advanceLines,
    technicianPaymentLines,
    toolIssueLines,
    challengeLineRows,
    behaviourState,
    attendanceDirtyCells,
    attendanceBlock,
    site,
    executeStepSave,
  ]);

  /** Snapshot used by Save / tab-switch / autosave — must run before any early return (Rules of Hooks). */
  useLayoutEffect(() => {
    saveCtxRef.current = {
      currentStepIndex,
      equipmentPortal,
      advanceLines,
      technicianPaymentLines,
      toolIssueLines,
      challengeLineRows,
      behaviourState,
      attendanceDirtyCells,
      attendanceBlock,
      site,
    };
  }, [
    currentStepIndex,
    equipmentPortal,
    advanceLines,
    technicianPaymentLines,
    toolIssueLines,
    challengeLineRows,
    behaviourState,
    attendanceDirtyCells,
    attendanceBlock,
    site,
  ]);

  const handleBack = async () => {
    const n = Math.max(0, currentStepIndexRef.current - 1);
    if (n === currentStepIndexRef.current) return;
    if (loading) return;
    setSaving(true);
    setError("");
    try {
      await executeStepSave({ advance: false, silent: true });
      setCurrentStepIndex(n);
      onStepIndexChangeRef.current?.(n);
    } catch (e) {
      reportWorkflowFailure(e?.message || "Could not save before going to the previous step.");
    } finally {
      setSaving(false);
    }
  };

  const reloadAttendanceBlock = async (block) => {
    try {
      const { res, data } = await adminFetchJson(
        `${adminSitesApiBase(siteId)}/attendance-register?blockIndex=${block}&daysPerBlock=${DAYS_CHECKLIST}`,
      );
      if (res.ok && data?.success) {
        setAttendanceRegister(data.data);
        setAttendanceBlock(block);
        setAttendanceDirtyCells(new Map());
      } else {
        showError?.(data?.message || "Could not load this attendance block.");
      }
    } catch (e) {
      showError?.(e?.message || "Could not load this attendance block.");
    }
  };

  const updateWizard = (patch) => {
    setWizardData((prev) => ({ ...prev, ...patch }));
  };

  const customerFeedbackParsed = useMemo(() => {
    const merged = mergeSiteAndEndpointCustomerFeedbackForAdmin(site, customerFeedback);
    return merged ? parseCustomerFeedbackRecord(merged) : null;
  }, [site, customerFeedback]);

  const teamMovementRegister = useMemo(
    () => normalizeTeamMovementRegister(wizardData.teamMovementRegister, site),
    [wizardData.teamMovementRegister, site],
  );

  const patchTeamMovement = useCallback(
    (partial) => {
      setWizardData((prev) => ({
        ...prev,
        teamMovementRegister: normalizeTeamMovementRegister(
          { ...normalizeTeamMovementRegister(prev.teamMovementRegister, site), ...partial },
          site,
        ),
      }));
    },
    [site],
  );

  const patchTeamMovementRow = useCallback(
    (rowIndex, partial) => {
      setWizardData((prev) => {
        const cur = normalizeTeamMovementRegister(prev.teamMovementRegister, site);
        const rows = [...cur.rows];
        if (rowIndex < 0 || rowIndex >= rows.length) return prev;
        rows[rowIndex] = { ...rows[rowIndex], ...partial };
        return { ...prev, teamMovementRegister: normalizeTeamMovementRegister({ ...cur, rows }, site) };
      });
    },
    [site],
  );

  if (loading) {
    return (
      <section className="dashboard-section site-job-workflow">
        <p className="text-muted mb-0">Loading site job workflow…</p>
      </section>
    );
  }

  if (!site) {
    return (
      <section className="dashboard-section site-job-workflow">
        <div className="alert alert-danger py-2">{error || "Site not found."}</div>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={onExit}>
          Back to dashboard
        </button>
      </section>
    );
  }

  const intro = wizardData.projectIntroduction || emptyIntroFromSite(site);
  const eng = wizardData.engineeringProcedure || {};
  const cert = wizardData.certificateDraft || {};

  const introPeRows = intro.proposedEquipment || [];
  const wfIntroPe = workflowTableFilters.intro_pe || { search: "", cols: {} };
  const introPeIdx = filterRowIndices(introPeRows, wfIntroPe, [(r) => r.text], { text: (r) => r.text });

  const introDimRows = intro.dimensionalRows || [];
  const wfIntroDim = workflowTableFilters.intro_dim || { search: "", cols: {} };
  const introDimIdx = filterRowIndices(introDimRows, wfIntroDim, [(r) => r.activity, (r) => r.dimensions, (r) => r.description], {
    activity: (r) => r.activity,
    dimensions: (r) => r.dimensions,
    description: (r) => r.description,
  });

  const introMobRows = intro.mobilization || [];
  const wfIntroMob = workflowTableFilters.intro_mob || { search: "", cols: {} };
  const introMobIdx = filterRowIndices(introMobRows, wfIntroMob, [(r) => r.activity, (r) => r.date], {
    activity: (r) => r.activity,
    date: (r) => r.date,
  });

  const introTmRows = intro.teamMembers || [];
  const wfIntroTm = workflowTableFilters.intro_team || { search: "", cols: {} };
  const introTmIdx = filterRowIndices(introTmRows, wfIntroTm, [(r) => r.name], { name: (r) => String(r.name ?? "").trim() });

  const engRowsList = eng.rows || [];
  const wfEng = workflowTableFilters.eng_schedule || { search: "", cols: {} };
  const engIdx = filterRowIndices(
    engRowsList,
    wfEng,
    [(r) => r.activity, (r) => r.day, (r) => r.targetTime, (r) => r.actualTime, (r) => r.reasonDelay],
    {
      activity: (r) => r.activity,
      day: (r) => r.day,
      targetTime: (r) => r.targetTime,
      actualTime: (r) => r.actualTime,
      reasonDelay: (r) => r.reasonDelay,
    },
  );

  const ADVANCE_FILTER_FIELDS = [
    "dateAdvanceReceived",
    "openingBalance",
    "amount",
    "foodAllow",
    "conveyance",
    "medical",
    "additionalManpower",
    "welding",
    "siteExpenses",
    "balanceInHand",
    "dispersionDetails",
  ];
  const wfAdv = workflowTableFilters.expense_advance || { search: "", cols: {} };
  const advMatchers = Object.fromEntries(ADVANCE_FILTER_FIELDS.map((k) => [k, (r) => String(r[k] ?? "").trim()]));
  const advSearchFns = ADVANCE_FILTER_FIELDS.map((k) => (r) => r[k]);
  const advIdx = filterRowIndices(advanceLines, wfAdv, advSearchFns, advMatchers);

  const wfTech = workflowTableFilters.expense_technician || { search: "", cols: {} };
  const techColMatchers = {
    technicianName: (r) => String(r.technicianName ?? "").trim(),
    totalPayment: (r) => String(sumTechnicianPaymentAmounts(r.payments) ?? "").trim(),
  };
  const techSearchFns = [
    (r) => r.technicianName,
    (r) => sumTechnicianPaymentAmounts(r.payments),
    ...Array.from({ length: TECHNICIAN_PAYMENT_SLOTS }, (_, pi) => [(r) => r.payments?.[pi]?.date, (r) => r.payments?.[pi]?.amount]).flat(2),
  ];
  for (let pi = 0; pi < TECHNICIAN_PAYMENT_SLOTS; pi += 1) {
    techColMatchers[`pay${pi}_date`] = (r) => String(r.payments?.[pi]?.date ?? "").trim();
    techColMatchers[`pay${pi}_amount`] = (r) => String(r.payments?.[pi]?.amount ?? "").trim();
  }
  const techIdx = filterRowIndices(technicianPaymentLines, wfTech, techSearchFns, techColMatchers);

  const ADVANCE_FILTER_LABELS = {
    dateAdvanceReceived: "Adv. date",
    openingBalance: "Open bal.",
    amount: "Amount",
    foodAllow: "Food",
    conveyance: "Convey.",
    medical: "Medical",
    additionalManpower: "Add. manp.",
    welding: "Welding",
    siteExpenses: "Site exp.",
    balanceInHand: "Bal.",
    dispersionDetails: "Notes",
  };
  const advanceColumnSpec = ADVANCE_FILTER_FIELDS.map((k) => ({
    key: k,
    label: ADVANCE_FILTER_LABELS[k] || k,
    options: wfDistinctValues(advanceLines, (r) => r[k]),
  }));
  const techColumnSpec = [
    { key: "technicianName", label: "Technician", options: wfDistinctValues(technicianPaymentLines, (r) => r.technicianName) },
    { key: "totalPayment", label: "Total", options: wfDistinctValues(technicianPaymentLines, (r) => sumTechnicianPaymentAmounts(r.payments)) },
    ...Array.from({ length: TECHNICIAN_PAYMENT_SLOTS }, (_, pi) => [
      {
        key: `pay${pi}_date`,
        label: `Pay ${pi + 1} date`,
        options: wfDistinctValues(technicianPaymentLines, (r) => r.payments?.[pi]?.date),
      },
      {
        key: `pay${pi}_amount`,
        label: `Pay ${pi + 1} amt`,
        options: wfDistinctValues(technicianPaymentLines, (r) => r.payments?.[pi]?.amount),
      },
    ]).flat(),
  ];

  const wfToolIssues = workflowTableFilters.tool_issues || { search: "", cols: {} };
  const toolIssueMatchers = {
    packingListSlNo: (r) => String(r.packingListSlNo ?? "").trim(),
    itemDescription: (r) => String(r.itemDescription ?? "").trim(),
    missingDate: (r) => String(r.missingDate ?? "").trim(),
    damageDate: (r) => String(r.damageDate ?? "").trim(),
    repairDate: (r) => String(r.repairDate ?? "").trim(),
    handledBy: (r) => String(r.handledBy ?? "").trim(),
    issueDescription: (r) => String(r.issueDescription ?? "").trim(),
  };
  const toolIssueSearchFns = Object.values(toolIssueMatchers);
  const toolIssueIdx = filterRowIndices(toolIssueLines, wfToolIssues, toolIssueSearchFns, toolIssueMatchers);

  const toolIssueColumnSpec = [
    { key: "packingListSlNo", label: "Pkg Sl.", options: wfDistinctValues(toolIssueLines, (r) => r.packingListSlNo) },
    { key: "itemDescription", label: "Item", options: wfDistinctValues(toolIssueLines, (r) => r.itemDescription) },
    { key: "missingDate", label: "Missing", options: wfDistinctValues(toolIssueLines, (r) => r.missingDate) },
    { key: "damageDate", label: "Damage", options: wfDistinctValues(toolIssueLines, (r) => r.damageDate) },
    { key: "repairDate", label: "Repair", options: wfDistinctValues(toolIssueLines, (r) => r.repairDate) },
    { key: "handledBy", label: "Handled by", options: wfDistinctValues(toolIssueLines, (r) => r.handledBy) },
    { key: "issueDescription", label: "Issue", options: wfDistinctValues(toolIssueLines, (r) => r.issueDescription) },
  ];

  const wfChallenges = workflowTableFilters.challenge_lines || { search: "", cols: {} };
  const chMatchers = {
    headLabel: (r) => String(r.headLabel ?? "").trim(),
    dateOfIncident: (r) => String(r.dateOfIncident ?? "").trim(),
    involved: (r) => String(r.involved ?? "").trim(),
    challengesFaced: (r) => String(r.challengesFaced ?? "").trim(),
    resolutionStatus: (r) => String(r.resolutionStatus ?? "").trim(),
  };
  const challengeIdx = filterRowIndices(challengeLineRows, wfChallenges, Object.values(chMatchers), chMatchers);

  const challengeColumnSpec = [
    { key: "headLabel", label: "Head", options: wfDistinctValues(challengeLineRows, (r) => r.headLabel) },
    { key: "dateOfIncident", label: "Incident date", options: wfDistinctValues(challengeLineRows, (r) => r.dateOfIncident) },
    { key: "involved", label: "Involved", options: wfDistinctValues(challengeLineRows, (r) => r.involved) },
    { key: "challengesFaced", label: "Challenges", options: wfDistinctValues(challengeLineRows, (r) => r.challengesFaced) },
    { key: "resolutionStatus", label: "Resolution", options: wfDistinctValues(challengeLineRows, (r) => r.resolutionStatus) },
  ];

  const wfBehaviour = workflowTableFilters.behaviour_matrix || { search: "", cols: {} };
  const behaviourIssueIdx = BEHAVIOUR_ISSUE_ROWS.map((_, i) => i).filter((i) => behaviourIssueRowMatchesFilters(i, behaviourState, wfBehaviour));

  const behaviourMemberFilterSpec = behaviourState.members.map((_, mi) => ({
    key: `m${mi}`,
    label: `Member ${mi + 1}`,
    options: [...BEHAVIOUR_CELL_FILTER_OPTS],
  }));

  const attRegRows = attendanceRegister?.rows || [];
  const wfAttReg = workflowTableFilters.attendance_register || { search: "", cols: {} };
  const attRegIdx = filterRowIndices(
    attRegRows,
    wfAttReg,
    [(r) => [r.employeeName, ...((r.dayCodes || []).map((c) => c ?? ""))].join("\t")],
    { employeeName: (r) => String(r.employeeName ?? "").trim() },
  );

  const attRegColumnSpec = [
    { key: "employeeName", label: "Name", options: wfDistinctValues(attRegRows, (r) => r.employeeName) },
  ];

  const wfSiteAttPortal = workflowTableFilters.site_att_portal || { search: "", cols: {} };

  return (
    <section className="dashboard-section site-job-workflow">
      <nav className="site-job-workflow__breadcrumb" aria-label="Breadcrumb">
        <button type="button" className="site-job-workflow__crumb site-job-workflow__crumb--btn" onClick={onExit}>
          Admin home
        </button>
        <span className="site-job-workflow__crumb-sep" aria-hidden>
          /
        </span>
        {typeof onNavigateSitesList === "function" ? (
          <button type="button" className="site-job-workflow__crumb site-job-workflow__crumb--btn" onClick={onNavigateSitesList}>
            Sites
          </button>
        ) : (
          <span className="site-job-workflow__crumb">Sites</span>
        )}
        <span className="site-job-workflow__crumb-sep" aria-hidden>
          /
        </span>
        <span className="site-job-workflow__crumb site-job-workflow__crumb--current">{site.name}</span>
        <span className="site-job-workflow__crumb-sep" aria-hidden>
          /
        </span>
        <span className="site-job-workflow__crumb site-job-workflow__crumb--current">Site job workflow</span>
      </nav>

      <div className="site-job-workflow__shell-card site-job-workflow__panel border rounded-3 shadow-sm">
        <div className="site-job-workflow__shell-meta">
          <div className="min-w-0">
            <h2 className="site-job-workflow__shell-title mb-1">Site job workflow</h2>
            <p className="site-job-workflow__muted mb-0 small text-truncate" title={site.name}>
              {site.name}
              {site.jobCode ? ` · ${site.jobCode}` : ""} · Step {currentStepIndex + 1} of {STEPS.length}
            </p>
          </div>
          <div className="d-flex flex-wrap align-items-start gap-3 flex-shrink-0 ms-auto">
            <div className="d-flex flex-column align-items-end gap-1">
              <label className="d-flex align-items-center gap-2 small text-nowrap mb-0 user-select-none">
                <input
                  type="checkbox"
                  className="form-check-input mt-0"
                  checked={autosaveEnabled}
                  onChange={(e) => {
                    const on = e.target.checked;
                    setAutosaveEnabled(on);
                    try {
                      localStorage.setItem(AUTOSAVE_LS_KEY, on ? "1" : "0");
                    } catch {
                      /* ignore */
                    }
                    if (!on) setAutosaveStatus("");
                  }}
                />
                Autosave draft (~4s)
              </label>
              {autosaveEnabled && autosaveStatus ? (
                <span className="small text-muted text-end" style={{ maxWidth: 240 }} title={autosaveStatus}>
                  {autosaveStatus}
                </span>
              ) : null}
            </div>
            <div className="site-job-workflow__job-box site-job-workflow__job-box--shell flex-shrink-0" title="Job code">
              <div className="small text-muted">JOB CODE</div>
              <div>{site.jobCode ?? "—"}</div>
            </div>
          </div>
        </div>

        <div className="site-job-workflow__tab-scroll-wrap">
          <button
            type="button"
            className="site-job-workflow__tab-scroll-btn"
            aria-label="Scroll steps left"
            onClick={() => primaryTabsRef.current?.scrollBy({ left: -220, behavior: "smooth" })}
          >
            ‹
          </button>
          <div ref={primaryTabsRef} className="site-job-workflow__primary-tabs" role="tablist" aria-label="Workflow steps">
            {STEPS.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="tab"
                aria-selected={i === currentStepIndex}
                className={`site-job-workflow__primary-tab ${i === currentStepIndex ? "site-job-workflow__primary-tab--active" : ""} ${
                  i < currentStepIndex ? "site-job-workflow__primary-tab--done" : ""
                }`}
                title={`Step ${i + 1}: ${s.title}`}
                disabled={saving || loading}
                onClick={() => {
                  void goToWorkflowStep(i);
                }}
              >
                <span className="site-job-workflow__primary-tab-num">{i + 1}</span>
                <span className="site-job-workflow__primary-tab-label">{s.title}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="site-job-workflow__tab-scroll-btn"
            aria-label="Scroll steps right"
            onClick={() => primaryTabsRef.current?.scrollBy({ left: 220, behavior: "smooth" })}
          >
            ›
          </button>
        </div>

        {error ? <div className="alert alert-danger py-2 mb-0 mx-3 mt-2">{error}</div> : null}

        <div className="site-job-workflow__step-panel site-job-workflow__step-panel--padded">
          <button
            type="button"
            className="site-job-workflow__section-bar site-job-workflow__section-bar--page"
            onClick={() => setStepShellCollapsed((c) => !c)}
            aria-expanded={!stepShellCollapsed}
          >
            <span>
              Step {currentStepIndex + 1}: {STEPS[currentStepIndex].title}
            </span>
            <span className="site-job-workflow__section-bar-chevron" aria-hidden>
              {stepShellCollapsed ? "▼" : "▲"}
            </span>
          </button>

          {!stepShellCollapsed ? (
            <>
      {currentStepIndex === 0 && (
        <div>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Project introduction</div>
          <table className="site-job-workflow__paper-table">
            <tbody>
              <tr>
                <th>Name of the Client</th>
                <td colSpan={3}>
                  <input
                    value={intro.clientName}
                    onChange={(e) =>
                      updateWizard({ projectIntroduction: { ...intro, clientName: e.target.value } })
                    }
                  />
                </td>
              </tr>
              <tr>
                <th>Site location</th>
                <td colSpan={3}>
                  <input
                    value={intro.siteLocation}
                    onChange={(e) =>
                      updateWizard({ projectIntroduction: { ...intro, siteLocation: e.target.value } })
                    }
                  />
                </td>
              </tr>
              <tr>
                <th>Job code</th>
                <td>{site.jobCode ?? "—"}</td>
                <th>Scheduled days</th>
                <td>
                  <input
                    value={intro.scheduledDays}
                    onChange={(e) => {
                      const v = e.target.value;
                      const nextIntro = { ...intro, scheduledDays: v };
                      updateWizard({
                        projectIntroduction: nextIntro,
                        engineeringProcedure: ensureEngineeringProcedure(eng, nextIntro, site),
                      });
                    }}
                  />
                </td>
              </tr>
              <tr>
                <th>Tools checklist month</th>
                <td colSpan={3}>
                  <input
                    type="month"
                    className="form-control form-control-sm d-inline-block align-middle"
                    style={{ maxWidth: "11rem" }}
                    value={intro.toolsChecklistMonth ?? ""}
                    onChange={(e) =>
                      updateWizard({ projectIntroduction: { ...intro, toolsChecklistMonth: e.target.value } })
                    }
                  />
                  <span className="site-job-workflow__muted small ms-2 d-inline-block align-middle">
                    Heading for day columns on the tools checklist. Leave blank to use the current calendar month.
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Proposed equipment</div>
          <WorkflowSearchFilterShell
            drawerTitle="Proposed equipment"
            search={wfIntroPe.search}
            onSearchChange={(v) => patchWfFilter("intro_pe", { search: v })}
            columnSpec={[{ key: "text", label: "Description", options: wfDistinctValues(introPeRows, (r) => r.text) }]}
            cols={wfIntroPe.cols || {}}
            onApplyColumnFilters={(c) => patchWfFilter("intro_pe", { cols: c, replaceCols: true })}
          />
          <div className="site-job-workflow__scroll">
            <table className="site-job-workflow__paper-table site-job-workflow__stack-mobile">
              <thead>
                <tr>
                  <th style={{ width: "3rem" }}>Sl.</th>
                  <th>Description</th>
                  <th style={{ width: "5.5rem" }} className="text-center">
                    Remove
                  </th>
                </tr>
              </thead>
              <tbody>
                {introPeIdx.map((idx) => {
                  const row = introPeRows[idx];
                  return (
                  <tr key={`pe-${idx}`}>
                    <td data-label="Sl.">{idx + 1}</td>
                    <td data-label="Description">
                      <input
                        value={row.text}
                        onChange={(e) => {
                          const next = [...(intro.proposedEquipment || [])];
                          next[idx] = { ...row, text: e.target.value };
                          updateWizard({ projectIntroduction: { ...intro, proposedEquipment: next } });
                        }}
                      />
                    </td>
                    <td data-label="" className="text-center">
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm py-0 px-2"
                        disabled={(intro.proposedEquipment?.length ?? 0) <= 1}
                        title="Remove row"
                        aria-label="Remove row"
                        onClick={() => {
                          const pe = intro.proposedEquipment || [];
                          if (pe.length <= 1) return;
                          const next = pe.filter((_, i) => i !== idx).map((r, i) => ({ ...r, line: i + 1 }));
                          updateWizard({ projectIntroduction: { ...intro, proposedEquipment: next } });
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm mb-3"
            onClick={() => {
              const pe = [...(intro.proposedEquipment || [])];
              pe.push({ line: pe.length + 1, text: "" });
              updateWizard({
                projectIntroduction: { ...intro, proposedEquipment: pe.map((r, i) => ({ ...r, line: i + 1 })) },
              });
            }}
          >
            Add equipment row
          </button>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Description of the job</div>
          <textarea
            className="form-control mb-3"
            rows={2}
            value={intro.jobDescription}
            onChange={(e) => updateWizard({ projectIntroduction: { ...intro, jobDescription: e.target.value } })}
          />
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Dimensional details</div>
          <WorkflowSearchFilterShell
            drawerTitle="Dimensional details"
            search={wfIntroDim.search}
            onSearchChange={(v) => patchWfFilter("intro_dim", { search: v })}
            columnSpec={[
              { key: "activity", label: "Activity", options: wfDistinctValues(introDimRows, (r) => r.activity) },
              { key: "dimensions", label: "Dimensions", options: wfDistinctValues(introDimRows, (r) => r.dimensions) },
              { key: "description", label: "Description", options: wfDistinctValues(introDimRows, (r) => r.description) },
            ]}
            cols={wfIntroDim.cols || {}}
            onApplyColumnFilters={(c) => patchWfFilter("intro_dim", { cols: c, replaceCols: true })}
          />
          <div className="site-job-workflow__scroll">
            <table className="site-job-workflow__paper-table site-job-workflow__stack-mobile">
              <thead>
                <tr>
                  <th>Sl. No</th>
                  <th>Activity</th>
                  <th>Dimension (integer)</th>
                  <th>Unit</th>
                  <th>Description</th>
                  <th style={{ width: "5.5rem" }} className="text-center">
                    Remove
                  </th>
                </tr>
              </thead>
              <tbody>
                {introDimIdx.map((idx) => {
                  const row = introDimRows[idx];
                  return (
                  <tr key={`dim-${idx}`}>
                    <td data-label="Sl. No">{idx + 1}</td>
                    <td data-label="Activity">
                      <input
                        value={row.activity}
                        onChange={(e) => {
                          const next = [...(intro.dimensionalRows || [])];
                          next[idx] = { ...row, activity: e.target.value };
                          updateWizard({ projectIntroduction: { ...intro, dimensionalRows: next } });
                        }}
                      />
                    </td>
                    <td data-label="Dimension">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        autoComplete="off"
                        placeholder="e.g. 120"
                        value={row.dimensionValue ?? ""}
                        onChange={(e) => {
                          const next = [...(intro.dimensionalRows || [])];
                          next[idx] = { ...row, dimensionValue: sanitizeDimensionIntegerInput(e.target.value) };
                          updateWizard({ projectIntroduction: { ...intro, dimensionalRows: next } });
                        }}
                      />
                    </td>
                    <td data-label="Unit">
                      <select
                        className="form-select form-select-sm"
                        value={DIMENSION_UNITS.includes(String(row.dimensionUnit ?? "").toLowerCase()) ? String(row.dimensionUnit).toLowerCase() : "mm"}
                        onChange={(e) => {
                          const next = [...(intro.dimensionalRows || [])];
                          next[idx] = { ...row, dimensionUnit: e.target.value };
                          updateWizard({ projectIntroduction: { ...intro, dimensionalRows: next } });
                        }}
                      >
                        {DIMENSION_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td data-label="Description">
                      <input
                        value={row.description}
                        onChange={(e) => {
                          const next = [...(intro.dimensionalRows || [])];
                          next[idx] = { ...row, description: e.target.value };
                          updateWizard({ projectIntroduction: { ...intro, dimensionalRows: next } });
                        }}
                      />
                    </td>
                    <td data-label="" className="text-center">
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm py-0 px-2"
                        disabled={(intro.dimensionalRows?.length ?? 0) <= 1}
                        aria-label="Remove row"
                        onClick={() => {
                          const dr = intro.dimensionalRows || [];
                          if (dr.length <= 1) return;
                          const next = dr
                            .filter((_, i) => i !== idx)
                            .map((r, i) => ({ ...r, slNo: i + 1 }));
                          updateWizard({ projectIntroduction: { ...intro, dimensionalRows: next } });
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm mb-3"
            onClick={() => {
              const dr = [...(intro.dimensionalRows || [])];
              dr.push({
                slNo: dr.length + 1,
                activity: "Machining of stay ring surfaces",
                dimensionValue: "",
                dimensionUnit: "mm",
                description: "",
              });
              updateWizard({
                projectIntroduction: { ...intro, dimensionalRows: dr.map((r, i) => ({ ...r, slNo: i + 1 })) },
              });
            }}
          >
            Add dimensional row
          </button>
          <div className="row g-2">
            <div className="col-md-6">
              <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Mobilization schedule</div>
              <WorkflowSearchFilterShell
                drawerTitle="Mobilization schedule"
                search={wfIntroMob.search}
                onSearchChange={(v) => patchWfFilter("intro_mob", { search: v })}
                columnSpec={[
                  { key: "activity", label: "Activity", options: wfDistinctValues(introMobRows, (r) => r.activity) },
                  { key: "date", label: "Date", options: wfDistinctValues(introMobRows, (r) => r.date) },
                ]}
                cols={wfIntroMob.cols || {}}
                onApplyColumnFilters={(c) => patchWfFilter("intro_mob", { cols: c, replaceCols: true })}
              />
              <div className="site-job-workflow__scroll">
                <table className="site-job-workflow__paper-table site-job-workflow__stack-mobile">
                  <thead>
                    <tr>
                      <th>Sl.</th>
                      <th>Activity</th>
                      <th>Date</th>
                      <th style={{ width: "5.5rem" }} className="text-center">
                        Remove
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {introMobIdx.map((idx) => {
                      const row = introMobRows[idx];
                      return (
                      <tr key={`mob-${idx}`}>
                        <td data-label="Sl.">{String(idx + 1).padStart(2, "0")}</td>
                        <td data-label="Activity">
                          <input
                            value={row.activity}
                            onChange={(e) => {
                              const next = [...(intro.mobilization || [])];
                              next[idx] = { ...row, activity: e.target.value };
                              updateWizard({ projectIntroduction: { ...intro, mobilization: next } });
                            }}
                          />
                        </td>
                        <td data-label="Date">
                          <input
                            type="date"
                            value={row.date}
                            onChange={(e) => {
                              const next = [...(intro.mobilization || [])];
                              next[idx] = { ...row, date: e.target.value };
                              updateWizard({ projectIntroduction: { ...intro, mobilization: next } });
                            }}
                          />
                        </td>
                        <td data-label="" className="text-center">
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm py-0 px-2"
                            disabled={(intro.mobilization?.length ?? 0) <= 1}
                            aria-label="Remove row"
                            onClick={() => {
                              const mob = intro.mobilization || [];
                              if (mob.length <= 1) return;
                              const next = mob
                                .filter((_, i) => i !== idx)
                                .map((r, i) => ({ ...r, slNo: i + 1 }));
                              updateWizard({ projectIntroduction: { ...intro, mobilization: next } });
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm mt-1"
                onClick={() => {
                  const mob = [...(intro.mobilization || [])];
                  mob.push({ slNo: mob.length + 1, activity: "", date: "" });
                  updateWizard({
                    projectIntroduction: { ...intro, mobilization: mob.map((r, i) => ({ ...r, slNo: i + 1 })) },
                  });
                }}
              >
                Add mobilization row
              </button>
            </div>
            <div className="col-md-6">
              <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Site team members</div>
              <p className="site-job-workflow__muted small mb-1">
                Pick a user from the directory (same users as User Management, up to {USER_DIRECTORY_PAGE_SIZE} loaded). Open the
                list and use <strong>Clear selection</strong> if you need a custom name typed below.
              </p>
              <WorkflowSearchFilterShell
                drawerTitle="Site team members"
                search={wfIntroTm.search}
                onSearchChange={(v) => patchWfFilter("intro_team", { search: v })}
                columnSpec={[{ key: "name", label: "Member name", options: wfDistinctValues(introTmRows, (r) => r.name) }]}
                cols={wfIntroTm.cols || {}}
                onApplyColumnFilters={(c) => patchWfFilter("intro_team", { cols: c, replaceCols: true })}
              />
              <div className="site-job-workflow__scroll">
                <table className="site-job-workflow__paper-table site-job-workflow__stack-mobile">
                  <thead>
                    <tr>
                      <th>Sl.</th>
                      <th>Member</th>
                      <th style={{ width: "5.5rem" }} className="text-center">
                        Remove
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {introTmIdx.map((idx) => {
                      const row = introTmRows[idx];
                      return (
                      <tr key={`tm-${idx}`}>
                        <td data-label="Sl.">{String(idx + 1).padStart(2, "0")}</td>
                        <td data-label="Member">
                          <UserDirectoryCombobox
                            compact
                            options={employeeOptions}
                            value={directorySelectValue(row.employeeUserId, row.name, employeeOptions)}
                            placeholder="— Select from users —"
                            ariaLabel={`Select user for row ${idx + 1}`}
                            onChange={(v) => {
                              const next = [...(intro.teamMembers || [])];
                              if (!v) {
                                next[idx] = { ...row, employeeUserId: null };
                              } else {
                                const id = Number(v);
                                const u = employeeOptions.find((x) => x.id === id);
                                next[idx] = {
                                  ...row,
                                  employeeUserId: id,
                                  name: u?.name ?? u?.email ?? "",
                                };
                              }
                              updateWizard({ projectIntroduction: { ...intro, teamMembers: next } });
                            }}
                          />
                          <input
                            className="form-control form-control-sm"
                            placeholder={
                              row.employeeUserId != null
                                ? "Linked name — clear user above to edit"
                                : "Type member name if not in list above"
                            }
                            readOnly={row.employeeUserId != null}
                            value={row.name ?? ""}
                            onChange={(e) => {
                              const next = [...(intro.teamMembers || [])];
                              next[idx] = {
                                ...row,
                                name: e.target.value,
                                employeeUserId: null,
                              };
                              updateWizard({ projectIntroduction: { ...intro, teamMembers: next } });
                            }}
                          />
                        </td>
                        <td data-label="" className="text-center">
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm py-0 px-2"
                            disabled={(intro.teamMembers?.length ?? 0) <= 1}
                            aria-label="Remove row"
                            onClick={() => {
                              const tm = intro.teamMembers || [];
                              if (tm.length <= 1) return;
                              const next = tm
                                .filter((_, i) => i !== idx)
                                .map((r, i) => ({ ...r, slNo: i + 1 }));
                              updateWizard({ projectIntroduction: { ...intro, teamMembers: next } });
                            }}
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm mt-1"
                onClick={() => {
                  const tm = [...(intro.teamMembers || [])];
                  tm.push({ slNo: tm.length + 1, name: "", employeeUserId: null });
                  updateWizard({
                    projectIntroduction: { ...intro, teamMembers: tm.map((r, i) => ({ ...r, slNo: i + 1 })) },
                  });
                }}
              >
                Add team member row
              </button>
            </div>
          </div>
        </div>
      )}

      {currentStepIndex === 1 && (
        <div>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Engineering procedure</div>
          <div className="d-flex flex-wrap gap-3 mb-2 align-items-end">
            <div>
              <label className="form-label small mb-0">Target schedule (days)</label>
              <input
                className="form-control form-control-sm"
                style={{ maxWidth: "8rem" }}
                aria-describedby="eng-target-schedule-hint"
                value={intro.scheduledDays ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  const nextIntro = { ...intro, scheduledDays: v };
                  updateWizard({
                    projectIntroduction: nextIntro,
                    engineeringProcedure: ensureEngineeringProcedure(eng, nextIntro, site),
                  });
                }}
              />
              <p id="eng-target-schedule-hint" className="site-job-workflow__muted small mb-0 mt-1">
                Same value as <strong>Scheduled days</strong> on Project introduction (step 1).
              </p>
            </div>
          </div>
          <WorkflowSearchFilterShell
            drawerTitle="Engineering procedure"
            search={wfEng.search}
            onSearchChange={(v) => patchWfFilter("eng_schedule", { search: v })}
            columnSpec={[
              { key: "activity", label: "Activity", options: wfDistinctValues(engRowsList, (r) => r.activity) },
              { key: "day", label: "Day", options: wfDistinctValues(engRowsList, (r) => r.day) },
              { key: "targetTime", label: "Target time", options: wfDistinctValues(engRowsList, (r) => r.targetTime) },
              { key: "actualTime", label: "Actual time", options: wfDistinctValues(engRowsList, (r) => r.actualTime) },
              { key: "reasonDelay", label: "Reason delay", options: wfDistinctValues(engRowsList, (r) => r.reasonDelay) },
            ]}
            cols={wfEng.cols || {}}
            onApplyColumnFilters={(c) => patchWfFilter("eng_schedule", { cols: c, replaceCols: true })}
          />
          <div className="site-job-workflow__scroll">
            <table className="site-job-workflow__paper-table site-job-workflow__stack-mobile">
              <thead>
                <tr>
                  <th>Sl.No.</th>
                  <th>Activity</th>
                  <th>Day</th>
                  <th>Target time</th>
                  <th>Actual time</th>
                  <th>Reason for delay</th>
                  <th style={{ width: "5.5rem" }} className="text-center">
                    Remove
                  </th>
                </tr>
              </thead>
              <tbody>
                {engIdx.map((idx) => {
                  const row = engRowsList[idx];
                  return (
                  <tr key={`eng-row-${idx}`}>
                    <td data-label="Sl.No.">{idx + 1}</td>
                    <td data-label="Activity">
                      <input
                        value={row.activity}
                        onChange={(e) => {
                          const rows = [...(eng.rows || [])];
                          rows[idx] = { ...row, activity: e.target.value };
                          updateWizard({ engineeringProcedure: { ...eng, rows } });
                        }}
                      />
                    </td>
                    <td data-label="Day">
                      <input
                        value={row.day}
                        onChange={(e) => {
                          const rows = [...(eng.rows || [])];
                          rows[idx] = { ...row, day: e.target.value };
                          updateWizard({ engineeringProcedure: { ...eng, rows } });
                        }}
                      />
                    </td>
                    <td data-label="Target time">
                      <input
                        value={row.targetTime}
                        onChange={(e) => {
                          const rows = [...(eng.rows || [])];
                          rows[idx] = { ...row, targetTime: e.target.value };
                          updateWizard({ engineeringProcedure: { ...eng, rows } });
                        }}
                      />
                    </td>
                    <td data-label="Actual time">
                      <input
                        value={row.actualTime}
                        onChange={(e) => {
                          const rows = [...(eng.rows || [])];
                          rows[idx] = { ...row, actualTime: e.target.value };
                          updateWizard({ engineeringProcedure: { ...eng, rows } });
                        }}
                      />
                    </td>
                    <td data-label="Reason for delay">
                      <input
                        value={row.reasonDelay}
                        onChange={(e) => {
                          const rows = [...(eng.rows || [])];
                          rows[idx] = { ...row, reasonDelay: e.target.value };
                          updateWizard({ engineeringProcedure: { ...eng, rows } });
                        }}
                      />
                    </td>
                    <td data-label="" className="text-center">
                      <button
                        type="button"
                        className="btn btn-outline-danger btn-sm py-0 px-2"
                        disabled={(eng.rows?.length ?? 0) <= 1}
                        aria-label="Remove row"
                        onClick={() => {
                          const rows = eng.rows || [];
                          if (rows.length <= 1) return;
                          const next = rows
                            .filter((_, i) => i !== idx)
                            .map((r, i) => ({
                              ...r,
                              slNo: i + 1,
                            }));
                          updateWizard({ engineeringProcedure: { ...eng, rows: next } });
                        }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="btn btn-outline-primary btn-sm mt-1"
            onClick={() => {
              const rows = [...(eng.rows || [])];
              rows.push({
                slNo: rows.length + 1,
                activity: "",
                day: "",
                targetTime: "",
                actualTime: "",
                reasonDelay: "",
              });
              updateWizard({
                engineeringProcedure: {
                  ...eng,
                  rows: rows.map((r, i) => ({ ...r, slNo: i + 1 })),
                },
              });
            }}
          >
            Add activity row
          </button>
        </div>
      )}

      {currentStepIndex === 2 && (
        <div>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Daily checklist — tools (by category)</div>
          {equipmentPortalLoadError ? (
            <div className="alert alert-warning py-2 small mb-2" role="status">
              {equipmentPortalLoadError}
              {!equipmentPortal ? (
                <div className="mt-2">
                  <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => refetchEquipmentPortal()}>
                    Retry loading checklist
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="btn-group btn-group-sm mb-2" role="group" aria-label="Which half of the month">
            <button
              type="button"
              className={`btn ${toolDayBlock === 0 ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => setToolDayBlock(0)}
            >
              Days 01–15
            </button>
            <button
              type="button"
              className={`btn ${toolDayBlock === 1 ? "btn-primary" : "btn-outline-primary"}`}
              onClick={() => setToolDayBlock(1)}
            >
              Days 16–31
            </button>
          </div>
          <p className="site-job-workflow__muted small mb-3">
            Tick the checkbox for a day when the item was <strong>physically available on site</strong>. Use the Date column to pick an inspection or calibration date from the calendar (optional).
          </p>
          {!equipmentPortal ? (
            <p className="text-muted small">Loading equipment checklist…</p>
          ) : (
            (() => {
              const ep = equipmentPortal;
              const toolsMonthHeading =
                ep.year != null && ep.month != null
                  ? formatYearMonthHeading(`${ep.year}-${String(ep.month).padStart(2, "0")}`)
                  : formatYearMonthHeading(intro.toolsChecklistMonth) || formatYearMonthHeading(currentYearMonth());
              const blockCols = toolDayBlockLength(toolDayBlock);
              const markStart = toolDayBlockStartCol(toolDayBlock);
              const categories = ep.categories || [];
              if (categories.length === 0) {
                return (
                  <div className="border rounded p-3 mb-4 bg-body-secondary">
                    <p className="mb-2 fw-semibold">No checklist sections yet</p>
                    <p className="small text-muted mb-3">
                      No checklist sections for this month yet. The tables below are only the <strong>machinery catalog</strong> — not the daily checklist grid. Add sections here, then use{" "}
                      <strong>Save &amp; next</strong> to store them.
                    </p>
                    <ul className="small mb-3">
                      <li>
                        <strong>Add default sections</strong> — creates the usual <strong>A–K</strong> blocks (one blank row each), same layout as the paper form, so{" "}
                        <strong>Import machinery</strong> can place rows (machinery must have <strong>Tools checklist category A–K</strong> set — yours may show &quot;—&quot; until you edit them in Admin → Machinery).
                      </li>
                      <li>
                        <strong>Add category</strong> — one custom section; use a title like <code>A. My tools</code> if you want imports to match letter <code>A</code>.
                      </li>
                    </ul>
                    <button
                      type="button"
                      className="btn btn-primary btn-sm me-2"
                      onClick={() => {
                        setEquipmentPortal((prev) => {
                          if (!prev) return prev;
                          return { ...prev, categories: buildDefaultEquipmentPortalTemplateCategories() };
                        });
                        setToolChecklistActionMessage({
                          kind: "info",
                          text: "Default sections added. Fill rows or import machinery, then press “Save & next” to persist.",
                        });
                      }}
                    >
                      Add default sections (A, B, C, I, J, K)
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline-primary btn-sm"
                      onClick={() => {
                        setToolChecklistActionMessage({ kind: "", text: "" });
                        setAddCategoryName("");
                        setAddCategoryOpen(true);
                      }}
                    >
                      Add one custom category…
                    </button>
                  </div>
                );
              }
              return categories.map((cat, ci) => {
                const items = cat.items || [];
                const equipmentTableKey = `equipment_ci_${ci}`;
                const wfEquipmentCat = workflowTableFilters[equipmentTableKey] || { search: "", cols: {} };
                const equipmentItemMatchers = {
                  itemDescription: (it) => String(it.itemDescription ?? "").trim(),
                  uom: (it) => String(it.uom ?? "").trim(),
                  qty: (it) => String(it.qty ?? "").trim(),
                  dateNote: (it) => String(it.dateNote ?? "").trim(),
                };
                const equipmentItemIdx = filterRowIndices(
                  items,
                  wfEquipmentCat,
                  Object.values(equipmentItemMatchers),
                  equipmentItemMatchers,
                );
                return (
                <div key={cat.id != null ? `cat-${cat.id}` : `cat-new-${ci}`} className="mb-4">
                  <div className="site-job-workflow__category-row">
                    <table className="site-job-workflow__paper-table mb-0">
                      <tbody>
                        <tr
                          className="site-job-workflow__category-row site-job-workflow__equipment-cat-droptarget"
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.dataTransfer.dropEffect = "move";
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            const parsed = parseEquipmentDnDTransfer(e);
                            if (!parsed) return;
                            const { fromCi, fromIi } = parsed;
                            const nextCats = appendEquipmentItemToCategory(categories, fromCi, fromIi, ci);
                            void applyEquipmentPortalReorderAndSyncLayout({ ...ep, categories: nextCats });
                          }}
                          title="Drop a row here to move it to the end of this section"
                        >
                          <td colSpan={6 + blockCols}>{cat.title}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <WorkflowSearchFilterShell
                    drawerTitle={String(cat.title || "Tools checklist section").trim() || "Tools checklist section"}
                    search={wfEquipmentCat.search}
                    onSearchChange={(v) => patchWfFilter(equipmentTableKey, { search: v })}
                    columnSpec={[
                      {
                        key: "itemDescription",
                        label: "Item",
                        options: wfDistinctValues(items, (it) => it.itemDescription),
                      },
                      { key: "uom", label: "UOM", options: wfDistinctValues(items, (it) => it.uom) },
                      { key: "qty", label: "Qty", options: wfDistinctValues(items, (it) => it.qty) },
                      { key: "dateNote", label: "Date note", options: wfDistinctValues(items, (it) => it.dateNote) },
                    ]}
                    cols={wfEquipmentCat.cols || {}}
                    onApplyColumnFilters={(c) => patchWfFilter(equipmentTableKey, { cols: c, replaceCols: true })}
                  />
                  <div className="site-job-workflow__scroll">
                    <table className="site-job-workflow__paper-table">
                      <thead>
                        <tr>
                          <th colSpan={6} />
                          <th colSpan={blockCols} className="text-center site-job-workflow__month-banner">
                            {toolsMonthHeading}
                          </th>
                        </tr>
                        <tr>
                          <th className="site-job-workflow__equipment-dnd-col" scope="col" title="Drag ⋮⋮ on a row to reorder">
                            {" "}
                          </th>
                          <th>Sl.</th>
                          <th>Item description</th>
                          <th>UOM</th>
                          <th>Qty</th>
                          <th>Date</th>
                          {Array.from({ length: blockCols }, (_, d) => (
                            <th key={d} className="site-job-workflow__day-cell">
                              {String(calendarDayForCell(toolDayBlock, d)).padStart(2, "0")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {equipmentItemIdx.map((ii) => {
                          const item = items[ii];
                          return (
                          <tr
                            key={item.id != null ? `item-${item.id}` : `item-${ci}-${ii}`}
                            className={
                              equipmentDragKey === `${ci}-${ii}` ? "site-job-workflow__equipment-row--dragging" : undefined
                            }
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              const parsed = parseEquipmentDnDTransfer(e);
                              if (!parsed) return;
                              const { fromCi, fromIi } = parsed;
                              if (fromCi === ci && fromIi === ii) return;
                              const nextCats = moveEquipmentItemToIndex(categories, fromCi, fromIi, ci, ii);
                              void applyEquipmentPortalReorderAndSyncLayout({ ...ep, categories: nextCats });
                            }}
                          >
                            <td
                              className="site-job-workflow__equipment-dnd-handle"
                              draggable
                              title="Drag to reorder or move to another section"
                              onDragStart={(e) => {
                                e.stopPropagation();
                                const payload = JSON.stringify({ fromCi: ci, fromIi: ii });
                                e.dataTransfer.setData(EQUIPMENT_ROW_DND_MIME, payload);
                                e.dataTransfer.setData("text/plain", payload);
                                e.dataTransfer.effectAllowed = "move";
                                setEquipmentDragKey(`${ci}-${ii}`);
                              }}
                              onDragEnd={() => setEquipmentDragKey(null)}
                            >
                              ⋮⋮
                            </td>
                            <td>{ii + 1}</td>
                            <td>
                              <input
                                value={item.itemDescription ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setEquipmentPortal((prev) => {
                                    if (!prev) return prev;
                                    const nextCats = [...(prev.categories || [])];
                                    const items = [...(nextCats[ci].items || [])];
                                    items[ii] = { ...items[ii], itemDescription: v };
                                    nextCats[ci] = { ...nextCats[ci], items };
                                    return { ...prev, categories: nextCats };
                                  });
                                }}
                              />
                            </td>
                            <td>
                              <input
                                value={item.uom ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setEquipmentPortal((prev) => {
                                    if (!prev) return prev;
                                    const nextCats = [...(prev.categories || [])];
                                    const items = [...(nextCats[ci].items || [])];
                                    items[ii] = { ...items[ii], uom: v };
                                    nextCats[ci] = { ...nextCats[ci], items };
                                    return { ...prev, categories: nextCats };
                                  });
                                }}
                              />
                            </td>
                            <td>
                              <input
                                value={item.qty ?? ""}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setEquipmentPortal((prev) => {
                                    if (!prev) return prev;
                                    const nextCats = [...(prev.categories || [])];
                                    const items = [...(nextCats[ci].items || [])];
                                    items[ii] = { ...items[ii], qty: v };
                                    nextCats[ci] = { ...nextCats[ci], items };
                                    return { ...prev, categories: nextCats };
                                  });
                                }}
                              />
                            </td>
                            <td>
                              <input
                                value={item.dateNote ?? ""}
                                placeholder="e.g. 22.09.24"
                                onChange={(e) => {
                                  const v = e.target.value;
                                  setEquipmentPortal((prev) => {
                                    if (!prev) return prev;
                                    const nextCats = [...(prev.categories || [])];
                                    const items = [...(nextCats[ci].items || [])];
                                    items[ii] = { ...items[ii], dateNote: v.trim() === "" ? null : v };
                                    nextCats[ci] = { ...nextCats[ci], items };
                                    return { ...prev, categories: nextCats };
                                  });
                                }}
                              />
                            </td>
                            {Array.from({ length: blockCols }, (_, di) => {
                              const globalIdx = markStart + di;
                              const dayNum = globalIdx + 1;
                              const dayKey = String(dayNum);
                              const checked = Boolean(item.dayPresent && item.dayPresent[dayKey]);
                              return (
                                <td
                                  key={`${cat.id ?? ci}-${ii}-d-${globalIdx}`}
                                  className="site-job-workflow__day-cell"
                                  data-label={`Day ${String(dayNum).padStart(2, "0")} (${toolsMonthHeading})`}
                                >
                                  <input
                                    type="checkbox"
                                    className="site-job-workflow__day-check"
                                    checked={checked}
                                    title={`Day ${String(dayNum).padStart(2, "0")} — tick if available`}
                                    onChange={(e) => {
                                      const on = e.target.checked;
                                      setEquipmentPortal((prev) => {
                                        if (!prev) return prev;
                                        const nextCats = [...(prev.categories || [])];
                                        const items = [...(nextCats[ci].items || [])];
                                        const cur = items[ii];
                                        const nextDp = { ...(cur.dayPresent && typeof cur.dayPresent === "object" ? cur.dayPresent : {}) };
                                        if (on) nextDp[dayKey] = true;
                                        else delete nextDp[dayKey];
                                        items[ii] = { ...cur, dayPresent: nextDp };
                                        nextCats[ci] = { ...nextCats[ci], items };
                                        return { ...prev, categories: nextCats };
                                      });
                                    }}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm mt-1"
                    onClick={() => {
                      setEquipmentPortal((prev) => {
                        if (!prev) return prev;
                        const nextCats = [...(prev.categories || [])];
                        const items = [...(nextCats[ci].items || [])];
                        items.push(emptyEquipmentPortalItem(items.length));
                        nextCats[ci] = { ...nextCats[ci], items };
                        return { ...prev, categories: nextCats };
                      });
                    }}
                  >
                    Add row in {String(cat.title || "category").replace(/^.\.\s*/, "")}
                  </button>
                </div>
              );
              });
            })()
          )}
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static mt-3">Machinery catalog (this site)</div>
          <p className="site-job-workflow__muted small mb-2">
            In <strong>Machinery</strong>, set <strong>Tools checklist category</strong> (A–K) so imports match sections whose title starts with that letter (e.g. <strong>A.</strong>). New categories and rows below are saved when you use{" "}
            <strong>Save &amp; next</strong>.
          </p>
          {machineryByCategory.length === 0 ? (
            <p className="text-muted small">No machinery rows for this site.</p>
          ) : (
            machineryByCategory.map(([label, rows], mi) => {
              const machineryTableKey = `machinery_${mi}`;
              const wfMachinery = workflowTableFilters[machineryTableKey] || { search: "", cols: {} };
              const machineryMatchers = {
                code: (m) => String(m.code ?? "").trim(),
                name: (m) => String(m.name ?? "").trim(),
                defaultUom: (m) => String(m.defaultUom ?? "").trim(),
                status: (m) => String(m.status ?? "").trim(),
                checklist: (m) => {
                  const ck = getMachineryChecklistKey(m);
                  return ck ? `${ck} (${CHECKLIST_KEY_TO_LABEL[ck] ?? ck})` : "";
                },
              };
              const machineryIdx = filterRowIndices(rows, wfMachinery, Object.values(machineryMatchers), machineryMatchers);
              return (
              <div key={label} className="mb-2">
                <div className="fw-bold small text-uppercase mb-1">{label}</div>
                <WorkflowSearchFilterShell
                  drawerTitle={`Machinery — ${label}`}
                  search={wfMachinery.search}
                  onSearchChange={(v) => patchWfFilter(machineryTableKey, { search: v })}
                  columnSpec={[
                    { key: "code", label: "Code", options: wfDistinctValues(rows, (m) => m.code) },
                    { key: "name", label: "Name", options: wfDistinctValues(rows, (m) => m.name) },
                    { key: "defaultUom", label: "UOM", options: wfDistinctValues(rows, (m) => m.defaultUom) },
                    { key: "status", label: "Status", options: wfDistinctValues(rows, (m) => m.status) },
                    {
                      key: "checklist",
                      label: "Checklist",
                      options: wfDistinctValues(rows, (m) => {
                        const ck = getMachineryChecklistKey(m);
                        return ck ? `${ck} (${CHECKLIST_KEY_TO_LABEL[ck] ?? ck})` : "";
                      }),
                    },
                  ]}
                  cols={wfMachinery.cols || {}}
                  onApplyColumnFilters={(c) => patchWfFilter(machineryTableKey, { cols: c, replaceCols: true })}
                />
                <table className="site-job-workflow__paper-table">
                  <thead>
                    <tr>
                      <th>Code</th>
                      <th>Name</th>
                      <th>UOM</th>
                      <th>Status</th>
                      <th>Checklist</th>
                    </tr>
                  </thead>
                  <tbody>
                    {machineryIdx.map((ri) => {
                      const m = rows[ri];
                      const ck = getMachineryChecklistKey(m);
                      return (
                        <tr key={m.id}>
                          <td data-label="Code">{m.code}</td>
                          <td data-label="Name">{m.name}</td>
                          <td data-label="UOM">{m.defaultUom ?? "—"}</td>
                          <td data-label="Status">{m.status ?? "—"}</td>
                          <td data-label="Checklist">{ck ? `${ck} (${CHECKLIST_KEY_TO_LABEL[ck] ?? ck})` : "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              );
            })
          )}
          <div className="d-flex flex-wrap gap-2 mt-2">
            {toolChecklistActionMessage.text ? (
              <div
                className={`w-100 alert ${
                  toolChecklistActionMessage.kind === "success"
                    ? "alert-success"
                    : toolChecklistActionMessage.kind === "warning"
                      ? "alert-warning"
                      : "alert-info"
                } py-2 mb-0 small`}
                role="status"
              >
                {toolChecklistActionMessage.text}
              </div>
            ) : null}
            {addCategoryOpen ? (
              <div className="w-100 border rounded p-2 mb-1 bg-body-secondary">
                <label className="form-label small mb-1 fw-semibold" htmlFor="site-job-new-tool-category-name">
                  New section title
                </label>
                <div className="d-flex flex-wrap gap-2 align-items-center">
                  <input
                    id="site-job-new-tool-category-name"
                    ref={addCategoryInputRef}
                    type="text"
                    className="form-control form-control-sm"
                    style={{ maxWidth: "18rem" }}
                    value={addCategoryName}
                    placeholder="e.g. A. Power tools"
                    onChange={(e) => setAddCategoryName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        setAddCategoryOpen(false);
                        setAddCategoryName("");
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      if (!equipmentPortal) return;
                      const label = String(addCategoryName).trim() || "New category";
                      const categories = [...(equipmentPortal.categories || [])];
                      categories.push({
                        id: null,
                        title: label,
                        sortOrder: categories.length,
                        items: [emptyEquipmentPortalItem(0)],
                      });
                      setEquipmentPortal({ ...equipmentPortal, categories });
                      setAddCategoryOpen(false);
                      setAddCategoryName("");
                      setToolChecklistActionMessage({
                        kind: "success",
                        text: `Added section “${label}”. Use “Save & next” to persist to the server.`,
                      });
                      showSuccess?.(`Added section “${label}”.`);
                    }}
                  >
                    Create section
                  </button>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    onClick={() => {
                      setAddCategoryOpen(false);
                      setAddCategoryName("");
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            {!addCategoryOpen ? (
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                disabled={!equipmentPortal}
                onClick={() => {
                  setToolChecklistActionMessage({ kind: "", text: "" });
                  setAddCategoryName("");
                  setAddCategoryOpen(true);
                }}
              >
                Add category
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-primary btn-sm"
              disabled={!equipmentPortal}
              onClick={() => {
                if (!equipmentPortal) return;
                let added = 0;
                const categories = [...(equipmentPortal.categories || [])];
                for (const m of machineryList) {
                  const ck = getMachineryChecklistKey(m);
                  if (!ck) continue;
                  const cix = findEquipmentCategoryIndexForMachineryKey(categories, ck);
                  if (cix < 0) continue;
                  const items = [...(categories[cix].items || [])];
                  const lineDesc = [m.code, m.name].filter(Boolean).join(" — ");
                  if (items.some((it) => String(it.itemDescription ?? "").trim() === lineDesc.trim())) continue;
                  items.push({
                    ...emptyEquipmentPortalItem(items.length),
                    itemDescription: lineDesc,
                    uom: m.defaultUom || "",
                  });
                  categories[cix] = { ...categories[cix], items };
                  added += 1;
                }
                if (added === 0) {
                  const msg =
                    machineryList.length === 0
                      ? "No machinery loaded for this site. Add machines under Admin → Machinery, then set each machine’s “Tools checklist category” to A–K before importing."
                      : 'No new lines added. Each machine needs a checklist letter (A, B, C, I, J, or K), and the portal needs a category whose title starts with that letter (e.g. “A. …”).';
                  setToolChecklistActionMessage({ kind: "warning", text: msg });
                  return;
                }
                setEquipmentPortal({ ...equipmentPortal, categories });
                const msg = `Added ${added} machinery line(s). Use “Save & next” to persist.`;
                setToolChecklistActionMessage({ kind: "success", text: msg });
                showSuccess?.(`Added ${added} machinery line(s) under their checklist categories.`);
              }}
            >
              Import machinery into checklist (by category)
            </button>
          </div>
        </div>
      )}

      {currentStepIndex === 3 && (
        <div>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Site advance received &amp; paid</div>
          <p className="site-job-workflow__muted small mb-2">Matches the paper register. Use <strong>Save &amp; next</strong> to save this step.</p>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Details of dispersion of expenses</div>
          <div className="d-flex gap-2 mb-2 align-items-center flex-wrap">
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              disabled={advanceLines.length >= WORKFLOW_JOB_TABLE_MAX_ROWS}
              onClick={() =>
                setAdvanceLines((prev) => {
                  if (prev.length >= WORKFLOW_JOB_TABLE_MAX_ROWS) return prev;
                  return [...prev, emptyAdvanceExpenseRow(prev.length + 1)];
                })
              }
            >
              Add row
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              disabled={advanceLines.length <= WORKFLOW_JOB_TABLE_MIN_ROWS}
              onClick={() =>
                setAdvanceLines((prev) => {
                  if (prev.length <= WORKFLOW_JOB_TABLE_MIN_ROWS) return prev;
                  return prev.slice(0, -1).map((r, i) => ({ ...r, slNo: i + 1 }));
                })
              }
            >
              Remove last row
            </button>
            <span className="site-job-workflow__muted small">
              {advanceLines.length} row{advanceLines.length !== 1 ? "s" : ""} (max {WORKFLOW_JOB_TABLE_MAX_ROWS})
            </span>
          </div>
          <WorkflowSearchFilterShell
            drawerTitle="Advance expenses"
            search={wfAdv.search}
            onSearchChange={(v) => patchWfFilter("expense_advance", { search: v })}
            columnSpec={advanceColumnSpec}
            cols={wfAdv.cols || {}}
            onApplyColumnFilters={(c) => patchWfFilter("expense_advance", { cols: c, replaceCols: true })}
          />
          <div className="site-job-workflow__scroll mb-4">
            <table className="site-job-workflow__paper-table site-job-workflow__dense-table site-job-workflow__stack-mobile">
              <thead>
                <tr>
                  <th>Sl.</th>
                  <th title="Date of advance received">Adv. date</th>
                  <th>Opening bal.</th>
                  <th>Amount</th>
                  <th>Food</th>
                  <th>Convey.</th>
                  <th>Medical</th>
                  <th>Add. manpower</th>
                  <th>Welding</th>
                  <th>Site exp.</th>
                  <th>Bal. in hand</th>
                  <th style={{ minWidth: "10rem" }}>Dispersion / notes</th>
                </tr>
              </thead>
              <tbody>
                {advIdx.map((idx) => {
                  const row = advanceLines[idx];
                  return (
                  <tr key={`adv-${row.slNo}`}>
                    <td data-label="Sl.">{row.slNo}</td>
                    {[
                      ["dateAdvanceReceived", "date"],
                      ["openingBalance", "text"],
                      ["amount", "text"],
                      ["foodAllow", "text"],
                      ["conveyance", "text"],
                      ["medical", "text"],
                      ["additionalManpower", "text"],
                      ["welding", "text"],
                      ["siteExpenses", "text"],
                      ["balanceInHand", "text"],
                      ["dispersionDetails", "text"],
                    ].map(([field, typ], colIdx) => (
                      <td key={field} data-label={ADVANCE_EXPENSE_COLUMN_LABELS[colIdx]}>
                        <input
                          type={typ === "date" ? "date" : "text"}
                          className="form-control form-control-sm border-0 rounded-0 px-1"
                          value={row[field] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setAdvanceLines((prev) => {
                              const next = [...prev];
                              next[idx] = { ...next[idx], [field]: v };
                              return next;
                            });
                          }}
                        />
                      </td>
                    ))}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Technician-wise dispersion of funds</div>
          <p className="site-job-workflow__muted small mb-1">
            Up to {TECHNICIAN_PAYMENT_SLOTS} payment slots per row; duplicate technicians are merged into one row when you load or
            save (extra payments spill to the next row for the same person). <strong>Total</strong> is the sum of Pay 1–Pay 6 amounts.
          </p>
          <div className="d-flex gap-2 mb-2 align-items-center flex-wrap">
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              disabled={technicianPaymentLines.length >= WORKFLOW_JOB_TABLE_MAX_ROWS}
              onClick={() =>
                setTechnicianPaymentLines((prev) => {
                  if (prev.length >= WORKFLOW_JOB_TABLE_MAX_ROWS) return prev;
                  return [...prev, emptyTechnicianPaymentRow(prev.length + 1)];
                })
              }
            >
              Add technician row
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              disabled={technicianPaymentLines.length <= WORKFLOW_JOB_TABLE_MIN_ROWS}
              onClick={() =>
                setTechnicianPaymentLines((prev) => {
                  if (prev.length <= WORKFLOW_JOB_TABLE_MIN_ROWS) return prev;
                  return prev.slice(0, -1).map((r, i) => ({ ...r, slNo: i + 1 }));
                })
              }
            >
              Remove last technician row
            </button>
            <span className="site-job-workflow__muted small">
              {technicianPaymentLines.length} row{technicianPaymentLines.length !== 1 ? "s" : ""}
            </span>
          </div>
          <WorkflowSearchFilterShell
            drawerTitle="Technician payments"
            search={wfTech.search}
            onSearchChange={(v) => patchWfFilter("expense_technician", { search: v })}
            columnSpec={techColumnSpec}
            cols={wfTech.cols || {}}
            onApplyColumnFilters={(c) => patchWfFilter("expense_technician", { cols: c, replaceCols: true })}
          />
          <div className="site-job-workflow__scroll mb-2">
            <table className="site-job-workflow__paper-table site-job-workflow__dense-table site-job-workflow__stack-mobile">
              <thead>
                <tr>
                  <th>Sl.</th>
                  <th style={{ minWidth: "8rem" }}>Technician name</th>
                  {Array.from({ length: TECHNICIAN_PAYMENT_SLOTS }, (_, s) => (
                    <Fragment key={`pay-h-${s}`}>
                      <th className="small">Pay {s + 1} date</th>
                      <th className="small">Pay {s + 1} amt</th>
                    </Fragment>
                  ))}
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {techIdx.map((ri) => {
                  const row = technicianPaymentLines[ri];
                  return (
                  <tr key={`tech-${row.slNo}`}>
                    <td data-label="Sl.">{row.slNo}</td>
                    <td data-label="Technician name" style={{ minWidth: "12rem" }}>
                      <UserDirectoryCombobox
                        compact
                        options={employeeOptions}
                        value={directorySelectValue(row.technicianUserId, row.technicianName, employeeOptions)}
                        placeholder="— Select user or type below —"
                        ariaLabel={`Technician user row ${row.slNo}`}
                        onChange={(v) => {
                          setTechnicianPaymentLines((prev) => {
                            const next = [...prev];
                            if (!v) {
                              next[ri] = {
                                ...next[ri],
                                technicianUserId: null,
                                totalPayment: sumTechnicianPaymentAmounts(next[ri].payments),
                              };
                            } else {
                              const id = Number(v);
                              const u = employeeOptions.find((x) => x.id === id);
                              const pay = next[ri].payments;
                              next[ri] = {
                                ...next[ri],
                                technicianUserId: id,
                                technicianName: u?.name ?? u?.email ?? "",
                                totalPayment: sumTechnicianPaymentAmounts(pay),
                              };
                            }
                            return next;
                          });
                        }}
                      />
                      <input
                        className="form-control form-control-sm border-0 rounded-0 px-1"
                        placeholder={
                          row.technicianUserId != null
                            ? "Linked — clear user above to type a custom name"
                            : "Technician name (custom if not in list)"
                        }
                        readOnly={row.technicianUserId != null}
                        value={row.technicianName ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setTechnicianPaymentLines((prev) => {
                            const n = [...prev];
                            const pay = n[ri].payments;
                            n[ri] = {
                              ...n[ri],
                              technicianName: val,
                              technicianUserId: null,
                              totalPayment: sumTechnicianPaymentAmounts(pay),
                            };
                            return n;
                          });
                        }}
                      />
                    </td>
                    {row.payments.map((p, pi) => (
                      <Fragment key={`p-${ri}-${pi}`}>
                        <td data-label={`Pay ${pi + 1} date`}>
                          <input
                            type="date"
                            className="form-control form-control-sm border-0 rounded-0 px-0"
                            value={p.date}
                            onChange={(e) => {
                              const v = e.target.value;
                              setTechnicianPaymentLines((prev) => {
                                const next = [...prev];
                                const pay = [...next[ri].payments];
                                pay[pi] = { ...pay[pi], date: v };
                                next[ri] = {
                                  ...next[ri],
                                  payments: pay,
                                  totalPayment: sumTechnicianPaymentAmounts(pay),
                                };
                                return next;
                              });
                            }}
                          />
                        </td>
                        <td data-label={`Pay ${pi + 1} amt`}>
                          <input
                            className="form-control form-control-sm border-0 rounded-0 px-1"
                            value={p.amount}
                            onChange={(e) => {
                              const v = e.target.value;
                              setTechnicianPaymentLines((prev) => {
                                const next = [...prev];
                                const pay = [...next[ri].payments];
                                pay[pi] = { ...pay[pi], amount: v };
                                next[ri] = {
                                  ...next[ri],
                                  payments: pay,
                                  totalPayment: sumTechnicianPaymentAmounts(pay),
                                };
                                return next;
                              });
                            }}
                          />
                        </td>
                      </Fragment>
                    ))}
                    <td data-label="Total" className="text-end align-middle pe-2 site-job-workflow__muted">
                      {sumTechnicianPaymentAmounts(row.payments) || "—"}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {currentStepIndex === 4 && (
        <div>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">
            Site team members movement register
          </div>
          <p className="site-job-workflow__muted small mb-3">
            Matches the paper register. Use <strong>Save &amp; next</strong> to save this step.
          </p>
          <div className="row g-2 mb-3">
            <div className="col-12 col-md-6">
              <label className="form-label small mb-0" htmlFor="tm-customer">
                Name of the customer
              </label>
              <input
                id="tm-customer"
                type="text"
                className="form-control form-control-sm"
                value={teamMovementRegister.customerName}
                onChange={(e) => patchTeamMovement({ customerName: e.target.value })}
              />
            </div>
            <div className="col-12 col-md-3">
              <label className="form-label small mb-0" htmlFor="tm-jobcode">
                Job code
              </label>
              <input
                id="tm-jobcode"
                type="text"
                className="form-control form-control-sm"
                value={teamMovementRegister.jobCode}
                onChange={(e) => patchTeamMovement({ jobCode: e.target.value })}
              />
            </div>
            <div className="col-12 col-md-3">
              <label className="form-label small mb-0" htmlFor="tm-total-days">
                Total project days
              </label>
              <input
                id="tm-total-days"
                type="text"
                className="form-control form-control-sm"
                value={teamMovementRegister.totalProjectDays}
                onChange={(e) => patchTeamMovement({ totalProjectDays: e.target.value })}
              />
            </div>
            <div className="col-12 col-md-3">
              <label className="form-label small mb-0" htmlFor="tm-start">
                Site start date
              </label>
              <input
                id="tm-start"
                type="date"
                className="form-control form-control-sm"
                value={teamMovementRegister.siteStartDate}
                onChange={(e) => patchTeamMovement({ siteStartDate: e.target.value })}
              />
            </div>
            <div className="col-12 col-md-3">
              <label className="form-label small mb-0" htmlFor="tm-finish">
                Site finish date
              </label>
              <input
                id="tm-finish"
                type="date"
                className="form-control form-control-sm"
                value={teamMovementRegister.siteFinishDate}
                onChange={(e) => patchTeamMovement({ siteFinishDate: e.target.value })}
              />
            </div>
          </div>
          <div className="d-flex gap-2 mb-2 align-items-center flex-wrap">
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              disabled={teamMovementRegister.rows.length >= WORKFLOW_JOB_TABLE_MAX_ROWS}
              onClick={() => {
                setWizardData((prev) => {
                  const cur = normalizeTeamMovementRegister(prev.teamMovementRegister, site);
                  if (cur.rows.length >= WORKFLOW_JOB_TABLE_MAX_ROWS) return prev;
                  const rows = [...cur.rows, emptyTeamMovementRow(cur.rows.length + 1)];
                  return { ...prev, teamMovementRegister: normalizeTeamMovementRegister({ ...cur, rows }, site) };
                });
              }}
            >
              Add row
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              disabled={teamMovementRegister.rows.length <= WORKFLOW_JOB_TABLE_MIN_ROWS}
              onClick={() => {
                setWizardData((prev) => {
                  const cur = normalizeTeamMovementRegister(prev.teamMovementRegister, site);
                  if (cur.rows.length <= WORKFLOW_JOB_TABLE_MIN_ROWS) return prev;
                  const rows = cur.rows.slice(0, -1).map((r, i) => ({ ...r, slNo: i + 1 }));
                  return { ...prev, teamMovementRegister: normalizeTeamMovementRegister({ ...cur, rows }, site) };
                });
              }}
            >
              Remove last row
            </button>
            <span className="site-job-workflow__muted small">
              {teamMovementRegister.rows.length} row{teamMovementRegister.rows.length !== 1 ? "s" : ""} (default{" "}
              {TEAM_MOVEMENT_REGISTER_ROW_COUNT})
            </span>
          </div>
          <div className="site-job-workflow__scroll mb-2">
            <table className="site-job-workflow__paper-table site-job-workflow__dense-table">
              <thead>
                <tr>
                  <th>Sl.No</th>
                  <th style={{ minWidth: "9rem" }}>Name</th>
                  <th style={{ minWidth: "8rem" }}>Designation</th>
                  <th colSpan={2} className="text-center">
                    Present at site
                  </th>
                  <th style={{ minWidth: "12rem" }}>Reasons for absence from site</th>
                </tr>
                <tr>
                  <th aria-hidden />
                  <th aria-hidden />
                  <th aria-hidden />
                  <th className="small">From date</th>
                  <th className="small">To date</th>
                  <th aria-hidden />
                </tr>
              </thead>
              <tbody>
                {teamMovementRegister.rows.map((row, ri) => (
                  <tr key={`tm-${row.slNo}`}>
                    <td>{row.slNo}</td>
                    <td>
                      <input
                        type="text"
                        className="form-control form-control-sm border-0 rounded-0 px-1"
                        value={row.name}
                        onChange={(e) => patchTeamMovementRow(ri, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="form-control form-control-sm border-0 rounded-0 px-1"
                        value={row.designation}
                        onChange={(e) => patchTeamMovementRow(ri, { designation: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        className="form-control form-control-sm border-0 rounded-0 px-1"
                        value={row.presentFromDate}
                        onChange={(e) => patchTeamMovementRow(ri, { presentFromDate: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="date"
                        className="form-control form-control-sm border-0 rounded-0 px-1"
                        value={row.presentToDate}
                        onChange={(e) => patchTeamMovementRow(ri, { presentToDate: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="form-control form-control-sm border-0 rounded-0 px-1"
                        value={row.absenceReason}
                        onChange={(e) => patchTeamMovementRow(ri, { absenceReason: e.target.value })}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {currentStepIndex === 5 && (
        <div>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Tools missing / damage / repair</div>
          <div className="d-flex gap-2 mb-2 align-items-center flex-wrap">
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              disabled={toolIssueLines.length >= WORKFLOW_JOB_TABLE_MAX_ROWS}
              onClick={() =>
                setToolIssueLines((prev) => {
                  if (prev.length >= WORKFLOW_JOB_TABLE_MAX_ROWS) return prev;
                  return [...prev, emptyToolIssueRow(prev.length + 1)];
                })
              }
            >
              Add row
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              disabled={toolIssueLines.length <= WORKFLOW_JOB_TABLE_MIN_ROWS}
              onClick={() =>
                setToolIssueLines((prev) => {
                  if (prev.length <= WORKFLOW_JOB_TABLE_MIN_ROWS) return prev;
                  return prev.slice(0, -1).map((r, i) => ({ ...r, slNo: i + 1 }));
                })
              }
            >
              Remove last row
            </button>
            <span className="site-job-workflow__muted small">{toolIssueLines.length} row(s)</span>
          </div>
          <WorkflowSearchFilterShell
            drawerTitle="Tool issues"
            search={wfToolIssues.search}
            onSearchChange={(v) => patchWfFilter("tool_issues", { search: v })}
            columnSpec={toolIssueColumnSpec}
            cols={wfToolIssues.cols || {}}
            onApplyColumnFilters={(c) => patchWfFilter("tool_issues", { cols: c, replaceCols: true })}
          />
          <div className="site-job-workflow__scroll">
            <table className="site-job-workflow__paper-table site-job-workflow__dense-table site-job-workflow__stack-mobile">
              <thead>
                <tr>
                  <th>Sl.</th>
                  <th>Pkg list Sl.</th>
                  <th style={{ minWidth: "9rem" }}>Item description</th>
                  <th>Missing date</th>
                  <th>Damage date</th>
                  <th>Repair date</th>
                  <th>Handled by</th>
                  <th style={{ minWidth: "10rem" }}>Issue description</th>
                </tr>
              </thead>
              <tbody>
                {toolIssueIdx.map((ri) => {
                  const row = toolIssueLines[ri];
                  return (
                  <tr key={`ti-${row.slNo}`}>
                    <td data-label="Sl.">{row.slNo}</td>
                    {TOOL_ISSUE_CELL_FIELDS_BEFORE.map(([field, typ]) => (
                      <td key={field} data-label={TOOL_ISSUE_FIELD_LABELS[field]}>
                        <input
                          type={typ === "date" ? "date" : "text"}
                          className="form-control form-control-sm border-0 rounded-0 px-1"
                          value={row[field] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setToolIssueLines((prev) => {
                              const next = [...prev];
                              next[ri] = { ...next[ri], [field]: v };
                              return next;
                            });
                          }}
                        />
                      </td>
                    ))}
                    <td data-label="Handled by" style={{ minWidth: "11rem" }}>
                      <UserDirectoryCombobox
                        compact
                        options={employeeOptions}
                        value={directorySelectValue(row.handledByEmployeeUserId, row.handledBy, employeeOptions)}
                        placeholder="— Select user or type below —"
                        ariaLabel={`Handled by user row ${row.slNo}`}
                        onChange={(v) => {
                          setToolIssueLines((prev) => {
                            const next = [...prev];
                            if (!v) {
                              next[ri] = { ...next[ri], handledByEmployeeUserId: null };
                            } else {
                              const id = Number(v);
                              const u = employeeOptions.find((x) => x.id === id);
                              next[ri] = {
                                ...next[ri],
                                handledByEmployeeUserId: id,
                                handledBy: u?.name ?? u?.email ?? "",
                              };
                            }
                            return next;
                          });
                        }}
                      />
                      <input
                        className="form-control form-control-sm border-0 rounded-0 px-1"
                        placeholder={
                          row.handledByEmployeeUserId != null
                            ? "Linked — clear user above to type a note"
                            : "Handled by (person or note)"
                        }
                        readOnly={row.handledByEmployeeUserId != null}
                        value={row.handledBy ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setToolIssueLines((prev) => {
                            const n = [...prev];
                            n[ri] = { ...n[ri], handledBy: val, handledByEmployeeUserId: null };
                            return n;
                          });
                        }}
                      />
                    </td>
                    <td data-label="Issue description">
                      <input
                        type="text"
                        className="form-control form-control-sm border-0 rounded-0 px-1"
                        value={row.issueDescription ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setToolIssueLines((prev) => {
                            const next = [...prev];
                            next[ri] = { ...next[ri], issueDescription: v };
                            return next;
                          });
                        }}
                      />
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {currentStepIndex === 6 && (
        <div>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Challenges at site</div>
          <p className="site-job-workflow__muted small mb-2">One row per challenge head (from admin settings or the built-in list). Use <strong>Save &amp; next</strong> to save this step.</p>
          <div className="d-flex gap-2 mb-2 align-items-center flex-wrap">
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              disabled={challengeLineRows.length >= WORKFLOW_JOB_TABLE_MAX_ROWS}
              onClick={() =>
                setChallengeLineRows((prev) => {
                  if (prev.length >= WORKFLOW_JOB_TABLE_MAX_ROWS) return prev;
                  const id = nextSupplementalChallengeHeadIndex(prev);
                  return [...prev, { ...emptyChallengeLineRow(id, "Additional"), workflowSupplemental: true }];
                })
              }
            >
              Add challenge row
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              disabled={!challengeLineRows.some((r) => r.workflowSupplemental)}
              onClick={() =>
                setChallengeLineRows((prev) => {
                  for (let i = prev.length - 1; i >= 0; i -= 1) {
                    if (prev[i]?.workflowSupplemental) {
                      return [...prev.slice(0, i), ...prev.slice(i + 1)];
                    }
                  }
                  return prev;
                })
              }
            >
              Remove last added row
            </button>
          </div>
          <WorkflowSearchFilterShell
            drawerTitle="Challenges"
            search={wfChallenges.search}
            onSearchChange={(v) => patchWfFilter("challenge_lines", { search: v })}
            columnSpec={challengeColumnSpec}
            cols={wfChallenges.cols || {}}
            onApplyColumnFilters={(c) => patchWfFilter("challenge_lines", { cols: c, replaceCols: true })}
          />
          <div className="site-job-workflow__scroll">
            <table className="site-job-workflow__paper-table site-job-workflow__dense-table site-job-workflow__stack-mobile">
              <thead>
                <tr>
                  <th>Sl.</th>
                  <th style={{ minWidth: "10rem" }}>Heads</th>
                  <th>Date of incident</th>
                  <th>Involved (person / equipment)</th>
                  <th style={{ minWidth: "9rem" }}>Challenges faced</th>
                  <th style={{ minWidth: "9rem" }}>Resolved / pending / action</th>
                  <th className="text-end text-nowrap">Actions</th>
                </tr>
              </thead>
              <tbody>
                {challengeIdx.map((ri) => {
                  const row = challengeLineRows[ri];
                  return (
                  <tr key={`ch-${row.headIndex}-${ri}`}>
                    <td data-label="Sl.">{row.headIndex || ri + 1}</td>
                    <td data-label="Heads" className="small">
                      {row.workflowSupplemental ? (
                        <input
                          className="form-control form-control-sm border-0 rounded-0 px-1"
                          value={row.headLabel ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setChallengeLineRows((prev) => {
                              const next = [...prev];
                              next[ri] = { ...next[ri], headLabel: v };
                              return next;
                            });
                          }}
                        />
                      ) : (
                        row.headLabel
                      )}
                    </td>
                    <td data-label="Date of incident">
                      <input
                        type="date"
                        className="form-control form-control-sm border-0 rounded-0 px-1"
                        value={row.dateOfIncident ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setChallengeLineRows((prev) => {
                            const next = [...prev];
                            next[ri] = { ...next[ri], dateOfIncident: v };
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td data-label="Involved" style={{ minWidth: "11rem" }}>
                      <UserDirectoryCombobox
                        compact
                        options={employeeOptions}
                        value={directorySelectValue(row.involvedEmployeeUserId, row.involved, employeeOptions)}
                        placeholder="— Select user or type below —"
                        ariaLabel={`Involved user row ${row.headIndex}`}
                        onChange={(v) => {
                          setChallengeLineRows((prev) => {
                            const next = [...prev];
                            if (!v) {
                              next[ri] = { ...next[ri], involvedEmployeeUserId: null };
                            } else {
                              const id = Number(v);
                              const u = employeeOptions.find((x) => x.id === id);
                              next[ri] = {
                                ...next[ri],
                                involvedEmployeeUserId: id,
                                involved: u?.name ?? u?.email ?? "",
                              };
                            }
                            return next;
                          });
                        }}
                      />
                      <input
                        className="form-control form-control-sm border-0 rounded-0 px-1"
                        placeholder={
                          row.involvedEmployeeUserId != null
                            ? "Linked — clear user above for equipment / other text"
                            : "Involved (person / equipment)"
                        }
                        readOnly={row.involvedEmployeeUserId != null}
                        value={row.involved ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setChallengeLineRows((prev) => {
                            const n = [...prev];
                            n[ri] = { ...n[ri], involved: val, involvedEmployeeUserId: null };
                            return n;
                          });
                        }}
                      />
                    </td>
                    {[
                      ["challengesFaced", "text", "Challenges faced"],
                      ["resolutionStatus", "text", "Resolved / pending / action"],
                    ].map(([field, typ, label]) => (
                      <td key={field} data-label={label}>
                        <input
                          type={typ === "date" ? "date" : "text"}
                          className="form-control form-control-sm border-0 rounded-0 px-1"
                          value={row[field] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setChallengeLineRows((prev) => {
                              const next = [...prev];
                              next[ri] = { ...next[ri], [field]: v };
                              return next;
                            });
                          }}
                        />
                      </td>
                    ))}
                    <td data-label="" className="text-end align-middle">
                      {row.workflowSupplemental ? (
                        <button
                          type="button"
                          className="btn btn-outline-danger btn-sm py-0"
                          onClick={() => setChallengeLineRows((prev) => prev.filter((_, i) => i !== ri))}
                        >
                          Remove
                        </button>
                      ) : null}
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {currentStepIndex === 7 && (
        <div>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Site behaviour report</div>
          <p className="site-job-workflow__muted small mb-2">Tick and date when an issue applies to a member. Use <strong>Save &amp; next</strong> to save this step.</p>
          <div className="d-flex gap-2 mb-2 align-items-center flex-wrap">
            <button
              type="button"
              className="btn btn-outline-primary btn-sm"
              disabled={behaviourState.members.length >= BEHAVIOUR_MEMBER_MAX}
              onClick={() => setBehaviourState((prev) => resizeBehaviourMemberColumns(prev, prev.members.length + 1))}
            >
              Add member column
            </button>
            <button
              type="button"
              className="btn btn-outline-danger btn-sm"
              disabled={behaviourState.members.length <= BEHAVIOUR_MEMBER_MIN}
              onClick={() => setBehaviourState((prev) => resizeBehaviourMemberColumns(prev, prev.members.length - 1))}
            >
              Remove last member column
            </button>
            <span className="site-job-workflow__muted small">
              {behaviourState.members.length} member column{behaviourState.members.length !== 1 ? "s" : ""} (max {BEHAVIOUR_MEMBER_MAX})
            </span>
          </div>
          <WorkflowSearchFilterShell
            drawerTitle="Site behaviour matrix"
            search={wfBehaviour.search}
            onSearchChange={(v) => patchWfFilter("behaviour_matrix", { search: v })}
            columnSpec={behaviourMemberFilterSpec}
            cols={wfBehaviour.cols || {}}
            onApplyColumnFilters={(c) => patchWfFilter("behaviour_matrix", { cols: c, replaceCols: true })}
          />
          <p className="site-job-workflow__muted small mb-2">
            Issue search filters rows. Open <strong>Filter</strong> and expand each <strong>Member</strong> section to filter issues by that member&apos;s cell (Has mark / Has date / Empty). Use{" "}
            <strong>FILTER</strong> to apply column choices.
          </p>
          <div className="site-job-workflow__scroll mb-2">
            <table className="site-job-workflow__paper-table site-job-workflow__dense-table site-job-workflow__stack-mobile">
              <thead>
                <tr>
                  <th rowSpan={3} style={{ minWidth: "7rem", verticalAlign: "middle" }}>
                    Issue
                  </th>
                  {behaviourState.members.map((_, mi) => (
                    <th key={`mn-${mi}`} colSpan={2} className="text-center small">
                      Member {mi + 1}
                    </th>
                  ))}
                </tr>
                <tr>
                  {behaviourState.members.map((_, mi) => {
                    const linkedId = behaviourState.memberEmployeeUserIds?.[mi] ?? null;
                    return (
                      <Fragment key={`hrow-${mi}`}>
                        <th colSpan={2} className="p-0 px-1 align-top">
                          <UserDirectoryCombobox
                            compact
                            options={employeeOptions}
                            value={directorySelectValue(linkedId, behaviourState.members[mi], employeeOptions)}
                            placeholder="— Select user or type below —"
                            ariaLabel={`Member ${mi + 1} user`}
                            onChange={(v) => {
                              setBehaviourState((prev) => {
                                const members = [...prev.members];
                                const memberEmployeeUserIds = [...(prev.memberEmployeeUserIds || [])];
                                while (memberEmployeeUserIds.length < members.length) memberEmployeeUserIds.push(null);
                                if (!v) {
                                  memberEmployeeUserIds[mi] = null;
                                } else {
                                  const id = Number(v);
                                  const u = employeeOptions.find((x) => x.id === id);
                                  memberEmployeeUserIds[mi] = id;
                                  members[mi] = u?.name ?? u?.email ?? "";
                                }
                                return { ...prev, members, memberEmployeeUserIds };
                              });
                            }}
                          />
                          <input
                            className="form-control form-control-sm border-0 rounded-0 text-center"
                            placeholder={
                              linkedId != null ? "Linked name — clear user above to edit" : "Member name (custom)"
                            }
                            readOnly={linkedId != null}
                            value={behaviourState.members[mi]}
                            onChange={(e) => {
                              const val = e.target.value;
                              setBehaviourState((prev) => {
                                const members = [...prev.members];
                                const memberEmployeeUserIds = [...(prev.memberEmployeeUserIds || [])];
                                while (memberEmployeeUserIds.length < members.length) memberEmployeeUserIds.push(null);
                                members[mi] = val;
                                memberEmployeeUserIds[mi] = null;
                                return { ...prev, members, memberEmployeeUserIds };
                              });
                            }}
                          />
                        </th>
                      </Fragment>
                    );
                  })}
                </tr>
                <tr>
                  {behaviourState.members.map((_, mi) => (
                    <Fragment key={`leg-${mi}`}>
                      <th className="small text-center">✓</th>
                      <th className="small text-center">Date</th>
                    </Fragment>
                  ))}
                </tr>
              </thead>
              <tbody>
                {behaviourIssueIdx.map((ri) => {
                  const issue = BEHAVIOUR_ISSUE_ROWS[ri];
                  return (
                  <tr key={`bi-${issue.slNo}`}>
                    <td className="small" data-label="Issue">
                      <strong>{String(issue.slNo).padStart(2, "0")}</strong> {issue.label}
                    </td>
                    {behaviourState.members.map((_, ci) => {
                      const cell = behaviourState.matrix[ri]?.[ci] ?? { checked: false, date: "" };
                      const memberLabel = `Member ${ci + 1}`;
                      return (
                        <Fragment key={`cell-${ri}-${ci}`}>
                          <td className="text-center" data-label={`${memberLabel} · tick`}>
                            <input
                              type="checkbox"
                              className="form-check-input m-0"
                              checked={cell.checked}
                              onChange={(e) => {
                                const checked = e.target.checked;
                                setBehaviourState((prev) => {
                                  const matrix = prev.matrix.map((r) => r.map((c) => ({ ...c })));
                                  matrix[ri][ci] = { ...matrix[ri][ci], checked };
                                  return { ...prev, matrix };
                                });
                              }}
                            />
                          </td>
                          <td data-label={`${memberLabel} · date`}>
                            <input
                              type="date"
                              className="form-control form-control-sm border-0 rounded-0 px-0"
                              value={cell.date}
                              onChange={(e) => {
                                const v = e.target.value;
                                setBehaviourState((prev) => {
                                  const matrix = prev.matrix.map((r) => r.map((c) => ({ ...c })));
                                  matrix[ri][ci] = { ...matrix[ri][ci], date: v };
                                  return { ...prev, matrix };
                                });
                              }}
                            />
                          </td>
                        </Fragment>
                      );
                    })}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <label className="form-label small">Additional information</label>
          <textarea
            className="form-control form-control-sm"
            rows={2}
            value={behaviourState.remarks}
            onChange={(e) => setBehaviourState((prev) => ({ ...prev, remarks: e.target.value }))}
          />
        </div>
      )}

      {currentStepIndex === 8 && (
        <div>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Site team attendance register</div>
          <p className="site-job-workflow__muted small mb-2">
            Codes: <strong>P</strong> Present, <strong>A</strong> Absent, <strong>S</strong> Sick, <strong>HQ</strong> HQ duty, <strong>LS</strong> Leave/shift off, <strong>INJ</strong> Injury. Use{" "}
            <strong>Save &amp; next</strong> to save this step.
          </p>
          <div className="site-job-workflow__att-submissions site-job-workflow__panel border rounded p-2 mb-3">
            <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static site-job-workflow__section-bar--compact">
              Employee attendance (photo check-ins)
            </div>
            <p className="site-job-workflow__muted small mb-2">
              Employees submit with <strong>photo + site + shift</strong>. Rows shown here are for <strong>{site.name ?? "this site"}</strong> only. This is separate from the <strong>daily code register</strong> below (paper-style P/A/S cells).
            </p>
            <div className="d-flex flex-wrap gap-1 mb-2 site-job-workflow__att-status-tabs align-items-center">
              {["ALL", "PENDING", "APPROVED", "REJECTED"].map((tab) => (
                <button
                  key={tab}
                  type="button"
                  className={`btn btn-sm ${siteAttendanceStatusTab === tab ? "btn-primary" : "btn-outline-secondary"}`}
                  onClick={() => setSiteAttendanceStatusTab(tab)}
                >
                  {tab === "ALL" ? "All" : `${tab.charAt(0)}${tab.slice(1).toLowerCase()}`}
                </button>
              ))}
              <button
                type="button"
                className="btn btn-sm btn-outline-secondary ms-auto"
                onClick={() => refreshSiteAttendanceList()}
                disabled={siteAttendanceLoading}
              >
                Refresh
              </button>
            </div>
            <WorkflowSearchFilterShell
              drawerTitle="Photo check-ins"
              search={wfSiteAttPortal.search}
              onSearchChange={(v) => patchWfFilter("site_att_portal", { search: v })}
              columnSpec={siteAttendancePortalColumnSpec}
              cols={wfSiteAttPortal.cols || {}}
              onApplyColumnFilters={(c) => patchWfFilter("site_att_portal", { cols: c, replaceCols: true })}
            />
            {siteAttendanceError ? <div className="alert alert-danger py-2 small mb-2">{siteAttendanceError}</div> : null}
            {siteAttendanceLoading ? <p className="text-muted small mb-0">Loading attendance submissions…</p> : null}
            {!siteAttendanceLoading && siteAttendancePortalDisplay.length === 0 ? (
              <p className="text-muted small mb-0">
                No portal check-ins for this site and filter. If you only filled the code grid, use{" "}
                <strong>Add Record</strong> on the employee Attendance Portal (same site) to create rows here.
              </p>
            ) : null}
            {!siteAttendanceLoading && siteAttendancePortalDisplay.length > 0 ? (
              <div className="site-job-workflow__scroll">
                <table className="site-job-workflow__paper-table site-job-workflow__dense-table site-job-workflow__stack-mobile mb-0">
                  <thead>
                    <tr>
                      <th>Photo</th>
                      <th>Date</th>
                      <th>Employee</th>
                      <th>Shift</th>
                      <th>Site</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {siteAttendancePortalDisplay.map((req) => {
                      const ymd = attendanceRowDateYmd(req);
                      const st = attendanceRowStatus(req);
                      const dateDisp = formatYmdLocalMedium(ymd);
                      const emp = req.employeeName ?? req.user?.name ?? req.employee?.name ?? req.name ?? "—";
                      const eid = req.employeeId ?? req.user?.employeeId ?? req.employee?.employeeId ?? "";
                      const siteName = req.site?.name ?? req.siteName ?? site.name ?? "—";
                      const shiftLabel = SHIFT_LABELS[req.shift] ?? req.shift ?? "—";
                      const badgeClass =
                        st === "APPROVED"
                          ? "site-job-workflow__status-badge site-job-workflow__status-badge--approved"
                          : st === "REJECTED"
                            ? "site-job-workflow__status-badge site-job-workflow__status-badge--rejected"
                            : "site-job-workflow__status-badge site-job-workflow__status-badge--pending";
                      const rej = (req.rejectionReason ?? "").trim();
                      return (
                        <tr key={String(req.id ?? req.attendanceId ?? attendanceRowDateYmd(req))}>
                          <td data-label="Photo" className="align-middle">
                            <AttendancePhotoThumb row={req} alt={`Attendance ${dateDisp}`} />
                          </td>
                          <td data-label="Date">{dateDisp}</td>
                          <td data-label="Employee">
                            {emp}
                            {eid ? ` (${eid})` : ""}
                          </td>
                          <td data-label="Shift">{shiftLabel}</td>
                          <td data-label="Site">{siteName}</td>
                          <td data-label="Status">
                            <span className={badgeClass}>{st}</span>
                          </td>
                          <td data-label="Actions">
                            {st === "PENDING" ? (
                              <div className="d-flex gap-1 flex-wrap">
                                <button
                                  type="button"
                                  className="btn btn-success btn-sm py-0"
                                  disabled={siteAttActionId === req.id}
                                  onClick={() => handleSiteAttendanceApprove(req.id)}
                                >
                                  {siteAttActionId === req.id ? "…" : "Approve"}
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-danger btn-sm py-0"
                                  disabled={siteAttActionId === req.id}
                                  onClick={() => {
                                    setSiteAttRejectId(req.id);
                                    setSiteAttRejectReason("");
                                    setSiteAttendanceError("");
                                  }}
                                >
                                  Reject
                                </button>
                              </div>
                            ) : st === "REJECTED" && rej ? (
                              <span className="small text-muted text-truncate d-inline-block" style={{ maxWidth: "10rem" }} title={rej}>
                                {rej}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Daily register (codes)</div>
          <table className="site-job-workflow__paper-table mb-3">
            <tbody>
              <tr>
                <th>Customer</th>
                <td>{intro.clientName || site.customerName || "—"}</td>
                <th>Job code</th>
                <td>{site.jobCode ?? "—"}</td>
              </tr>
              <tr>
                <th>Site start</th>
                <td>{siteStartDisplay(site, attendanceRegister, intro)}</td>
                <th>Site end</th>
                <td>{siteEndDisplay(site, attendanceRegister, intro)}</td>
              </tr>
              <tr>
                <th>Project days</th>
                <td colSpan={3}>
                  {attendanceRegister?.totalProjectDays ?? site.totalProjectDays ?? intro.scheduledDays ?? "—"}
                  {attendanceRegister?.estimatedDays != null ? ` (est. ${attendanceRegister.estimatedDays})` : ""}
                </td>
              </tr>
            </tbody>
          </table>
          <div className="d-flex gap-2 mb-2 align-items-center flex-wrap site-job-workflow__toolbar">
            <span className="small">Period block:</span>
            <button
              type="button"
              className="btn btn-outline-secondary btn-sm"
              disabled={attendanceBlock <= 0}
              onClick={() => reloadAttendanceBlock(attendanceBlock - 1)}
            >
              Previous {DAYS_CHECKLIST} days
            </button>
            <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => reloadAttendanceBlock(attendanceBlock + 1)}>
              Next {DAYS_CHECKLIST} days
            </button>
            {attendanceRegister ? (
              <span className="site-job-workflow__muted small">
                {attendanceRegister.periodStart} → {attendanceRegister.periodEnd}
              </span>
            ) : null}
          </div>
          {attendanceRegister ? (
            <div className="d-flex gap-2 mb-2 align-items-center flex-wrap site-job-workflow__toolbar">
              <label className="small mb-0 text-nowrap" htmlFor="attendance-adhoc-user">
                Add row (user)
              </label>
              <select
                id="attendance-adhoc-user"
                className="form-select form-select-sm site-job-workflow__att-user-select"
                value={attendanceAdHocPickId}
                onChange={(e) => setAttendanceAdHocPickId(e.target.value)}
              >
                <option value="">Select…</option>
                {attendanceAddCandidates.map((u) => {
                  const id = u.id;
                  const label = [u.name, u.employeeId, u.email].filter(Boolean).join(" · ") || `User ${id}`;
                  return (
                    <option key={id} value={String(id)}>
                      {label}
                    </option>
                  );
                })}
              </select>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                disabled={!attendanceAdHocPickId}
                onClick={() => {
                  const uid = Number(attendanceAdHocPickId);
                  if (!Number.isFinite(uid) || !attendanceRegister) return;
                  const exists = (attendanceRegister.rows || []).some((r) => Number(r.employeeId) === uid);
                  if (exists) return;
                  const dayN = (attendanceRegister.dayDates || []).length;
                  const u = employeeOptions.find((x) => Number(x.id) === uid);
                  const name = u?.name || u?.email || `User ${uid}`;
                  setAttendanceRegister((reg) => ({
                    ...reg,
                    rows: [
                      ...(reg.rows || []).map((r, i) => ({ ...r, slNo: i + 1 })),
                      {
                        employeeId: uid,
                        employeeName: name,
                        slNo: (reg.rows || []).length + 1,
                        dayCodes: Array.from({ length: dayN }, () => ""),
                        _adHocAttendance: true,
                      },
                    ],
                  }));
                  setAttendanceAdHocPickId("");
                }}
              >
                Add row
              </button>
              <button
                type="button"
                className="btn btn-outline-danger btn-sm"
                disabled={!(attendanceRegister.rows || []).some((r) => r._adHocAttendance)}
                onClick={() => {
                  setAttendanceRegister((reg) => {
                    const rows = [...(reg.rows || [])];
                    for (let i = rows.length - 1; i >= 0; i -= 1) {
                      if (rows[i]._adHocAttendance) {
                        rows.splice(i, 1);
                        return { ...reg, rows: rows.map((r, j) => ({ ...r, slNo: j + 1 })) };
                      }
                    }
                    return reg;
                  });
                }}
              >
                Remove last added row
              </button>
            </div>
          ) : null}
          <p className="site-job-workflow__muted small mb-2">
            Rows follow the site roster. Rows you add here stay on this screen until you reload the page.
          </p>
          {!attendanceRegister ? (
            <p className="text-muted">No register data returned for this site.</p>
          ) : (
            <>
              <WorkflowSearchFilterShell
                drawerTitle="Daily register (codes)"
                search={wfAttReg.search}
                onSearchChange={(v) => patchWfFilter("attendance_register", { search: v })}
                columnSpec={attRegColumnSpec}
                cols={wfAttReg.cols || {}}
                onApplyColumnFilters={(c) => patchWfFilter("attendance_register", { cols: c, replaceCols: true })}
              />
            <div className="site-job-workflow__scroll">
              <table className="site-job-workflow__paper-table site-job-workflow__stack-mobile">
                <thead>
                  <tr>
                    <th>Sl.</th>
                    <th>Name</th>
                    {(attendanceRegister.dayDates || []).map((d) => (
                      <th key={d} className="site-job-workflow__day-cell" title={d}>
                        {d?.slice?.(5) ?? d}
                      </th>
                    ))}
                    <th className="text-end text-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {attRegIdx.map((ri) => {
                    const row = attRegRows[ri];
                    return (
                    <tr key={row.employeeId ?? ri}>
                      <td data-label="Sl.">{row.slNo ?? ri + 1}</td>
                      <td data-label="Name">{row.employeeName}</td>
                      {(row.dayCodes || []).map((code, di) => {
                        const date = attendanceRegister.dayDates?.[di];
                        const key = `${row.employeeId}|${date}`;
                        const rawDisplay = attendanceDirtyCells.has(key) ? attendanceDirtyCells.get(key) : code || "";
                        const display = normalizeRegisterCellCodeForUi(rawDisplay);
                        const dayHeading = date?.slice?.(5) ?? date ?? `Day ${di + 1}`;
                        return (
                          <td key={key} className="site-job-workflow__day-cell" data-label={`Code ${dayHeading}`}>
                            <select
                              className="site-job-workflow__att-code-select"
                              aria-label={`Attendance code ${row.employeeName ?? row.employeeId} ${date ?? di}`}
                              value={display}
                              onChange={(e) => {
                                const v = e.target.value;
                                setAttendanceDirtyCells((prev) => {
                                  const next = new Map(prev);
                                  next.set(key, v);
                                  return next;
                                });
                              }}
                            >
                              {REGISTER_ATT_CODES.map((c) => (
                                <option key={c || "e"} value={c}>
                                  {c || "—"}
                                </option>
                              ))}
                            </select>
                          </td>
                        );
                      })}
                      <td data-label="" className="text-end align-middle">
                        {row._adHocAttendance ? (
                          <button
                            type="button"
                            className="btn btn-outline-danger btn-sm py-0"
                            onClick={() =>
                              setAttendanceRegister((reg) => {
                                const rows = [...(reg.rows || [])];
                                if (!rows[ri]?._adHocAttendance) return reg;
                                rows.splice(ri, 1);
                                return { ...reg, rows: rows.map((r, j) => ({ ...r, slNo: j + 1 })) };
                              })
                            }
                          >
                            Remove
                          </button>
                        ) : null}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            </>
          )}
          {siteAttRejectId != null ? (
            <div className="admin-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="site-workflow-att-reject-title">
              <div className="admin-modal">
                <h3 id="site-workflow-att-reject-title" className="h6 mb-2">
                  Reject attendance request
                </h3>
                <p className="small text-muted mb-2">Optionally provide a reason. The employee may see it.</p>
                <textarea
                  className="form-control mb-2"
                  placeholder="Rejection reason (optional)"
                  value={siteAttRejectReason}
                  onChange={(e) => setSiteAttRejectReason(e.target.value)}
                  rows={3}
                />
                <div className="d-flex gap-2 justify-content-end">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => {
                      if (siteAttActionId === siteAttRejectId) return;
                      setSiteAttRejectId(null);
                      setSiteAttRejectReason("");
                    }}
                    disabled={siteAttActionId === siteAttRejectId}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => handleSiteAttendanceRejectSubmit()}
                    disabled={siteAttActionId === siteAttRejectId}
                  >
                    {siteAttActionId === siteAttRejectId ? "Rejecting…" : "Reject"}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {currentStepIndex === 9 && (
        <div>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Work completion &amp; customer feedback</div>
          <table className="site-job-workflow__paper-table mb-3">
            <tbody>
              <tr>
                <th>Certificate status</th>
                <td>{site.certificateClientStatus ?? "—"}</td>
              </tr>
              <tr>
                <th>Feedback approved at</th>
                <td>{site.customerFeedbackApprovedAt ?? "—"}</td>
              </tr>
            </tbody>
          </table>
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Customer feedback (read-only)</div>
          <p className="site-job-workflow__muted small mb-2">
            Share the link below with your customer. Submissions do not require a login. After they submit, use <strong>Refresh feedback</strong> (or leave and re-open this step) to load the latest.
          </p>
          <div className="d-flex flex-wrap gap-2 align-items-start mb-3">
            <div className="flex-grow-1" style={{ minWidth: "12rem" }}>
              <label className="form-label small text-muted mb-0">Public feedback page (share with client)</label>
              <input
                type="text"
                className="form-control form-control-sm"
                readOnly
                value={customerFeedbackShareUrl}
              />
            </div>
            <div className="d-flex align-items-end gap-2 flex-wrap">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                onClick={() => {
                  const url = customerFeedbackShareUrl;
                  void navigator.clipboard.writeText(url).then(
                    () => showSuccess?.("Public feedback link copied."),
                    () => showSuccess?.("Copy this link manually: " + url),
                  );
                }}
              >
                Copy link
              </button>
              <button
                type="button"
                className="btn btn-outline-primary btn-sm"
                onClick={() => {
                  void refreshCustomerFeedback().then(() => showSuccess?.("Customer feedback refreshed."));
                }}
              >
                Refresh feedback
              </button>
            </div>
          </div>
          {!customerFeedbackHasInviteToken && isPublicCustomerFeedbackTokenRequired() ? (
            <p className="small text-warning mb-3">
              No invite token found — this build expects <code>?token=…</code> in the public URL and the same token in the POST body. Expose a token on{" "}
              <strong>GET /api/admin/sites/&#123;id&#125;</strong> (e.g. <code>customerFeedbackInviteToken</code>) or on{" "}
              <strong>GET /api/admin/sites/&#123;id&#125;/customer-feedback</strong> (e.g. <code>token</code> on the invite DTO), or paste a token from your invite flow into a custom link.
            </p>
          ) : null}
          {customerFeedbackParsed ? (
            <div className="row g-2 mb-3">
              <div className="col-md-6">
                <label className="form-label small text-muted">Name</label>
                <input className="form-control form-control-sm" readOnly value={customerFeedbackParsed.name} />
              </div>
              <div className="col-md-6">
                <label className="form-label small text-muted">Company</label>
                <input className="form-control form-control-sm" readOnly value={customerFeedbackParsed.companyName} />
              </div>
              <div className="col-md-6">
                <label className="form-label small text-muted">Email</label>
                <input className="form-control form-control-sm" readOnly value={customerFeedbackParsed.email} />
              </div>
              <div className="col-md-6">
                <label className="form-label small text-muted">Phone</label>
                <input className="form-control form-control-sm" readOnly value={customerFeedbackParsed.phone} />
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted">Product quality</label>
                <input className="form-control form-control-sm" readOnly value={customerFeedbackParsed.productQuality} />
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted">Customer service</label>
                <input className="form-control form-control-sm" readOnly value={customerFeedbackParsed.customerService} />
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted">Machining quality</label>
                <input className="form-control form-control-sm" readOnly value={customerFeedbackParsed.machiningQuality} />
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted">Pricing</label>
                <input className="form-control form-control-sm" readOnly value={customerFeedbackParsed.pricing} />
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted">Shipping / delivery</label>
                <input className="form-control form-control-sm" readOnly value={customerFeedbackParsed.shippingDelivery} />
              </div>
              <div className="col-md-4">
                <label className="form-label small text-muted">Likelihood to recommend (0–10)</label>
                <input className="form-control form-control-sm" readOnly value={customerFeedbackParsed.likelihoodRecommend} />
              </div>
              <div className="col-12">
                <label className="form-label small text-muted">Other category note</label>
                <input className="form-control form-control-sm" readOnly value={customerFeedbackParsed.otherCategoryNote} />
              </div>
              <div className="col-12">
                <label className="form-label small text-muted">Specific feedback</label>
                <textarea className="form-control form-control-sm" rows={2} readOnly value={customerFeedbackParsed.specificFeedback} />
              </div>
              <div className="col-12">
                <label className="form-label small text-muted">Suggestions</label>
                <textarea className="form-control form-control-sm" rows={2} readOnly value={customerFeedbackParsed.suggestions} />
              </div>
              <div className="col-12">
                <label className="form-label small text-muted">Additional comments</label>
                <textarea className="form-control form-control-sm" rows={2} readOnly value={customerFeedbackParsed.additionalComments} />
              </div>
              <div className="col-12">
                <details className="small">
                  <summary className="fw-semibold" style={{ cursor: "pointer" }}>
                    Raw feedback JSON
                  </summary>
                  <pre className="small bg-light p-2 border rounded mt-1 mb-0" style={{ maxHeight: "160px", overflow: "auto" }}>
                    {customerFeedbackParsed.rawJson}
                  </pre>
                </details>
              </div>
            </div>
          ) : (
            <p className="text-muted small mb-3">
              No customer feedback record yet for this site. If the client already submitted, press <strong>Refresh feedback</strong> above.
            </p>
          )}
          <div className="site-job-workflow__section-bar site-job-workflow__section-bar--static">Certificate draft (saved in wizard)</div>
          <div className="row g-2">
            <div className="col-md-6">
              <label className="form-label small">Recipient / contractor name</label>
              <input
                className="form-control form-control-sm"
                value={cert.recipientName ?? ""}
                onChange={(e) =>
                  updateWizard({ certificateDraft: { ...cert, recipientName: e.target.value } })
                }
              />
            </div>
            <div className="col-12">
              <label className="form-label small">Project / task description</label>
              <input
                className="form-control form-control-sm"
                value={cert.projectDescription ?? ""}
                onChange={(e) =>
                  updateWizard({ certificateDraft: { ...cert, projectDescription: e.target.value } })
                }
              />
            </div>
            <div className="col-md-6">
              <label className="form-label small">Duration from</label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={cert.durationFrom ?? ""}
                onChange={(e) =>
                  updateWizard({ certificateDraft: { ...cert, durationFrom: e.target.value } })
                }
              />
            </div>
            <div className="col-md-6">
              <label className="form-label small">Duration to</label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={cert.durationTo ?? ""}
                onChange={(e) =>
                  updateWizard({ certificateDraft: { ...cert, durationTo: e.target.value } })
                }
              />
            </div>
            <div className="col-md-4">
              <label className="form-label small">Responsibility 1</label>
              <input
                className="form-control form-control-sm"
                value={cert.responsibility1 ?? ""}
                onChange={(e) =>
                  updateWizard({ certificateDraft: { ...cert, responsibility1: e.target.value } })
                }
              />
            </div>
            <div className="col-md-4">
              <label className="form-label small">Responsibility 2</label>
              <input
                className="form-control form-control-sm"
                value={cert.responsibility2 ?? ""}
                onChange={(e) =>
                  updateWizard({ certificateDraft: { ...cert, responsibility2: e.target.value } })
                }
              />
            </div>
            <div className="col-md-4">
              <label className="form-label small">Responsibility 3</label>
              <input
                className="form-control form-control-sm"
                value={cert.responsibility3 ?? ""}
                onChange={(e) =>
                  updateWizard({ certificateDraft: { ...cert, responsibility3: e.target.value } })
                }
              />
            </div>
            <div className="col-12">
              <label className="form-label small">Achievements</label>
              <textarea
                className="form-control form-control-sm"
                rows={2}
                value={cert.achievements ?? ""}
                onChange={(e) =>
                  updateWizard({ certificateDraft: { ...cert, achievements: e.target.value } })
                }
              />
            </div>
            <div className="col-12">
              <label className="form-label small">Remarks</label>
              <textarea
                className="form-control form-control-sm"
                rows={2}
                value={cert.remarks ?? ""}
                onChange={(e) => updateWizard({ certificateDraft: { ...cert, remarks: e.target.value } })}
              />
            </div>
            <div className="col-md-6">
              <label className="form-label small">Date of completion</label>
              <input
                type="date"
                className="form-control form-control-sm"
                value={cert.completionDate ?? ""}
                onChange={(e) =>
                  updateWizard({ certificateDraft: { ...cert, completionDate: e.target.value } })
                }
              />
            </div>
            <div className="col-md-4">
              <label className="form-label small">Authorized signatory — name</label>
              <input
                className="form-control form-control-sm"
                value={cert.signatoryName ?? ""}
                onChange={(e) =>
                  updateWizard({ certificateDraft: { ...cert, signatoryName: e.target.value } })
                }
              />
            </div>
            <div className="col-md-4">
              <label className="form-label small">Signatory — position / title</label>
              <input
                className="form-control form-control-sm"
                value={cert.signatoryTitle ?? ""}
                onChange={(e) =>
                  updateWizard({ certificateDraft: { ...cert, signatoryTitle: e.target.value } })
                }
              />
            </div>
            <div className="col-md-4">
              <label className="form-label small">Signatory — company</label>
              <input
                className="form-control form-control-sm"
                value={cert.signatoryCompany ?? ""}
                onChange={(e) =>
                  updateWizard({ certificateDraft: { ...cert, signatoryCompany: e.target.value } })
                }
              />
            </div>
          </div>
        </div>
      )}

            </>
          ) : null}
        </div>
      </div>

      <div className="site-job-workflow__nav-footer">
        <button type="button" className="btn btn-outline-secondary" onClick={onExit} disabled={saving}>
          Back to dashboard
        </button>
        <div className="d-flex gap-2 site-job-workflow__nav-actions">
          <button type="button" className="btn btn-outline-primary" disabled={saving || currentStepIndex === 0} onClick={handleBack}>
            Previous step
          </button>
          <button type="button" className="btn btn-primary" disabled={saving} onClick={handleNext}>
            {saving ? "Saving…" : currentStepIndex >= STEPS.length - 1 ? "Save & finish" : "Save & next"}
          </button>
        </div>
      </div>
    </section>
  );
}
