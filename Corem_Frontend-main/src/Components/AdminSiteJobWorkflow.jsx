import { useCallback, useEffect, Fragment, useMemo, useRef, useState } from "react";
import { refreshAccessToken } from "../utils/refreshAccessToken";
import { API_BASE_URL as BASE_URL } from "../config/apiBaseUrl.js";
import {
  CHECKLIST_KEY_TO_LABEL,
  TOOL_MARK_DAYS,
  calendarDayForCell,
  defaultToolCategories,
  emptyItem,
  formatYearMonthHeading,
  getMachineryChecklistKey,
  getSeededToolChecklistCategories,
  isToolChecklistEmptyForAutoSeed,
  normalizeToolChecklistFromWizard,
  padMarksForMonth,
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
  emptyTechnicianPaymentRow,
  emptyToolIssueRow,
  normalizeAdvanceLines,
  normalizeTechnicianPaymentLines,
  normalizeToolIssueLines,
  parseBehaviourReport,
  parseCustomerFeedbackRecord,
  resizeBehaviourMemberColumns,
  serializeBehaviourReport,
  stripChallengeLineForApi,
} from "../data/siteJobWorkflowForms.js";
import UserDirectoryCombobox from "./UserDirectoryCombobox.jsx";
import { directorySelectValue } from "../utils/userDirectoryDisplay.js";
import { buildAdminAttendanceQuery, parseAdminAttendancePage } from "../utils/adminAttendanceQuery.js";
import AttendancePhotoThumb from "./AttendancePhotoThumb.jsx";

const WIZARD_VERSION = 1;
/** Attendance register API uses 15-day blocks (unchanged). */
const DAYS_CHECKLIST = 15;
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
  { id: "toolIssues", title: "Tools missing / damage / repair" },
  { id: "challenges", title: "Challenges at site" },
  { id: "behaviour", title: "Site behaviour report" },
  { id: "attendance", title: "Attendance register" },
  { id: "completion", title: "Completion & feedback" },
];

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

/** Pick a short key for a new checklist section (A–Z, then Cat1, Cat2, …). */
function nextToolCategoryKey(categories) {
  const used = new Set((categories || []).map((c) => String(c.key)));
  for (let code = 65; code <= 90; code += 1) {
    const k = String.fromCharCode(code);
    if (!used.has(k)) return k;
  }
  let n = 1;
  while (used.has(`Cat${n}`)) n += 1;
  return `Cat${n}`;
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

export default function AdminSiteJobWorkflow({ siteId, showSuccess, onExit }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
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
  const [challengeLineRows, setChallengeLineRows] = useState(() => buildChallengeLineWorkflowState([], CHALLENGE_HEADS_FALLBACK));
  const [attendanceAdHocPickId, setAttendanceAdHocPickId] = useState("");
  const [siteAttendanceRecords, setSiteAttendanceRecords] = useState([]);
  const [siteAttendanceLoading, setSiteAttendanceLoading] = useState(false);
  const [siteAttendanceError, setSiteAttendanceError] = useState("");
  const [siteAttendanceStatusTab, setSiteAttendanceStatusTab] = useState("ALL");
  const [siteAttRejectId, setSiteAttRejectId] = useState(null);
  const [siteAttRejectReason, setSiteAttRejectReason] = useState("");
  const [siteAttActionId, setSiteAttActionId] = useState(null);
  const [employeeOptions, setEmployeeOptions] = useState([]);
  const wizardDataRef = useRef(wizardData);
  wizardDataRef.current = wizardData;

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
        const sidNum = Number(siteId);
        for (const row of list) {
          const rowSite = row?.siteId ?? row?.site?.id;
          if (rowSite != null && Number(rowSite) !== sidNum) continue;
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
      setSiteAttendanceError(e?.message || "Failed to load attendance submissions for this site.");
      setSiteAttendanceRecords([]);
    }
    setSiteAttendanceLoading(false);
  }, [siteId]);

  useEffect(() => {
    if (currentStepIndex !== 7 || !siteId) return undefined;
    refreshSiteAttendanceList();
    return undefined;
  }, [currentStepIndex, siteId, refreshSiteAttendanceList]);

  const loadAll = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    setError("");
    const authHeader = getAuthHeader();
    if (!authHeader) {
      setError("Not authenticated.");
      setLoading(false);
      return;
    }
    try {
      const siteRes = await adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}`);
      if (!siteRes.res.ok || !siteRes.data?.success) {
        setError(siteRes.data?.message || "Failed to load site.");
        setLoading(false);
        return;
      }
      const sitePayload = siteRes.data.data || {};
      setSite(sitePayload);

      const wizRes = await adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}/wizard`);
      let parsed = { step: 1, data: { version: WIZARD_VERSION } };
      if (wizRes.res.ok && wizRes.data?.success && wizRes.data.data != null) {
        parsed = parseWizardPayload(wizRes.data.data);
      }
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
      setWizardData(merged);

      const headsRes = await adminFetchJson(`${BASE_URL}/api/meta/challenge-line-heads`);
      const headsFromApi =
        headsRes.res.ok && headsRes.data?.success && Array.isArray(headsRes.data.data) && headsRes.data.data.length > 0
          ? headsRes.data.data
          : CHALLENGE_HEADS_FALLBACK;

      const [adv, tech, issues, chall, beh, reg, fb, mach, emp] = await Promise.all([
        adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}/job-data/advance-expense-lines`),
        adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}/job-data/technician-payments`),
        adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}/job-data/tool-issues`),
        adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}/job-data/challenge-lines`),
        adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}/job-data/behaviour-report`),
        adminFetchJson(
          `${BASE_URL}/api/admin/sites/${siteId}/attendance-register?blockIndex=0&daysPerBlock=${DAYS_CHECKLIST}`,
        ),
        adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}/customer-feedback`),
        adminFetchJson(`${BASE_URL}/api/admin/machinery?siteId=${siteId}`),
        adminFetchJson(`${BASE_URL}/api/admin/users?page=0&size=${USER_DIRECTORY_PAGE_SIZE}`),
      ]);

      const advArr = Array.isArray(adv.data?.data) ? adv.data.data : [];
      const techArr = Array.isArray(tech.data?.data) ? tech.data.data : [];
      const issArr = Array.isArray(issues.data?.data) ? issues.data.data : [];
      const chArr = Array.isArray(chall.data?.data) ? chall.data.data : [];
      setAdvanceLines(normalizeAdvanceLines(advArr));
      setTechnicianPaymentLines(normalizeTechnicianPaymentLines(techArr));
      setToolIssueLines(normalizeToolIssueLines(issArr));
      setChallengeLineRows(buildChallengeLineWorkflowState(chArr, headsFromApi));

      let br = "{}";
      if (beh.res.ok && beh.data?.success && beh.data.data != null) {
        br = typeof beh.data.data === "string" ? beh.data.data : JSON.stringify(beh.data.data ?? {}, null, 0);
      }
      setBehaviourState(parseBehaviourReport(br));

      if (reg.res.ok && reg.data?.success && reg.data.data) setAttendanceRegister(reg.data.data);
      else setAttendanceRegister(null);

      if (fb.res.ok && fb.data?.success) setCustomerFeedback(fb.data.data);
      else setCustomerFeedback(null);

      if (mach.res.ok && mach.data?.success && Array.isArray(mach.data.data)) setMachineryList(mach.data.data);
      else setMachineryList([]);

      if (emp.res.ok && emp.data?.success) {
        const root = emp.data.data;
        const rawList = Array.isArray(root?.content) ? root.content : Array.isArray(root) ? root : [];
        const list = [...rawList].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
        setEmployeeOptions(list);
      } else {
        setEmployeeOptions([]);
      }

      const uiStep = Math.min(Math.max(parsed.step - 1, 0), STEPS.length - 1);
      setCurrentStepIndex(uiStep);
      setAttendanceBlock(0);
      setAttendanceDirtyCells(new Map());
    } catch (e) {
      setError(e?.message || "Failed to load workflow.");
    }
    setLoading(false);
  }, [siteId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

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

  const persistWizard = useCallback(async (nextStep1Based, dataSnapshot) => {
    const snapshot = dataSnapshot ?? wizardDataRef.current;
    const body = {
      step: nextStep1Based,
      data: { ...snapshot },
    };
    const { res, data } = await adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}/wizard`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok || data?.success === false) throw new Error(data?.message || "Failed to save wizard.");
    if (data?.data != null) {
      const parsed = parseWizardPayload(data.data);
      setWizardData((prev) => ({ ...prev, ...parsed.data }));
    } else {
      setWizardData(body.data);
    }
    return true;
  }, [siteId]);

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
        setSiteAttendanceError(e?.message || "Failed to approve.");
      }
      setSiteAttActionId(null);
    },
    [refreshSiteAttendanceList, showSuccess],
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
      setSiteAttendanceError(e?.message || "Failed to reject.");
    }
    setSiteAttActionId(null);
  }, [siteAttRejectId, siteAttRejectReason, refreshSiteAttendanceList, showSuccess]);

  const handleNext = async () => {
    setSaving(true);
    setError("");
    try {
      const nextIdx = Math.min(currentStepIndex + 1, STEPS.length - 1);
      const nextStep1Based = nextIdx + 1;

      if (currentStepIndex <= 2) {
        await persistWizard(nextStep1Based, wizardDataRef.current);
      } else if (currentStepIndex === 3) {
        const advPayload = advanceLines;
        const techPayload = technicianPaymentLines;
        if (!Array.isArray(advPayload)) throw new Error("Advance lines invalid.");
        if (!Array.isArray(techPayload)) throw new Error("Technician payments invalid.");
        const { res: r1, data: d1 } = await adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}/job-data/advance-expense-lines`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(advPayload),
        });
        if (!r1.ok || d1?.success === false) throw new Error(d1?.message || "Failed to save advance lines.");
        const { res: r2, data: d2 } = await adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}/job-data/technician-payments`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(techPayload),
        });
        if (!r2.ok || d2?.success === false) throw new Error(d2?.message || "Failed to save technician payments.");
        await persistWizard(nextStep1Based, wizardDataRef.current);
      } else if (currentStepIndex === 4) {
        const issuesPayload = toolIssueLines;
        if (!Array.isArray(issuesPayload)) throw new Error("Tool issues invalid.");
        const { res, data } = await adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}/job-data/tool-issues`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(issuesPayload),
        });
        if (!res.ok || data?.success === false) throw new Error(data?.message || "Failed to save tool issues.");
        await persistWizard(nextStep1Based, wizardDataRef.current);
      } else if (currentStepIndex === 5) {
        const challPayload = challengeLineRows.map(stripChallengeLineForApi);
        if (!Array.isArray(challPayload)) throw new Error("Challenge lines invalid.");
        const { res, data } = await adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}/job-data/challenge-lines`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(challPayload),
        });
        if (!res.ok || data?.success === false) throw new Error(data?.message || "Failed to save challenges.");
        await persistWizard(nextStep1Based, wizardDataRef.current);
      } else if (currentStepIndex === 6) {
        const parsed = serializeBehaviourReport(behaviourState);
        const { res, data } = await adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}/job-data/behaviour-report`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(parsed),
        });
        if (!res.ok || data?.success === false) throw new Error(data?.message || "Failed to save behaviour report.");
        await persistWizard(nextStep1Based, wizardDataRef.current);
      } else if (currentStepIndex === 7) {
        const cells = [];
        attendanceDirtyCells.forEach((code, key) => {
          const [employeeUserId, date] = key.split("|");
          if (!employeeUserId || !date || !code) return;
          cells.push({ employeeUserId: Number(employeeUserId), date, code });
        });
        if (cells.length > 0) {
          const { res, data } = await adminFetchJson(`${BASE_URL}/api/admin/sites/${siteId}/job-data/attendance-register-cells`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cells }),
          });
          if (!res.ok || data?.success === false) throw new Error(data?.message || "Failed to save attendance cells.");
        }
        setAttendanceDirtyCells(new Map());
        await persistWizard(nextStep1Based, wizardDataRef.current);
      } else {
        await persistWizard(nextStep1Based, wizardDataRef.current);
      }

      setCurrentStepIndex(nextIdx);
      showSuccess?.("Saved.");
      if (currentStepIndex === 7) {
        const regRes = await adminFetchJson(
          `${BASE_URL}/api/admin/sites/${siteId}/attendance-register?blockIndex=${attendanceBlock}&daysPerBlock=${DAYS_CHECKLIST}`,
        );
        if (regRes.res.ok && regRes.data?.success) setAttendanceRegister(regRes.data.data);
      }
    } catch (e) {
      setError(e?.message || "Save failed.");
    }
    setSaving(false);
  };

  const handleBack = () => {
    setCurrentStepIndex((i) => Math.max(0, i - 1));
  };

  const reloadAttendanceBlock = async (block) => {
    const { res, data } = await adminFetchJson(
      `${BASE_URL}/api/admin/sites/${siteId}/attendance-register?blockIndex=${block}&daysPerBlock=${DAYS_CHECKLIST}`,
    );
    if (res.ok && data?.success) {
      setAttendanceRegister(data.data);
      setAttendanceBlock(block);
      setAttendanceDirtyCells(new Map());
    }
  };

  const updateWizard = (patch) => {
    setWizardData((prev) => ({ ...prev, ...patch }));
  };

  const customerFeedbackParsed = useMemo(
    () => (customerFeedback ? parseCustomerFeedbackRecord(customerFeedback) : null),
    [customerFeedback],
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
  const toolChecklist = wizardData.toolChecklist || { categories: defaultToolCategories() };
  const cert = wizardData.certificateDraft || {};

  return (
    <section className="dashboard-section site-job-workflow">
      <div className="site-job-workflow__header">
        <div>
          <h2 className="section-title mb-1">Site job workflow</h2>
          <p className="site-job-workflow__muted mb-0">
            {site.name} · Step {currentStepIndex + 1} of {STEPS.length}
          </p>
        </div>
        <div className="site-job-workflow__job-box" title="Job code">
          <div className="small text-muted">JOB CODE</div>
          <div>{site.jobCode ?? "—"}</div>
        </div>
      </div>

      <div className="site-job-workflow__stepper" aria-label="Workflow steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            type="button"
            className={`site-job-workflow__step-pill ${i === currentStepIndex ? "site-job-workflow__step-pill--active" : ""} ${
              i < currentStepIndex ? "site-job-workflow__step-pill--done" : ""
            }`}
            aria-current={i === currentStepIndex ? "step" : undefined}
            title={`Go to step ${i + 1}: ${s.title}`}
            onClick={() => setCurrentStepIndex(i)}
          >
            {i + 1}. {s.title}
          </button>
        ))}
      </div>

      {error ? <div className="alert alert-danger py-2 mb-3">{error}</div> : null}

      <div className="site-job-workflow__step-panel">
      {currentStepIndex === 0 && (
        <div>
          <h3 className="site-job-workflow__form-title">Project introduction</h3>
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
          <h4 className="h6 fw-bold">Proposed equipment</h4>
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
                {intro.proposedEquipment?.map((row, idx) => (
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
                ))}
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
          <h4 className="h6 fw-bold">Description of the job</h4>
          <textarea
            className="form-control mb-3"
            rows={2}
            value={intro.jobDescription}
            onChange={(e) => updateWizard({ projectIntroduction: { ...intro, jobDescription: e.target.value } })}
          />
          <h4 className="h6 fw-bold">Dimensional details</h4>
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
                {intro.dimensionalRows?.map((row, idx) => (
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
                ))}
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
              <h4 className="h6 fw-bold">Mobilization schedule</h4>
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
                    {intro.mobilization?.map((row, idx) => (
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
                    ))}
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
              <h4 className="h6 fw-bold">Site team members</h4>
              <p className="site-job-workflow__muted small mb-1">
                Pick a user from the directory (same users as User Management, up to {USER_DIRECTORY_PAGE_SIZE} loaded), or choose Unlink to type a custom name.
              </p>
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
                    {intro.teamMembers?.map((row, idx) => (
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
                                ? "Linked name — click Unlink to type a custom name"
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
                          {row.employeeUserId != null ? (
                            <button
                              type="button"
                              className="btn btn-link btn-sm p-0 mt-1"
                              onClick={() => {
                                const next = [...(intro.teamMembers || [])];
                                next[idx] = { ...row, employeeUserId: null };
                                updateWizard({ projectIntroduction: { ...intro, teamMembers: next } });
                              }}
                            >
                              Unlink user (edit name manually)
                            </button>
                          ) : null}
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
                    ))}
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
          <h3 className="site-job-workflow__form-title">Engineering procedure</h3>
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
                {(eng.rows || []).map((row, idx) => (
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
                ))}
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
          <h3 className="site-job-workflow__form-title">Daily checklist — tools (by category)</h3>
          <p className="site-job-workflow__muted mb-2">
            Month grid: days <strong>01–15</strong> and <strong>16–31</strong> (same layout as the paper form). The heading above the numbered columns comes from{" "}
            <strong>Tools checklist month</strong> on Project introduction, or the current calendar month if that field is left blank.
          </p>
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
          {(() => {
            const toolsMonthHeading =
              formatYearMonthHeading(intro.toolsChecklistMonth) || formatYearMonthHeading(currentYearMonth());
            const blockCols = toolDayBlockLength(toolDayBlock);
            const markStart = toolDayBlockStartCol(toolDayBlock);
            return toolChecklist.categories?.map((cat, ci) => (
              <div key={cat.key} className="mb-4">
                <div className="site-job-workflow__category-row">
                  <table className="site-job-workflow__paper-table mb-0">
                    <tbody>
                      <tr className="site-job-workflow__category-row">
                        <td colSpan={6 + blockCols}>
                          {cat.key}. {cat.label}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="site-job-workflow__scroll">
                  <table className="site-job-workflow__paper-table site-job-workflow__stack-mobile">
                    <thead>
                      <tr>
                        <th colSpan={5} />
                        <th colSpan={blockCols} className="text-center site-job-workflow__month-banner">
                          {toolsMonthHeading}
                        </th>
                      </tr>
                      <tr>
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
                      {cat.items?.map((item, ii) => (
                        <tr key={`${cat.key}-${ii}`}>
                          <td data-label="Sl.">{ii + 1}</td>
                          <td data-label="Item description">
                            <input
                              value={item.description}
                              onChange={(e) => {
                                const categories = [...(toolChecklist.categories || [])];
                                const items = [...(categories[ci].items || [])];
                                items[ii] = { ...item, description: e.target.value };
                                categories[ci] = { ...categories[ci], items };
                                updateWizard({ toolChecklist: { categories } });
                              }}
                            />
                          </td>
                          <td data-label="UOM">
                            <input
                              value={item.uom}
                              onChange={(e) => {
                                const categories = [...(toolChecklist.categories || [])];
                                const items = [...(categories[ci].items || [])];
                                items[ii] = { ...item, uom: e.target.value };
                                categories[ci] = { ...categories[ci], items };
                                updateWizard({ toolChecklist: { categories } });
                              }}
                            />
                          </td>
                          <td data-label="Qty">
                            <input
                              value={item.qty}
                              onChange={(e) => {
                                const categories = [...(toolChecklist.categories || [])];
                                const items = [...(categories[ci].items || [])];
                                items[ii] = { ...item, qty: e.target.value };
                                categories[ci] = { ...categories[ci], items };
                                updateWizard({ toolChecklist: { categories } });
                              }}
                            />
                          </td>
                          <td data-label="Date">
                            <input
                              type="date"
                              className="form-control form-control-sm"
                              value={coerceToolItemDateToIsoInput(item.itemDate)}
                              onChange={(e) => {
                                const categories = [...(toolChecklist.categories || [])];
                                const items = [...(categories[ci].items || [])];
                                items[ii] = { ...item, itemDate: e.target.value };
                                categories[ci] = { ...categories[ci], items };
                                updateWizard({ toolChecklist: { categories } });
                              }}
                            />
                          </td>
                          {padMarksForMonth(item.marks)
                            .slice(markStart, markStart + blockCols)
                            .map((mark, di) => {
                              const globalIdx = markStart + di;
                              const dayNum = calendarDayForCell(toolDayBlock, di);
                              const checked = String(mark ?? "").trim() === "✓";
                              return (
                                <td
                                  key={`${cat.key}-${ii}-d-${globalIdx}`}
                                  className="site-job-workflow__day-cell"
                                  data-label={`Day ${String(dayNum).padStart(2, "0")} (${toolsMonthHeading})`}
                                >
                                  <input
                                    type="checkbox"
                                    className="site-job-workflow__day-check"
                                    checked={checked}
                                    title={`Day ${String(dayNum).padStart(2, "0")} — tick if available`}
                                    onChange={(e) => {
                                      const categories = [...(toolChecklist.categories || [])];
                                      const items = [...(categories[ci].items || [])];
                                      const marks = padMarksForMonth(items[ii].marks);
                                      marks[globalIdx] = e.target.checked ? "✓" : "";
                                      items[ii] = { ...items[ii], marks };
                                      categories[ci] = { ...categories[ci], items };
                                      updateWizard({ toolChecklist: { categories } });
                                    }}
                                  />
                                </td>
                              );
                            })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm mt-1"
                  onClick={() => {
                    const categories = [...(toolChecklist.categories || [])];
                    const items = [...(categories[ci].items || [])];
                    const nextSl = items.length + 1;
                    items.push(emptyItem(nextSl));
                    categories[ci] = { ...categories[ci], items };
                    updateWizard({ toolChecklist: { categories } });
                  }}
                >
                  Add row in {cat.label}
                </button>
              </div>
            ));
          })()}
          <h4 className="h6 fw-bold mt-3">Machinery catalog (this site)</h4>
          <p className="site-job-workflow__muted small mb-2">
            In <strong>Machinery</strong>, set <strong>Tools checklist category</strong> when adding a machine so it can be pulled into the correct block below. New
            categories you add here are saved with this site&apos;s wizard only (no separate backend API).
          </p>
          {machineryByCategory.length === 0 ? (
            <p className="text-muted small">No machinery rows for this site.</p>
          ) : (
            machineryByCategory.map(([label, rows]) => (
              <div key={label} className="mb-2">
                <div className="fw-bold small text-uppercase mb-1">{label}</div>
                <table className="site-job-workflow__paper-table site-job-workflow__stack-mobile">
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
                    {rows.map((m) => {
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
            ))
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
                  New section name
                </label>
                <div className="d-flex flex-wrap gap-2 align-items-center">
                  <input
                    id="site-job-new-tool-category-name"
                    ref={addCategoryInputRef}
                    type="text"
                    className="form-control form-control-sm"
                    style={{ maxWidth: "18rem" }}
                    value={addCategoryName}
                    placeholder="e.g. Power tools"
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
                      const categories = [...(toolChecklist.categories || [])];
                      const key = nextToolCategoryKey(categories);
                      const label = String(addCategoryName).trim() || "New category";
                      categories.push({ key, label, items: [emptyItem(1)] });
                      updateWizard({ toolChecklist: { categories } });
                      setAddCategoryOpen(false);
                      setAddCategoryName("");
                      setToolChecklistActionMessage({
                        kind: "success",
                        text: `Added section “${key}. ${label}”. Scroll up to see it, then use “Save & next” to persist.`,
                      });
                      showSuccess?.(`Added section “${key}. ${label}”.`);
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
              onClick={() => {
                let added = 0;
                const categories = [...(toolChecklist.categories || [])];
                for (const m of machineryList) {
                  const ck = getMachineryChecklistKey(m);
                  if (!ck) continue;
                  const cix = categories.findIndex((c) => c.key === ck);
                  if (cix < 0) continue;
                  const items = [...(categories[cix].items || [])];
                  const mid = m.id ?? m.machineryId;
                  if (
                    mid != null &&
                    items.some((it) => it.machineryCatalogId != null && Number(it.machineryCatalogId) === Number(mid))
                  ) {
                    continue;
                  }
                  items.push({
                    slNo: items.length + 1,
                    description: [m.code, m.name].filter(Boolean).join(" — "),
                    uom: m.defaultUom || "",
                    qty: "",
                    itemDate: "",
                    machineryCatalogId: mid,
                    marks: Array(TOOL_MARK_DAYS).fill(""),
                  });
                  categories[cix] = { ...categories[cix], items };
                  added += 1;
                }
                if (added === 0) {
                  const msg =
                    machineryList.length === 0
                      ? "No machinery loaded for this site. Add machines under Admin → Machinery, then set each machine’s “Tools checklist category” to A–K before importing."
                      : 'No new lines added. Each machine needs a checklist letter (A, B, C, I, J, or K) in Machinery — yours show "—". Edit the machine, pick a category, save, then try again.';
                  setToolChecklistActionMessage({ kind: "warning", text: msg });
                  return;
                }
                updateWizard({ toolChecklist: { categories } });
                const msg = `Added ${added} machinery line(s) under their checklist categories. Scroll up to see new rows. Use “Save & next” to persist.`;
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
          <h3 className="site-job-workflow__form-title">Site advance received &amp; paid</h3>
          <p className="site-job-workflow__muted small mb-2">
            Matches the paper register. Saved with{" "}
            <strong>PUT /api/admin/sites/&#123;id&#125;/job-data/advance-expense-lines</strong> and{" "}
            <strong>technician-payments</strong> as JSON arrays when you use <strong>Save &amp; next</strong>.
          </p>
          <h4 className="h6 fw-bold mt-2">Details of dispersion of expenses</h4>
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
                {advanceLines.map((row, idx) => (
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
                ))}
              </tbody>
            </table>
          </div>
          <h4 className="h6 fw-bold">Technician-wise dispersion of funds</h4>
          <p className="site-job-workflow__muted small mb-1">
            Up to {TECHNICIAN_PAYMENT_SLOTS} payment dates per technician; totals are stored as entered.
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
                {technicianPaymentLines.map((row, ri) => (
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
                              next[ri] = { ...next[ri], technicianUserId: null };
                            } else {
                              const id = Number(v);
                              const u = employeeOptions.find((x) => x.id === id);
                              next[ri] = {
                                ...next[ri],
                                technicianUserId: id,
                                technicianName: u?.name ?? u?.email ?? "",
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
                            ? "Linked — Unlink to type a custom name"
                            : "Technician name (custom if not in list)"
                        }
                        readOnly={row.technicianUserId != null}
                        value={row.technicianName ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setTechnicianPaymentLines((prev) => {
                            const n = [...prev];
                            n[ri] = { ...n[ri], technicianName: val, technicianUserId: null };
                            return n;
                          });
                        }}
                      />
                      {row.technicianUserId != null ? (
                        <button
                          type="button"
                          className="btn btn-link btn-sm p-0 mt-1"
                          onClick={() =>
                            setTechnicianPaymentLines((prev) => {
                              const n = [...prev];
                              n[ri] = { ...n[ri], technicianUserId: null };
                              return n;
                            })
                          }
                        >
                          Unlink user
                        </button>
                      ) : null}
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
                                next[ri] = { ...next[ri], payments: pay };
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
                                next[ri] = { ...next[ri], payments: pay };
                                return next;
                              });
                            }}
                          />
                        </td>
                      </Fragment>
                    ))}
                    <td data-label="Total">
                      <input
                        className="form-control form-control-sm border-0 rounded-0 px-1"
                        value={row.totalPayment ?? ""}
                        onChange={(e) => {
                          const v = e.target.value;
                          setTechnicianPaymentLines((prev) => {
                            const next = [...prev];
                            next[ri] = { ...next[ri], totalPayment: v };
                            return next;
                          });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {currentStepIndex === 4 && (
        <div>
          <h3 className="site-job-workflow__form-title">Tools missing / damage / repair</h3>
          <p className="site-job-workflow__muted small mb-2">
            Saved with <strong>PUT .../job-data/tool-issues</strong> as a JSON array.
          </p>
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
                {toolIssueLines.map((row, ri) => (
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
                            ? "Linked — Unlink to type equipment / other"
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
                      {row.handledByEmployeeUserId != null ? (
                        <button
                          type="button"
                          className="btn btn-link btn-sm p-0 mt-1"
                          onClick={() =>
                            setToolIssueLines((prev) => {
                              const n = [...prev];
                              n[ri] = { ...n[ri], handledByEmployeeUserId: null };
                              return n;
                            })
                          }
                        >
                          Unlink user
                        </button>
                      ) : null}
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {currentStepIndex === 5 && (
        <div>
          <h3 className="site-job-workflow__form-title">Challenges at site</h3>
          <p className="site-job-workflow__muted small mb-2">
            One row per challenge head (from <strong>/api/meta/challenge-line-heads</strong> or built-in list). Saved with{" "}
            <strong>PUT .../job-data/challenge-lines</strong>.
          </p>
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
                {challengeLineRows.map((row, ri) => (
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
                            ? "Linked — Unlink for equipment / other text"
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
                      {row.involvedEmployeeUserId != null ? (
                        <button
                          type="button"
                          className="btn btn-link btn-sm p-0 mt-1"
                          onClick={() =>
                            setChallengeLineRows((prev) => {
                              const n = [...prev];
                              n[ri] = { ...n[ri], involvedEmployeeUserId: null };
                              return n;
                            })
                          }
                        >
                          Unlink user
                        </button>
                      ) : null}
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {currentStepIndex === 6 && (
        <div>
          <h3 className="site-job-workflow__form-title">Site behaviour report</h3>
          <p className="site-job-workflow__muted small mb-2">
            Grid: tick and date when an issue applies to a member. Saved with <strong>PUT .../job-data/behaviour-report</strong> as JSON.
          </p>
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
                              linkedId != null ? "Linked name — Unlink to edit" : "Member name (custom)"
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
                          {linkedId != null ? (
                            <button
                              type="button"
                              className="btn btn-link btn-sm p-0 mt-1 d-block mx-auto"
                              onClick={() =>
                                setBehaviourState((prev) => {
                                  const memberEmployeeUserIds = [...(prev.memberEmployeeUserIds || [])];
                                  while (memberEmployeeUserIds.length < prev.members.length) memberEmployeeUserIds.push(null);
                                  memberEmployeeUserIds[mi] = null;
                                  return { ...prev, memberEmployeeUserIds };
                                })
                              }
                            >
                              Unlink user
                            </button>
                          ) : null}
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
                {BEHAVIOUR_ISSUE_ROWS.map((issue, ri) => (
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
                ))}
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

      {currentStepIndex === 7 && (
        <div>
          <h3 className="site-job-workflow__form-title">Site team attendance register</h3>
          <p className="site-job-workflow__muted small mb-2">
            Codes: <strong>P</strong> Present, <strong>A</strong> Absent, <strong>S</strong> Sick, <strong>HQ</strong> HQ duty, <strong>LS</strong> Leave/shift off, <strong>INJ</strong> Injury. Cell updates use{" "}
            <strong>PUT .../job-data/attendance-register-cells</strong> when you save this step.
          </p>
          <div className="site-job-workflow__att-submissions site-job-workflow__panel border rounded p-2 mb-3">
            <h4 className="h6 fw-bold mb-2">Employee attendance (photo check-ins)</h4>
            <p className="site-job-workflow__muted small mb-2">
              Same flow as the Attendance Portal: employees submit with <strong>photo + site + shift</strong>. Rows come from{" "}
              <strong>GET /api/admin/attendance</strong> for <strong>site id {siteId}</strong> only ({site.name ?? "this site"}). That is separate from the{" "}
              <strong>daily code register</strong> below (paper-style P/A/S cells)—checkmarks there do not create portal rows.
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
            {siteAttendanceError ? <div className="alert alert-danger py-2 small mb-2">{siteAttendanceError}</div> : null}
            {siteAttendanceLoading ? <p className="text-muted small mb-0">Loading attendance submissions…</p> : null}
            {!siteAttendanceLoading && filteredSiteAttendance.length === 0 ? (
              <p className="text-muted small mb-0">
                No portal check-ins for this site and filter. If you only filled the code grid, use{" "}
                <strong>Add Record</strong> on the employee Attendance Portal (same site) to create rows here.
              </p>
            ) : null}
            {!siteAttendanceLoading && filteredSiteAttendance.length > 0 ? (
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
                    {filteredSiteAttendance.map((req) => {
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
          <h4 className="h6 fw-bold mb-2">Daily register (codes)</h4>
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
            {`Server rows follow the site roster. Rows you add here are only on this screen until you reload; cell saves still use each user's id.`}
          </p>
          {!attendanceRegister ? (
            <p className="text-muted">No register data returned for this site.</p>
          ) : (
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
                  {(attendanceRegister.rows || []).map((row, ri) => (
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {siteAttRejectId != null ? (
            <div className="admin-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="site-workflow-att-reject-title">
              <div className="admin-modal">
                <h3 id="site-workflow-att-reject-title" className="h6 mb-2">
                  Reject attendance request
                </h3>
                <p className="small text-muted mb-2">
                  Optionally provide a reason. The employee may see it. Uses the same endpoint as Pending Approvals:{" "}
                  <strong>PUT /api/admin/attendance/{'{id}'}/approve</strong> with status REJECTED.
                </p>
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

      {currentStepIndex === 8 && (
        <div>
          <h3 className="site-job-workflow__form-title">Work completion &amp; customer feedback</h3>
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
          <h4 className="h6 mt-3">Customer feedback (read-only)</h4>
          <p className="site-job-workflow__muted small mb-2">
            Loaded with <strong>GET /api/admin/sites/&#123;id&#125;/customer-feedback</strong>. Clients submit via the public feedback link; if you need admin edits, add a matching <strong>PUT</strong> on the backend and wire it here.
          </p>
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
            <p className="text-muted small mb-3">No customer feedback record yet for this site.</p>
          )}
          <h4 className="h6">Certificate draft (saved in wizard)</h4>
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
