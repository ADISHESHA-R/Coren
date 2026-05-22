import { useCallback, useEffect, useRef, useState } from "react";

import { refreshAccessToken } from "../utils/refreshAccessToken";
import { API_BASE_URL as BASE_URL } from "../config/apiBaseUrl.js";
import AdminMachineryPanel from "./AdminMachineryPanel";
import AdminNoticesPanel from "./AdminNoticesPanel";
import AdminSiteJobWorkflow from "./AdminSiteJobWorkflow";
import AttendancePhotoThumb from "./AttendancePhotoThumb.jsx";
import UserDirectoryCombobox from "./UserDirectoryCombobox.jsx";
import { avatarBackgroundForUser, getUserInitials } from "../utils/userDirectoryDisplay.js";

const SESSION_LIMIT_MS = 24 * 60 * 60 * 1000;
const REFRESH_EARLY_MS = 60 * 1000;
const DEFAULT_REFRESH_MS = 29 * 60 * 1000;

function getAuthHeader() {
  const tokenType = (localStorage.getItem("tokenType") || "Bearer").trim();
  let accessToken = (localStorage.getItem("accessToken") || "").trim();
  if (/^bearer\s+/i.test(accessToken)) {
    accessToken = accessToken.replace(/^bearer\s+/i, "").trim();
  }
  return accessToken ? `${tokenType} ${accessToken}` : "";
}

function formatSiteDateTime(iso) {
  if (iso == null || iso === "") return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

function buildUsersListQuery({ page, size, search, role, status }) {
  const p = new URLSearchParams();
  p.set("page", String(page));
  p.set("size", String(size));
  const q = (search || "").trim();
  if (q) p.set("search", q);
  if (role) p.set("role", role);
  if (status) p.set("status", status);
  return p.toString();
}

function buildSitesListQuery({ page, size, search, isActive }) {
  const p = new URLSearchParams();
  p.set("page", String(page));
  p.set("size", String(size));
  const q = (search || "").trim();
  if (q) p.set("search", q);
  if (isActive === true || isActive === false) p.set("isActive", String(isActive));
  return p.toString();
}

function buildPendingAttendanceQuery({ page, size, status, date, employeeId, siteId, jobCode }) {
  const p = new URLSearchParams();
  p.set("page", String(page));
  p.set("size", String(size));
  if (status) p.set("status", status);
  const d = (date || "").trim();
  if (d) p.set("date", d);
  const eid = (employeeId || "").trim();
  if (eid) p.set("employeeId", eid);
  const sid = (siteId || "").trim();
  if (sid) p.set("siteId", sid);
  const jc = (jobCode || "").trim();
  if (jc) p.set("jobCode", jc);
  return p.toString();
}

function parsePagedContent(data) {
  const root = data?.data;
  if (root == null) return { list: [], totalElements: 0, totalPages: 1 };
  if (Array.isArray(root)) {
    const n = root.length;
    return { list: root, totalElements: n, totalPages: 1 };
  }
  if (typeof root !== "object") return { list: [], totalElements: 0, totalPages: 1 };
  const content = root.content;
  const list = Array.isArray(content) ? content : [];
  const totalElements = Number(root.totalElements ?? root.total ?? list.length);
  const rawPages = Number(root.totalPages);
  const size = Number(root.size ?? 10) || 10;
  const totalPages =
    Number.isFinite(rawPages) && rawPages > 0
      ? rawPages
      : Math.max(1, Math.ceil((Number.isFinite(totalElements) ? totalElements : 0) / size));
  return { list, totalElements: Number.isFinite(totalElements) ? totalElements : list.length, totalPages };
}

/** Directory for site “In charge” dropdown (same API as User Management, first page). */
const SITE_INCHARGE_USER_PAGE_SIZE = 500;

async function fetchAdminUsersForSiteInchargeDropdown() {
  const authHeader = getAuthHeader();
  if (!authHeader) return [];
  try {
    const res = await fetch(`${BASE_URL}/api/admin/users?page=0&size=${SITE_INCHARGE_USER_PAGE_SIZE}`, {
      headers: { Authorization: authHeader },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) return [];
    const { list } = parsePagedContent(data);
    return [...list].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  } catch {
    return [];
  }
}

/** Read assigned user id from site or dashboard row DTO (backend naming may vary). */
function getRawInChargeUserId(entity) {
  if (!entity || typeof entity !== "object") return "";
  const raw =
    entity.inChargeUserId ??
    entity.inchargeUserId ??
    entity.inChargeId ??
    entity.inchargeId ??
    entity.managerUserId ??
    entity.siteManagerUserId ??
    entity.assignedUserId ??
    entity.supervisorUserId ??
    entity.inCharge?.id ??
    entity.inCharge?.userId ??
    entity.inChargeUser?.id ??
    entity.manager?.id ??
    entity.manager?.userId;
  if (raw == null || raw === "") return "";
  return String(raw);
}

function getSiteInChargeUserId(site) {
  return getRawInChargeUserId(site);
}

function parseInChargeUserIdNumber(entity) {
  const s = getRawInChargeUserId(entity);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Label for tables / read-only when API returns name or nested user. */
function formatSiteInChargeDisplay(site) {
  if (!site || typeof site !== "object") return "—";
  const name =
    site.inChargeUserName ??
    site.inChargeName ??
    site.inCharge?.name ??
    site.inChargeUser?.name ??
    site.inCharge?.fullName ??
    site.manager?.name ??
    site.managerName;
  if (name && String(name).trim()) return String(name).trim();
  const id = getSiteInChargeUserId(site);
  return id ? `User #${id}` : "—";
}

function inChargePayloadValue(inChargeUserId) {
  if (inChargeUserId === "" || inChargeUserId == null) return null;
  const n = Number(inChargeUserId);
  return Number.isFinite(n) ? n : null;
}

/** Sites list size when merging in-charge onto dashboard site-wise stats. */
const DASHBOARD_SITES_FOR_INCHARGE_SIZE = 500;

function siteDashboardMapKey(id) {
  if (id == null || id === "") return null;
  return String(id);
}

/** Match dashboard row to GET /sites row when ids differ but job code matches. */
function findMergedSiteForStat(stat, sitesById) {
  if (!stat || !sitesById || typeof sitesById !== "object") return null;
  const key = siteDashboardMapKey(stat.siteId ?? stat.id);
  if (key != null) {
    const byId = sitesById[key];
    if (byId) return byId;
  }
  const jc = String(stat.jobCode ?? "").trim().toLowerCase();
  if (!jc) return null;
  for (const site of Object.values(sitesById)) {
    if (site && String(site.jobCode ?? "").trim().toLowerCase() === jc) return site;
  }
  return null;
}

/** Load sites (same list as Sites tab) so overview can show in-charge when dashboard stats omit it. */
async function fetchSitesMapForDashboardInCharge() {
  const authHeader = getAuthHeader();
  if (!authHeader) return {};
  try {
    const qs = buildSitesListQuery({
      page: 0,
      size: DASHBOARD_SITES_FOR_INCHARGE_SIZE,
      search: "",
      isActive: undefined,
    });
    const res = await fetch(`${BASE_URL}/api/admin/sites?${qs}`, { headers: { Authorization: authHeader } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) return {};
    const { list } = parsePagedContent(data);
    const map = {};
    for (const site of list) {
      const key = siteDashboardMapKey(site.id ?? site.siteId);
      if (key != null) map[key] = site;
    }
    return map;
  } catch {
    return {};
  }
}

/** User id -> row from GET /admin/users for resolving in-charge display on dashboard. */
async function fetchUsersMapForDashboardInCharge() {
  const authHeader = getAuthHeader();
  if (!authHeader) return {};
  try {
    const qs = buildUsersListQuery({
      page: 0,
      size: SITE_INCHARGE_USER_PAGE_SIZE,
      search: "",
      role: "",
      status: "",
    });
    const res = await fetch(`${BASE_URL}/api/admin/users?${qs}`, { headers: { Authorization: authHeader } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) return {};
    const { list } = parsePagedContent(data);
    const map = {};
    for (const u of list) {
      const id = Number(u.id);
      if (Number.isFinite(id)) map[id] = u;
    }
    return map;
  } catch {
    return {};
  }
}

/** Site-wise stats cell: same visual language as UserDirectoryCombobox (avatar + name + meta). */
function SiteStatInChargeCell({ stat, sitesById, usersById }) {
  if (!stat || typeof stat !== "object") return "—";
  const site = findMergedSiteForStat(stat, sitesById);
  const idNum = parseInChargeUserIdNumber(stat) ?? parseInChargeUserIdNumber(site);
  const user = idNum != null && usersById && typeof usersById === "object" ? usersById[idNum] : null;

  if (user) {
    const line1 = String(user.name ?? "").trim() || String(user.email ?? "").trim() || `User ${user.id}`;
    const sub = [user.employeeId, user.role].filter(Boolean).join(" · ");
    return (
      <div className="d-inline-flex align-items-center gap-2 text-start">
        <span className="udc-avatar" style={{ background: avatarBackgroundForUser(user) }}>
          {getUserInitials(user)}
        </span>
        <span className="d-flex flex-column lh-sm">
          <span>{line1}</span>
          {sub ? <span className="small text-muted">{sub}</span> : null}
        </span>
      </div>
    );
  }

  const fromStat =
    stat.inChargeUserName ??
    stat.inChargeName ??
    stat.inCharge?.name ??
    stat.inChargeUser?.name ??
    stat.inChargeUser?.fullName ??
    stat.manager?.name ??
    stat.managerName;
  if (fromStat && String(fromStat).trim()) return String(fromStat).trim();

  if (site) {
    const t = formatSiteInChargeDisplay(site);
    if (t !== "—") return t;
  }

  if (idNum != null) return <span className="text-muted">User #{idNum}</span>;
  return "—";
}

const BLOOD_GROUPS = ["A_POSITIVE", "A_NEGATIVE", "B_POSITIVE", "B_NEGATIVE", "AB_POSITIVE", "AB_NEGATIVE", "O_POSITIVE", "O_NEGATIVE"];
const ROLES = [{ value: "EMPLOYEE", label: "Employee" }, { value: "ADMIN", label: "Admin" }];
const EMPLOYEE_STATUSES = ["ACTIVE", "INACTIVE", "SUSPENDED"];

export default function AdminDashboard({ onLogout }) {
  const [view, setView] = useState("overview"); // 'overview' | 'users' | 'pending' | 'sites' | 'machinery' | 'notices' | 'siteWorkflow'
  const [workflowSiteId, setWorkflowSiteId] = useState(null);
  const [dashboardData, setDashboardData] = useState(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState("");
  /** siteId -> site from GET /admin/sites for merging in-charge into overview table */
  const [dashboardSitesById, setDashboardSitesById] = useState({});
  /** user id -> user from GET /admin/users for in-charge avatar row on overview */
  const [dashboardDirectoryUsersById, setDashboardDirectoryUsersById] = useState({});
  const [users, setUsers] = useState([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersTotalPages, setUsersTotalPages] = useState(1);
  const [usersPage, setUsersPage] = useState(0);
  const [usersSize] = useState(10);
  const [usersSearchInput, setUsersSearchInput] = useState("");
  const [usersSearchQuery, setUsersSearchQuery] = useState("");
  const [usersRoleFilter, setUsersRoleFilter] = useState("");
  const [usersStatusFilter, setUsersStatusFilter] = useState("");
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState("");
  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingTotal, setPendingTotal] = useState(0);
  const [pendingTotalPages, setPendingTotalPages] = useState(1);
  const [pendingPage, setPendingPage] = useState(0);
  const [pendingSize] = useState(10);
  const [pendingDateFilter, setPendingDateFilter] = useState("");
  const [pendingEmployeeIdFilter, setPendingEmployeeIdFilter] = useState("");
  const [pendingSiteIdFilter, setPendingSiteIdFilter] = useState("");
  const [pendingJobCodeFilter, setPendingJobCodeFilter] = useState("");
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingError, setPendingError] = useState("");
  const [approvingId, setApprovingId] = useState(null);
  const [rejectModalId, setRejectModalId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [rejectingId, setRejectingId] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [editUserId, setEditUserId] = useState(null);
  const [editUser, setEditUser] = useState(null);
  const [editLoading, setEditLoading] = useState(false);
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [deleteConfirmId, setDeleteConfirmId] = useState(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [resetPasswordId, setResetPasswordId] = useState(null);
  const [newPassword, setNewPassword] = useState("");
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [sites, setSites] = useState([]);
  const [sitesTotal, setSitesTotal] = useState(0);
  const [sitesTotalPages, setSitesTotalPages] = useState(1);
  const [sitesPage, setSitesPage] = useState(0);
  const [sitesSize] = useState(20);
  const [sitesSearchInput, setSitesSearchInput] = useState("");
  const [sitesSearchQuery, setSitesSearchQuery] = useState("");
  const [sitesLoading, setSitesLoading] = useState(false);
  const [sitesError, setSitesError] = useState("");
  const [sitesListFilter, setSitesListFilter] = useState("all");
  const [viewingSiteId, setViewingSiteId] = useState(null);
  const [siteDetail, setSiteDetail] = useState(null);
  const [siteDetailLoading, setSiteDetailLoading] = useState(false);
  const [siteDetailError, setSiteDetailError] = useState("");
  const [createSiteOpen, setCreateSiteOpen] = useState(false);
  const [editSiteId, setEditSiteId] = useState(null);
  const [editSite, setEditSite] = useState(null);
  const [editSiteLoading, setEditSiteLoading] = useState(false);
  const [siteSaveLoading, setSiteSaveLoading] = useState(false);
  const [siteSaveError, setSiteSaveError] = useState("");
  const [deleteSiteConfirmId, setDeleteSiteConfirmId] = useState(null);
  const [deleteSiteLoading, setDeleteSiteLoading] = useState(false);

  const refreshTimeoutRef = useRef(null);

  useEffect(() => {
    if (view !== "siteWorkflow") setWorkflowSiteId(null);
  }, [view]);

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

  const fetchDashboard = useCallback(async () => {
    const authHeader = getAuthHeader();
    if (!authHeader) return;
    setDashboardLoading(true);
    setDashboardError("");
    const sitesMapPromise = fetchSitesMapForDashboardInCharge();
    const usersMapPromise = fetchUsersMapForDashboardInCharge();
    try {
      const url = `${BASE_URL}/api/admin/dashboard`;
      let res = await fetch(url, { headers: { Authorization: authHeader } });
      if (res.status === 401 && localStorage.getItem("refreshToken")) {
        const refreshed = await refreshAccessToken();
        if (refreshed.ok) {
          const h = getAuthHeader();
          if (h) res = await fetch(url, { headers: { Authorization: h } });
        }
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        setDashboardData(data.data || null);
        const [sitesMap, usersMap] = await Promise.all([sitesMapPromise, usersMapPromise]);
        setDashboardSitesById(sitesMap);
        setDashboardDirectoryUsersById(usersMap);
      } else {
        setDashboardError(data?.message || "Failed to load dashboard.");
        setDashboardSitesById({});
        setDashboardDirectoryUsersById({});
        await Promise.all([sitesMapPromise.catch(() => {}), usersMapPromise.catch(() => {})]);
      }
    } catch {
      setDashboardError("Failed to load dashboard.");
      setDashboardSitesById({});
      setDashboardDirectoryUsersById({});
      await Promise.all([sitesMapPromise.catch(() => {}), usersMapPromise.catch(() => {})]);
    }
    setDashboardLoading(false);
  }, []);

  const fetchUsers = useCallback(async () => {
    const authHeader = getAuthHeader();
    if (!authHeader) return;
    setUsersLoading(true);
    setUsersError("");
    try {
      const qs = buildUsersListQuery({
        page: usersPage,
        size: usersSize,
        search: usersSearchQuery,
        role: usersRoleFilter,
        status: usersStatusFilter,
      });
      const res = await fetch(`${BASE_URL}/api/admin/users?${qs}`, { headers: { Authorization: authHeader } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        const { list, totalElements, totalPages } = parsePagedContent(data);
        setUsers(list);
        setUsersTotal(totalElements);
        setUsersTotalPages(Math.max(1, totalPages));
      } else {
        setUsersError(data?.message || "Failed to load users.");
        setUsers([]);
        setUsersTotal(0);
        setUsersTotalPages(1);
      }
    } catch {
      setUsersError("Failed to load users.");
      setUsers([]);
      setUsersTotal(0);
      setUsersTotalPages(1);
    }
    setUsersLoading(false);
  }, [usersPage, usersSize, usersSearchQuery, usersRoleFilter, usersStatusFilter]);

  const fetchPendingRequests = useCallback(async () => {
    const authHeader = getAuthHeader();
    if (!authHeader) return;
    setPendingLoading(true);
    setPendingError("");
    try {
      const qs = buildPendingAttendanceQuery({
        page: pendingPage,
        size: pendingSize,
        status: "PENDING",
        date: pendingDateFilter,
        employeeId: pendingEmployeeIdFilter,
        siteId: pendingSiteIdFilter,
        jobCode: pendingJobCodeFilter,
      });
      const res = await fetch(`${BASE_URL}/api/admin/attendance?${qs}`, { headers: { Authorization: authHeader } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success !== false) {
        const { list, totalElements, totalPages } = parsePagedContent(data);
        setPendingRequests(list);
        setPendingTotal(totalElements);
        setPendingTotalPages(Math.max(1, totalPages));
        if (!data?.success && list.length === 0 && data?.message) setPendingError(data.message);
      } else if (res.status === 404) {
        setPendingRequests([]);
        setPendingTotal(0);
        setPendingTotalPages(1);
      } else {
        setPendingError(data?.message || "Failed to load pending requests.");
        setPendingRequests([]);
        setPendingTotal(0);
        setPendingTotalPages(1);
      }
    } catch {
      setPendingError("Failed to load pending requests.");
      setPendingRequests([]);
      setPendingTotal(0);
      setPendingTotalPages(1);
    }
    setPendingLoading(false);
  }, [pendingPage, pendingSize, pendingDateFilter, pendingEmployeeIdFilter, pendingSiteIdFilter, pendingJobCodeFilter]);

  const fetchSites = useCallback(async () => {
    const authHeader = getAuthHeader();
    if (!authHeader) return;
    setSitesLoading(true);
    setSitesError("");
    try {
      const isActive =
        sitesListFilter === "active" ? true : sitesListFilter === "inactive" ? false : undefined;
      const qs = buildSitesListQuery({
        page: sitesPage,
        size: sitesSize,
        search: sitesSearchQuery,
        isActive,
      });
      const res = await fetch(`${BASE_URL}/api/admin/sites?${qs}`, { headers: { Authorization: authHeader } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        const { list, totalElements, totalPages } = parsePagedContent(data);
        setSites(list);
        setSitesTotal(totalElements);
        setSitesTotalPages(Math.max(1, totalPages));
      } else {
        setSitesError(data?.message || "Failed to load sites.");
        setSites([]);
        setSitesTotal(0);
        setSitesTotalPages(1);
      }
    } catch {
      setSitesError("Failed to load sites.");
      setSites([]);
      setSitesTotal(0);
      setSitesTotalPages(1);
    }
    setSitesLoading(false);
  }, [sitesPage, sitesSize, sitesSearchQuery, sitesListFilter]);

  useEffect(() => {
    if (view === "overview" && getAuthHeader()) fetchDashboard();
  }, [view, fetchDashboard]);

  useEffect(() => {
    if (view === "users" && getAuthHeader()) fetchUsers();
  }, [view, fetchUsers]);

  useEffect(() => {
    if (view === "pending" && getAuthHeader()) fetchPendingRequests();
  }, [view, fetchPendingRequests]);

  useEffect(() => {
    if (view === "sites" && getAuthHeader()) fetchSites();
  }, [view, fetchSites]);

  useEffect(() => {
    setUsersPage(0);
  }, [usersRoleFilter, usersStatusFilter]);

  const pendingFiltersBoot = useRef(true);
  useEffect(() => {
    if (pendingFiltersBoot.current) {
      pendingFiltersBoot.current = false;
      return;
    }
    const id = setTimeout(() => setPendingPage(0), 450);
    return () => clearTimeout(id);
  }, [pendingDateFilter, pendingEmployeeIdFilter, pendingSiteIdFilter, pendingJobCodeFilter]);

  useEffect(() => {
    setSitesPage(0);
  }, [sitesListFilter]);

  useEffect(() => {
    const authHeader = getAuthHeader();
    if (viewingSiteId == null) {
      setSiteDetail(null);
      setSiteDetailError("");
      setSiteDetailLoading(false);
      return;
    }
    if (!authHeader) return;

    setSiteDetailLoading(true);
    setSiteDetailError("");
    setSiteDetail(null);
    fetch(`${BASE_URL}/api/admin/sites/${viewingSiteId}`, { headers: { Authorization: authHeader } })
      .then((r) => r.json())
      .then((data) => {
        if (data?.success && data?.data) setSiteDetail(data.data);
        else setSiteDetailError(data?.message || "Site not found.");
      })
      .catch(() => setSiteDetailError("Failed to load site."))
      .finally(() => setSiteDetailLoading(false));
  }, [viewingSiteId]);

  useEffect(() => {
    const authHeader = getAuthHeader();
    if (editSiteId && authHeader) {
      setEditSiteLoading(true);
      fetch(`${BASE_URL}/api/admin/sites/${editSiteId}`, { headers: { Authorization: authHeader } })
        .then((r) => r.json())
        .then((data) => {
          if (data?.success && data?.data) setEditSite(data.data);
          else setEditSite(null);
        })
        .catch(() => setEditSite(null))
        .finally(() => setEditSiteLoading(false));
    } else {
      setEditSite(null);
    }
  }, [editSiteId]);

  useEffect(() => {
    const authHeader = getAuthHeader();
    if (editUserId && authHeader) {
      setEditLoading(true);
      fetch(`${BASE_URL}/api/admin/users/${editUserId}`, { headers: { Authorization: authHeader } })
        .then((r) => r.json())
        .then((data) => {
          if (data?.success && data?.data) setEditUser(data.data);
          else setEditUser(null);
        })
        .catch(() => setEditUser(null))
        .finally(() => setEditLoading(false));
    } else {
      setEditUser(null);
    }
  }, [editUserId]);

  const showSuccess = (msg) => {
    setSuccessMessage(msg);
    setTimeout(() => setSuccessMessage(""), 4000);
  };

  const closeSiteDetail = () => {
    setViewingSiteId(null);
    setSiteDetail(null);
    setSiteDetailError("");
  };

  const handleCreateSite = async (payload) => {
    const authHeader = getAuthHeader();
    if (!authHeader) {
      setSiteSaveError("Not authenticated.");
      return;
    }
    setSiteSaveLoading(true);
    setSiteSaveError("");
    try {
      const res = await fetch(`${BASE_URL}/api/admin/sites`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({
          name: payload.name,
          jobCode: payload.jobCode,
          address: payload.address,
          inChargeUserId: inChargePayloadValue(payload.inChargeUserId),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        showSuccess(data.message || "Site created successfully.");
        setCreateSiteOpen(false);
        fetchSites();
        if (view === "overview") fetchDashboard();
      } else {
        setSiteSaveError(data?.message || "Failed to create site.");
      }
    } catch {
      setSiteSaveError("Failed to create site.");
    }
    setSiteSaveLoading(false);
  };

  const handleUpdateSite = async (id, payload) => {
    const authHeader = getAuthHeader();
    if (!authHeader) {
      setSiteSaveError("Not authenticated.");
      return;
    }
    setSiteSaveLoading(true);
    setSiteSaveError("");
    try {
      const res = await fetch(`${BASE_URL}/api/admin/sites/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({
          name: payload.name,
          jobCode: payload.jobCode,
          address: payload.address,
          isActive: Boolean(payload.isActive),
          inChargeUserId: inChargePayloadValue(payload.inChargeUserId),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        showSuccess(data.message || "Site updated successfully.");
        setEditSiteId(null);
        setEditSite(null);
        fetchSites();
        if (view === "overview") fetchDashboard();
      } else {
        setSiteSaveError(data?.message || "Failed to update site.");
      }
    } catch {
      setSiteSaveError("Failed to update site.");
    }
    setSiteSaveLoading(false);
  };

  const handleDeleteSite = async (id) => {
    const authHeader = getAuthHeader();
    if (!authHeader) {
      setSitesError("Not authenticated.");
      return;
    }
    setDeleteSiteLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/admin/sites/${id}`, {
        method: "DELETE",
        headers: { Authorization: authHeader },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        showSuccess(data.message || "Site deleted successfully.");
        setDeleteSiteConfirmId(null);
        fetchSites();
        if (view === "overview") fetchDashboard();
      } else {
        setSitesError(data?.message || "Failed to delete site.");
      }
    } catch {
      setSitesError("Failed to delete site.");
    }
    setDeleteSiteLoading(false);
  };

  const handleActivateSite = async (id) => {
    const authHeader = getAuthHeader();
    if (!authHeader) {
      setSitesError("Not authenticated.");
      return;
    }
    try {
      const res = await fetch(`${BASE_URL}/api/admin/sites/${id}/activate`, {
        method: "PUT",
        headers: { Authorization: authHeader },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        showSuccess(data.message || "Site activated successfully.");
        fetchSites();
        if (view === "overview") fetchDashboard();
      } else {
        setSitesError(data?.message || "Failed to activate site.");
      }
    } catch {
      setSitesError("Failed to activate site.");
    }
  };

  const handleDeactivateSite = async (id) => {
    const authHeader = getAuthHeader();
    if (!authHeader) {
      setSitesError("Not authenticated.");
      return;
    }
    try {
      const res = await fetch(`${BASE_URL}/api/admin/sites/${id}/deactivate`, {
        method: "PUT",
        headers: { Authorization: authHeader },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        showSuccess(data.message || "Site deactivated successfully.");
        fetchSites();
        if (view === "overview") fetchDashboard();
      } else {
        setSitesError(data?.message || "Failed to deactivate site.");
      }
    } catch {
      setSitesError("Failed to deactivate site.");
    }
  };

  const handleCreateUser = async (payload) => {
    const authHeader = getAuthHeader();
    if (!authHeader) {
      setSaveError("Not authenticated.");
      return;
    }
    setSaveLoading(true);
    setSaveError("");
    try {
      const res = await fetch(`${BASE_URL}/api/admin/users`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        const d = data.data || {};
        const cred = (d.email || d.user?.email) && (d.password != null) ? ` Email: ${d.email ?? d.user?.email}, Password: ${d.password}` : "";
        showSuccess("User created successfully." + (cred ? " Share credentials with the user:" + cred : ""));
        setCreateOpen(false);
        fetchUsers();
      } else {
        setSaveError(data?.message || "Failed to create user.");
      }
    } catch {
      setSaveError("Failed to create user.");
    }
    setSaveLoading(false);
  };

  const handleUpdateUser = async (id, payload) => {
    const authHeader = getAuthHeader();
    if (!authHeader) {
      setSaveError("Not authenticated.");
      return;
    }
    setSaveLoading(true);
    setSaveError("");
    try {
      const res = await fetch(`${BASE_URL}/api/admin/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        showSuccess("User updated successfully.");
        setEditUserId(null);
        setEditUser(null);
        fetchUsers();
        if (view === "overview") fetchDashboard();
      } else {
        setSaveError(data?.message || "Failed to update user.");
      }
    } catch {
      setSaveError("Failed to update user.");
    }
    setSaveLoading(false);
  };

  const handleDeleteUser = async (id) => {
    const authHeader = getAuthHeader();
    if (!authHeader) {
      setUsersError("Not authenticated.");
      return;
    }
    setDeleteLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/admin/users/${id}`, { method: "DELETE", headers: { Authorization: authHeader } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        showSuccess("User deleted successfully.");
        setDeleteConfirmId(null);
        fetchUsers();
        fetchDashboard();
      } else {
        setUsersError(data?.message || "Failed to delete user.");
      }
    } catch {
      setUsersError("Failed to delete user.");
    }
    setDeleteLoading(false);
  };

  const handleResetPassword = async (id) => {
    if (!newPassword.trim()) return;
    const authHeader = getAuthHeader();
    if (!authHeader) {
      setUsersError("Not authenticated.");
      return;
    }
    setResetPasswordLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/admin/users/${id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "text/plain", Authorization: authHeader },
        body: newPassword.trim(),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        showSuccess("Password reset successfully.");
        setResetPasswordId(null);
        setNewPassword("");
      } else {
        setUsersError(data?.message || "Failed to reset password.");
      }
    } catch {
      setUsersError("Failed to reset password.");
    }
    setResetPasswordLoading(false);
  };

  const handleActivate = async (id) => {
    const authHeader = getAuthHeader();
    if (!authHeader) {
      setUsersError("Not authenticated.");
      return;
    }
    try {
      const res = await fetch(`${BASE_URL}/api/admin/users/${id}/activate`, { method: "PUT", headers: { Authorization: authHeader } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        showSuccess("User activated.");
        fetchUsers();
      } else {
        setUsersError(data?.message || "Failed to activate.");
      }
    } catch {
      setUsersError("Failed to activate user.");
    }
  };

  const handleDeactivate = async (id) => {
    const authHeader = getAuthHeader();
    if (!authHeader) {
      setUsersError("Not authenticated.");
      return;
    }
    try {
      const res = await fetch(`${BASE_URL}/api/admin/users/${id}/deactivate`, { method: "PUT", headers: { Authorization: authHeader } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        showSuccess("User deactivated.");
        fetchUsers();
      } else {
        setUsersError(data?.message || "Failed to deactivate.");
      }
    } catch {
      setUsersError("Failed to deactivate user.");
    }
  };

  const handleApproveRequest = async (attendanceId) => {
    const authHeader = getAuthHeader();
    if (!authHeader) {
      setPendingError("Not authenticated.");
      return;
    }
    setApprovingId(attendanceId);
    try {
      const res = await fetch(`${BASE_URL}/api/admin/attendance/${attendanceId}/approve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({ status: "APPROVED", rejectionReason: null }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success !== false) {
        showSuccess("Request approved. Employee will see status as Approved.");
        fetchPendingRequests();
        if (view === "overview") fetchDashboard();
      } else {
        setPendingError(data?.message || "Failed to approve request.");
      }
    } catch {
      setPendingError("Failed to approve request.");
    }
    setApprovingId(null);
  };

  const handleRejectRequest = async (attendanceId, reason) => {
    const authHeader = getAuthHeader();
    if (!authHeader) {
      setPendingError("Not authenticated.");
      return;
    }
    setRejectingId(attendanceId);
    try {
      const res = await fetch(`${BASE_URL}/api/admin/attendance/${attendanceId}/approve`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: authHeader },
        body: JSON.stringify({ status: "REJECTED", rejectionReason: reason?.trim() || null }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success !== false) {
        showSuccess("Request rejected.");
        setRejectModalId(null);
        setRejectReason("");
        fetchPendingRequests();
        if (view === "overview") fetchDashboard();
      } else {
        setPendingError(data?.message || "Failed to reject request.");
      }
    } catch {
      setPendingError("Failed to reject request.");
    }
    setRejectingId(null);
  };

  const applyUsersSearch = () => {
    setUsersSearchQuery(usersSearchInput.trim());
    setUsersPage(0);
  };

  const applySitesSearch = () => {
    setSitesSearchQuery(sitesSearchInput.trim());
    setSitesPage(0);
  };

  return (
    <div
      className={`admin-dashboard${view === "machinery" || view === "notices" || view === "siteWorkflow" ? " admin-dashboard--wide" : ""}${view === "siteWorkflow" ? " admin-dashboard--workflow" : ""}`}
    >
      <nav className="admin-nav">
        <button type="button" className={`admin-nav-btn ${view === "overview" ? "active" : ""}`} onClick={() => setView("overview")}>
          Dashboard
        </button>
        <button type="button" className={`admin-nav-btn ${view === "pending" ? "active" : ""}`} onClick={() => setView("pending")}>
          Pending Approvals
        </button>
        <button type="button" className={`admin-nav-btn ${view === "users" ? "active" : ""}`} onClick={() => setView("users")}>
          User Management
        </button>
        <button type="button" className={`admin-nav-btn ${view === "sites" ? "active" : ""}`} onClick={() => setView("sites")}>
          Sites
        </button>
        <button type="button" className={`admin-nav-btn ${view === "machinery" ? "active" : ""}`} onClick={() => setView("machinery")}>
          Machinery
        </button>
        <button type="button" className={`admin-nav-btn ${view === "notices" ? "active" : ""}`} onClick={() => setView("notices")}>
          Notices
        </button>
      </nav>

      {successMessage ? <div className="alert alert-success py-2 mb-2">{successMessage}</div> : null}

      {view === "machinery" && <AdminMachineryPanel showSuccess={showSuccess} onCatalogChange={fetchDashboard} />}

      {view === "notices" && <AdminNoticesPanel showSuccess={showSuccess} />}

      {view === "siteWorkflow" && workflowSiteId != null && (
        <AdminSiteJobWorkflow
          siteId={workflowSiteId}
          showSuccess={showSuccess}
          onExit={() => {
            setView("overview");
            setWorkflowSiteId(null);
          }}
        />
      )}

      {view === "overview" && (
        <section className="dashboard-section">
          <h2 className="section-title">Admin Overview</h2>
          {dashboardLoading ? (
            <p className="text-muted mb-0">Loading dashboard...</p>
          ) : dashboardError ? (
            <div className="alert alert-danger py-2">{dashboardError}</div>
          ) : dashboardData ? (
            <>
              <div className="admin-stats-grid">
                <div className="admin-stat-card">
                  <span className="admin-stat-value">{dashboardData.totalEmployees ?? 0}</span>
                  <span className="admin-stat-label">Total Employees</span>
                </div>
                <div className="admin-stat-card">
                  <span className="admin-stat-value">{dashboardData.todayAttendanceCount ?? 0}</span>
                  <span className="admin-stat-label">Today&apos;s Attendance</span>
                </div>
                <button
                  type="button"
                  className="admin-stat-card admin-stat-card--clickable"
                  onClick={() => setView("pending")}
                  aria-label="View pending approval requests"
                >
                  <span className="admin-stat-value">{dashboardData.pendingApprovals ?? 0}</span>
                  <span className="admin-stat-label">Pending Approvals</span>
                </button>
                <div className="admin-stat-card">
                  <span className="admin-stat-value">{dashboardData.approvedCount ?? 0}</span>
                  <span className="admin-stat-label">Approved</span>
                </div>
                <div className="admin-stat-card">
                  <span className="admin-stat-value">{dashboardData.rejectedCount ?? 0}</span>
                  <span className="admin-stat-label">Rejected</span>
                </div>
              </div>
              {dashboardData.siteStats && dashboardData.siteStats.length > 0 && (
                <div className="admin-site-stats mt-3">
                  <h3 className="h6 mb-2">Site-wise stats</h3>
                  <div className="table-responsive">
                    <table className="table table-bordered table-sm">
                      <thead>
                        <tr>
                          <th>Site</th>
                          <th>Job Code</th>
                          <th>In charge</th>
                          <th>Today</th>
                          <th>Pending</th>
                          <th>Approved</th>
                          <th>Rejected</th>
                        </tr>
                      </thead>
                      <tbody>
                        {dashboardData.siteStats.map((s) => (
                          <tr key={s.siteId ?? s.siteName}>
                            <td>
                              {s.siteId != null ? (
                                <button
                                  type="button"
                                  className="btn btn-link p-0 align-baseline text-start"
                                  onClick={() => {
                                    setWorkflowSiteId(s.siteId);
                                    setView("siteWorkflow");
                                  }}
                                >
                                  {s.siteName ?? s.siteId}
                                </button>
                              ) : (
                                (s.siteName ?? s.siteId)
                              )}
                            </td>
                            <td>
                              {s.siteId != null ? (
                                <button
                                  type="button"
                                  className="btn btn-link p-0 align-baseline"
                                  onClick={() => {
                                    setWorkflowSiteId(s.siteId);
                                    setView("siteWorkflow");
                                  }}
                                >
                                  {s.jobCode ?? "—"}
                                </button>
                              ) : (
                                (s.jobCode ?? "—")
                              )}
                            </td>
                            <td>
                              <SiteStatInChargeCell stat={s} sitesById={dashboardSitesById} usersById={dashboardDirectoryUsersById} />
                            </td>
                            <td>{s.todayAttendanceCount ?? 0}</td>
                            <td>{s.pendingApprovals ?? 0}</td>
                            <td>{s.approvedCount ?? 0}</td>
                            <td>{s.rejectedCount ?? 0}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </section>
      )}

      {view === "pending" && (
        <section className="dashboard-section">
          <h2 className="section-title">Employee Requests Awaiting Approval</h2>
          <p className="small text-muted mb-2">Filter by date, employee user ID, site ID, or job code. Results are paginated.</p>
          <div className="row g-2 align-items-end mb-3">
            <div className="col-6 col-md-4 col-lg-2">
              <label className="form-label small mb-0" htmlFor="pending-filter-date">
                Date
              </label>
              <input
                id="pending-filter-date"
                type="date"
                className="form-control form-control-sm"
                value={pendingDateFilter}
                onChange={(e) => setPendingDateFilter(e.target.value)}
              />
            </div>
            <div className="col-6 col-md-4 col-lg-2">
              <label className="form-label small mb-0" htmlFor="pending-filter-emp">
                Employee user ID
              </label>
              <input
                id="pending-filter-emp"
                type="text"
                className="form-control form-control-sm"
                placeholder="e.g. 12"
                value={pendingEmployeeIdFilter}
                onChange={(e) => setPendingEmployeeIdFilter(e.target.value)}
              />
            </div>
            <div className="col-6 col-md-4 col-lg-2">
              <label className="form-label small mb-0" htmlFor="pending-filter-site">
                Site ID
              </label>
              <input
                id="pending-filter-site"
                type="text"
                className="form-control form-control-sm"
                placeholder="Site id"
                value={pendingSiteIdFilter}
                onChange={(e) => setPendingSiteIdFilter(e.target.value)}
              />
            </div>
            <div className="col-6 col-md-4 col-lg-2">
              <label className="form-label small mb-0" htmlFor="pending-filter-job">
                Job code
              </label>
              <input
                id="pending-filter-job"
                type="text"
                className="form-control form-control-sm"
                placeholder="Job code"
                value={pendingJobCodeFilter}
                onChange={(e) => setPendingJobCodeFilter(e.target.value)}
              />
            </div>
            <div className="col-12 col-md-4 col-lg-auto d-flex gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm align-self-end"
                onClick={() => {
                  setPendingDateFilter("");
                  setPendingEmployeeIdFilter("");
                  setPendingSiteIdFilter("");
                  setPendingJobCodeFilter("");
                  setPendingPage(0);
                }}
              >
                Clear filters
              </button>
            </div>
          </div>
          {pendingError ? <div className="alert alert-danger py-2 mb-2">{pendingError}</div> : null}
          {pendingLoading ? (
            <p className="text-muted mb-0">Loading pending requests...</p>
          ) : pendingRequests.length === 0 ? (
            <p className="text-muted mb-0">No pending requests.</p>
          ) : (
            <>
              <div className="table-responsive">
                <table className="table table-bordered table-hover">
                  <thead>
                    <tr>
                      <th>Photo</th>
                      <th>Employee</th>
                      <th>Site</th>
                      <th>Date</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pendingRequests.map((req) => {
                      const dateVal = req.date ?? req.attendanceDate;
                      const dateStr = dateVal ? (typeof dateVal === "string" ? dateVal.slice(0, 10) : new Date(dateVal).toISOString().slice(0, 10)) : "—";
                      const displayDate = dateStr !== "—" ? new Date(dateStr + "Z").toLocaleDateString("default", { dateStyle: "medium" }) : "—";
                      const employeeName = req.employeeName ?? req.user?.name ?? req.employee?.name ?? req.name ?? "—";
                      const employeeId = req.employeeId ?? req.user?.employeeId ?? req.employee?.employeeId ?? "";
                      const siteName = req.site?.name ?? req.siteName ?? (req.siteId ? `Site ${req.siteId}` : "—");
                      return (
                        <tr key={req.id ?? `${req.employeeId ?? ""}-${dateStr}-${req.siteId ?? ""}`}>
                          <td className="align-middle">
                            <AttendancePhotoThumb row={req} alt={`Attendance ${displayDate}`} />
                          </td>
                          <td>
                            {employeeName}
                            {employeeId ? ` (${employeeId})` : ""}
                          </td>
                          <td>{siteName}</td>
                          <td>{displayDate}</td>
                          <td>
                            <div className="admin-actions">
                              <button
                                type="button"
                                className="btn btn-success btn-sm"
                                onClick={() => handleApproveRequest(req.id)}
                                disabled={approvingId === req.id || rejectingId === req.id}
                              >
                                {approvingId === req.id ? "Approving..." : "Approve"}
                              </button>
                              <button
                                type="button"
                                className="btn btn-danger btn-sm"
                                onClick={() => {
                                  setRejectModalId(req.id);
                                  setRejectReason("");
                                  setPendingError("");
                                }}
                                disabled={approvingId === req.id || rejectingId === req.id}
                              >
                                {rejectingId === req.id ? "Rejecting..." : "Reject"}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {pendingTotal > 0 ? (
                <div className="d-flex justify-content-between align-items-center mt-2 flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={pendingPage === 0}
                    onClick={() => setPendingPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </button>
                  <span className="small text-muted">
                    Page {pendingPage + 1} of {pendingTotalPages} ({pendingTotal} total)
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={pendingPage >= pendingTotalPages - 1}
                    onClick={() => setPendingPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      )}

      {view === "users" && (
        <section className="dashboard-section">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
            <h2 className="section-title mb-0">Users</h2>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => { setCreateOpen(true); setSaveError(""); }}>
              Create User
            </button>
          </div>
          <p className="small text-muted mb-2">Search by name, email, or employee ID (case-insensitive). Filter by role and status.</p>
          <div className="row g-2 align-items-end mb-3">
            <div className="col-12 col-md-5 col-lg-4">
              <label className="form-label small mb-0" htmlFor="users-search-input">
                Search
              </label>
              <div className="input-group input-group-sm">
                <input
                  id="users-search-input"
                  type="search"
                  className="form-control"
                  placeholder="Name, email, employee ID…"
                  value={usersSearchInput}
                  onChange={(e) => setUsersSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applyUsersSearch();
                  }}
                />
                <button type="button" className="btn btn-outline-secondary" onClick={applyUsersSearch}>
                  Search
                </button>
              </div>
            </div>
            <div className="col-6 col-md-3 col-lg-2">
              <label className="form-label small mb-0" htmlFor="users-filter-role">
                Role
              </label>
              <select
                id="users-filter-role"
                className="form-select form-select-sm"
                value={usersRoleFilter}
                onChange={(e) => setUsersRoleFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="EMPLOYEE">Employee</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <div className="col-6 col-md-3 col-lg-2">
              <label className="form-label small mb-0" htmlFor="users-filter-status">
                Status
              </label>
              <select
                id="users-filter-status"
                className="form-select form-select-sm"
                value={usersStatusFilter}
                onChange={(e) => setUsersStatusFilter(e.target.value)}
              >
                <option value="">All</option>
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </div>
          </div>
          {usersError ? <div className="alert alert-danger py-2 mb-2">{usersError}</div> : null}
          {usersLoading ? (
            <p className="text-muted mb-0">Loading users...</p>
          ) : (
            <>
              <div className="table-responsive">
                <table className="table table-bordered table-hover">
                  <thead>
                    <tr>
                      <th>Employee ID</th>
                      <th>Name</th>
                      <th>Email</th>
                      <th>Role</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr><td colSpan={6} className="text-muted text-center">No users found.</td></tr>
                    ) : (
                      users.map((u) => (
                        <tr key={u.id ?? u.employeeId}>
                          <td>{u.employeeId ?? "—"}</td>
                          <td>{u.name ?? "—"}</td>
                          <td>{u.email ?? "—"}</td>
                          <td>{u.role ?? "—"}</td>
                          <td>{u.status ?? u.employeeStatus ?? "—"}</td>
                          <td>
                            <div className="admin-actions">
                              <button type="button" className="btn btn-outline-primary btn-sm" onClick={() => { setEditUserId(u.id); setSaveError(""); }}>Edit</button>
                              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => { setResetPasswordId(u.id); setNewPassword(""); }}>Reset PW</button>
                              {(u.status === "INACTIVE" || u.employeeStatus === "SUSPENDED") ? (
                                <button type="button" className="btn btn-outline-success btn-sm" onClick={() => handleActivate(u.id)}>Activate</button>
                              ) : (
                                <button type="button" className="btn btn-outline-warning btn-sm" onClick={() => handleDeactivate(u.id)}>Deactivate</button>
                              )}
                              <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => setDeleteConfirmId(u.id)}>Delete</button>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
              {usersTotal > 0 ? (
                <div className="d-flex justify-content-between align-items-center mt-2 flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={usersPage === 0}
                    onClick={() => setUsersPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </button>
                  <span className="small text-muted">
                    Page {usersPage + 1} of {usersTotalPages} ({usersTotal} total)
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={usersPage >= usersTotalPages - 1}
                    onClick={() => setUsersPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      )}

      {view === "sites" && (
        <section className="dashboard-section">
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
            <h2 className="section-title mb-0">Sites</h2>
            <div className="d-flex flex-wrap align-items-center gap-2">
              <div className="btn-group btn-group-sm" role="group" aria-label="Site list filter">
                <button
                  type="button"
                  className={`btn ${sitesListFilter === "all" ? "btn-primary" : "btn-outline-primary"}`}
                  onClick={() => setSitesListFilter("all")}
                >
                  All
                </button>
                <button
                  type="button"
                  className={`btn ${sitesListFilter === "active" ? "btn-primary" : "btn-outline-primary"}`}
                  onClick={() => setSitesListFilter("active")}
                >
                  Active only
                </button>
                <button
                  type="button"
                  className={`btn ${sitesListFilter === "inactive" ? "btn-primary" : "btn-outline-primary"}`}
                  onClick={() => setSitesListFilter("inactive")}
                >
                  Inactive only
                </button>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={() => {
                  setCreateSiteOpen(true);
                  setSiteSaveError("");
                }}
              >
                Create Site
              </button>
            </div>
          </div>
          <p className="small text-muted mb-2">Search by site name, job code, or address. Results are paginated.</p>
          <div className="row g-2 align-items-end mb-3">
            <div className="col-12 col-md-6 col-lg-5">
              <label className="form-label small mb-0" htmlFor="sites-search-input">
                Search
              </label>
              <div className="input-group input-group-sm">
                <input
                  id="sites-search-input"
                  type="search"
                  className="form-control"
                  placeholder="Name, job code, address…"
                  value={sitesSearchInput}
                  onChange={(e) => setSitesSearchInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") applySitesSearch();
                  }}
                />
                <button type="button" className="btn btn-outline-secondary" onClick={applySitesSearch}>
                  Search
                </button>
              </div>
            </div>
          </div>
          {sitesError ? <div className="alert alert-danger py-2 mb-2">{sitesError}</div> : null}
          {sitesLoading ? (
            <p className="text-muted mb-0">Loading sites...</p>
          ) : (
            <>
              <div className="table-responsive">
              <table className="table table-bordered table-hover">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Name</th>
                    <th>Job code</th>
                    <th>In charge</th>
                    <th>Address</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sites.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-muted text-center">
                        No sites found.
                      </td>
                    </tr>
                  ) : (
                    sites.map((s) => {
                      const id = s.id ?? s.siteId;
                      const active = s.isActive !== false && s.active !== false;
                      return (
                        <tr key={id ?? s.jobCode ?? s.name}>
                          <td>{id ?? "—"}</td>
                          <td>
                            {id != null ? (
                              <button
                                type="button"
                                className="btn btn-link p-0 align-baseline text-start"
                                onClick={() => {
                                  setWorkflowSiteId(id);
                                  setView("siteWorkflow");
                                }}
                              >
                                {s.name ?? "—"}
                              </button>
                            ) : (
                              (s.name ?? "—")
                            )}
                          </td>
                          <td>
                            {id != null ? (
                              <button
                                type="button"
                                className="btn btn-link p-0 align-baseline"
                                onClick={() => {
                                  setWorkflowSiteId(id);
                                  setView("siteWorkflow");
                                }}
                              >
                                {s.jobCode ?? "—"}
                              </button>
                            ) : (
                              (s.jobCode ?? "—")
                            )}
                          </td>
                          <td className="small">{formatSiteInChargeDisplay(s)}</td>
                          <td>{s.address ?? "—"}</td>
                          <td>{active ? "Active" : "Inactive"}</td>
                          <td>
                            <div className="admin-actions">
                              <button
                                type="button"
                                className="btn btn-outline-primary btn-sm"
                                disabled={id == null}
                                onClick={() => setViewingSiteId(id)}
                              >
                                View
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline-dark btn-sm"
                                disabled={id == null}
                                onClick={() => {
                                  setWorkflowSiteId(id);
                                  setView("siteWorkflow");
                                }}
                              >
                                Job workflow
                              </button>
                              <button
                                type="button"
                                className="btn btn-outline-secondary btn-sm"
                                disabled={id == null}
                                onClick={() => {
                                  setEditSiteId(id);
                                  setSiteSaveError("");
                                }}
                              >
                                Edit
                              </button>
                              {active ? (
                                <button
                                  type="button"
                                  className="btn btn-outline-warning btn-sm"
                                  disabled={id == null}
                                  onClick={() => handleDeactivateSite(id)}
                                >
                                  Deactivate
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  className="btn btn-outline-success btn-sm"
                                  disabled={id == null}
                                  onClick={() => handleActivateSite(id)}
                                >
                                  Activate
                                </button>
                              )}
                              <button
                                type="button"
                                className="btn btn-outline-danger btn-sm"
                                disabled={id == null}
                                onClick={() => setDeleteSiteConfirmId(id)}
                              >
                                Delete
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
              {sitesTotal > 0 ? (
                <div className="d-flex justify-content-between align-items-center mt-2 flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={sitesPage === 0}
                    onClick={() => setSitesPage((p) => Math.max(0, p - 1))}
                  >
                    Previous
                  </button>
                  <span className="small text-muted">
                    Page {sitesPage + 1} of {sitesTotalPages} ({sitesTotal} total)
                  </span>
                  <button
                    type="button"
                    className="btn btn-outline-secondary btn-sm"
                    disabled={sitesPage >= sitesTotalPages - 1}
                    onClick={() => setSitesPage((p) => p + 1)}
                  >
                    Next
                  </button>
                </div>
              ) : null}
            </>
          )}
        </section>
      )}

      {viewingSiteId != null && (
        <div className="admin-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="site-detail-title">
          <div className="admin-modal admin-modal--wide">
            <div className="d-flex justify-content-between align-items-center mb-3">
              <h3 id="site-detail-title" className="h5 mb-0">
                Site details
              </h3>
              <button type="button" className="btn-close" aria-label="Close" onClick={closeSiteDetail} />
            </div>
            {siteDetailLoading ? (
              <p className="text-muted mb-0">Loading...</p>
            ) : siteDetailError ? (
              <div className="alert alert-danger py-2 mb-0">{siteDetailError}</div>
            ) : siteDetail ? (
              <dl className="row mb-0 small">
                <dt className="col-sm-3">ID</dt>
                <dd className="col-sm-9">{siteDetail.id ?? "—"}</dd>
                <dt className="col-sm-3">Name</dt>
                <dd className="col-sm-9">{siteDetail.name ?? "—"}</dd>
                <dt className="col-sm-3">Job code</dt>
                <dd className="col-sm-9">{siteDetail.jobCode ?? "—"}</dd>
                <dt className="col-sm-3">In charge</dt>
                <dd className="col-sm-9">{formatSiteInChargeDisplay(siteDetail)}</dd>
                <dt className="col-sm-3">Address</dt>
                <dd className="col-sm-9">{siteDetail.address ?? "—"}</dd>
                <dt className="col-sm-3">Active</dt>
                <dd className="col-sm-9">{siteDetail.isActive !== false && siteDetail.active !== false ? "Yes" : "No"}</dd>
                <dt className="col-sm-3">Created</dt>
                <dd className="col-sm-9">{formatSiteDateTime(siteDetail.createdAt)}</dd>
                <dt className="col-sm-3">Updated</dt>
                <dd className="col-sm-9">{formatSiteDateTime(siteDetail.updatedAt)}</dd>
              </dl>
            ) : null}
            <div className="d-flex justify-content-end mt-3">
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={closeSiteDetail}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {createSiteOpen && (
        <CreateSiteModal
          onClose={() => {
            setCreateSiteOpen(false);
            setSiteSaveError("");
          }}
          onSave={handleCreateSite}
          loading={siteSaveLoading}
          error={siteSaveError}
        />
      )}

      {editSiteId && (
        <EditSiteModal
          site={editSite}
          loading={editSiteLoading}
          saveLoading={siteSaveLoading}
          error={siteSaveError}
          onClose={() => {
            setEditSiteId(null);
            setEditSite(null);
            setSiteSaveError("");
          }}
          onSave={(payload) => handleUpdateSite(editSiteId, payload)}
        />
      )}

      {deleteSiteConfirmId != null && (
        <div className="admin-modal-backdrop" role="dialog">
          <div className="admin-modal">
            <p>Delete this site? This cannot be undone.</p>
            <div className="d-flex gap-2 justify-content-end">
              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setDeleteSiteConfirmId(null)}
                disabled={deleteSiteLoading}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => handleDeleteSite(deleteSiteConfirmId)}
                disabled={deleteSiteLoading}
              >
                {deleteSiteLoading ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}

      {createOpen && (
        <CreateUserModal
          onClose={() => { setCreateOpen(false); setSaveError(""); }}
          onSave={handleCreateUser}
          loading={saveLoading}
          error={saveError}
        />
      )}

      {editUserId && (
        <EditUserModal
          user={editUser}
          loading={editLoading}
          saveLoading={saveLoading}
          error={saveError}
          onClose={() => { setEditUserId(null); setEditUser(null); setSaveError(""); }}
          onSave={(payload) => handleUpdateUser(editUserId, payload)}
        />
      )}

      {deleteConfirmId && (
        <div className="admin-modal-backdrop" role="dialog">
          <div className="admin-modal">
            <p>Are you sure you want to delete this user?</p>
            <div className="d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-outline-secondary" onClick={() => setDeleteConfirmId(null)} disabled={deleteLoading}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={() => handleDeleteUser(deleteConfirmId)} disabled={deleteLoading}>{deleteLoading ? "Deleting..." : "Delete"}</button>
            </div>
          </div>
        </div>
      )}

      {resetPasswordId && (
        <div className="admin-modal-backdrop" role="dialog">
          <div className="admin-modal">
            <h3 className="h6 mb-2">Reset password</h3>
            <input
              type="password"
              className="form-control mb-2"
              placeholder="New password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <div className="d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-outline-secondary" onClick={() => { setResetPasswordId(null); setNewPassword(""); }} disabled={resetPasswordLoading}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={() => handleResetPassword(resetPasswordId)} disabled={resetPasswordLoading || !newPassword.trim()}>{resetPasswordLoading ? "Saving..." : "Reset"}</button>
            </div>
          </div>
        </div>
      )}

      {rejectModalId && (
        <div className="admin-modal-backdrop" role="dialog">
          <div className="admin-modal">
            <h3 className="h6 mb-2">Reject attendance request</h3>
            <p className="small text-muted mb-2">Optionally provide a reason (e.g. &quot;Photo quality is poor&quot;). The employee may see this reason.</p>
            <textarea
              className="form-control mb-2"
              placeholder="Rejection reason (optional)"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
            />
            <div className="d-flex gap-2 justify-content-end">
              <button type="button" className="btn btn-outline-secondary" onClick={() => { setRejectModalId(null); setRejectReason(""); }} disabled={rejectingId === rejectModalId}>Cancel</button>
              <button type="button" className="btn btn-danger" onClick={() => handleRejectRequest(rejectModalId, rejectReason)} disabled={rejectingId === rejectModalId}>{rejectingId === rejectModalId ? "Rejecting..." : "Reject"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CreateSiteModal({ onClose, onSave, loading, error }) {
  const [form, setForm] = useState({ name: "", jobCode: "", address: "", inChargeUserId: "" });
  const [userOptions, setUserOptions] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetchAdminUsersForSiteInchargeDropdown().then((list) => {
      if (!cancelled) setUserOptions(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="admin-modal-backdrop" role="dialog">
      <div className="admin-modal admin-modal--wide">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h3 className="h5 mb-0">Create Site</h3>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </div>
        {error ? <div className="alert alert-danger py-2 mb-2">{error}</div> : null}
        <form onSubmit={handleSubmit}>
          <div className="mb-2">
            <label className="form-label small">Name</label>
            <input
              className="form-control form-control-sm"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="mb-2">
            <label className="form-label small">Job code</label>
            <input
              className="form-control form-control-sm"
              value={form.jobCode}
              onChange={(e) => setForm((f) => ({ ...f, jobCode: e.target.value }))}
              required
            />
          </div>
          <div className="mb-2">
            <label className="form-label small d-block">In charge</label>
            <UserDirectoryCombobox
              options={userOptions}
              value={form.inChargeUserId}
              onChange={(v) => setForm((f) => ({ ...f, inChargeUserId: v }))}
              placeholder="— Select from User Management —"
              ariaLabel="Site in charge (User Management directory)"
              disabled={loading}
            />
          </div>
          <div className="mb-3">
            <label className="form-label small">Address</label>
            <input
              className="form-control form-control-sm"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              required
            />
          </div>
          <div className="d-flex gap-2 justify-content-end">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? "Creating..." : "Create"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditSiteModal({ site, loading, saveLoading, error, onClose, onSave }) {
  const [form, setForm] = useState(null);
  const [userOptions, setUserOptions] = useState([]);

  useEffect(() => {
    let cancelled = false;
    fetchAdminUsersForSiteInchargeDropdown().then((list) => {
      if (!cancelled) setUserOptions(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- edit form mirrors GET /sites/:id payload */
  useEffect(() => {
    if (site) {
      setForm({
        name: site.name ?? "",
        jobCode: site.jobCode ?? "",
        address: site.address ?? "",
        isActive: site.isActive !== false && site.active !== false,
        inChargeUserId: getSiteInChargeUserId(site),
      });
    } else {
      setForm(null);
    }
  }, [site]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (loading) {
    return (
      <div className="admin-modal-backdrop">
        <div className="admin-modal">
          <p className="mb-0">Loading site...</p>
        </div>
      </div>
    );
  }
  if (!form) {
    return (
      <div className="admin-modal-backdrop">
        <div className="admin-modal">
          <p className="mb-0">Site not found.</p>
          <button type="button" className="btn btn-sm btn-outline-secondary mt-2" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  return (
    <div className="admin-modal-backdrop" role="dialog">
      <div className="admin-modal admin-modal--wide">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h3 className="h5 mb-0">Edit Site</h3>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </div>
        {error ? <div className="alert alert-danger py-2 mb-2">{error}</div> : null}
        <form onSubmit={handleSubmit}>
          <div className="mb-2">
            <label className="form-label small">Name</label>
            <input
              className="form-control form-control-sm"
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              required
            />
          </div>
          <div className="mb-2">
            <label className="form-label small">Job code</label>
            <input
              className="form-control form-control-sm"
              value={form.jobCode}
              onChange={(e) => setForm((f) => ({ ...f, jobCode: e.target.value }))}
              required
            />
          </div>
          <div className="mb-2">
            <label className="form-label small d-block">In charge</label>
            <UserDirectoryCombobox
              options={userOptions}
              value={form.inChargeUserId}
              onChange={(v) => setForm((f) => ({ ...f, inChargeUserId: v }))}
              placeholder="— Select from User Management —"
              ariaLabel="Site in charge (User Management directory)"
              disabled={saveLoading}
            />
          </div>
          <div className="mb-2">
            <label className="form-label small">Address</label>
            <input
              className="form-control form-control-sm"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              required
            />
          </div>
          <div className="form-check mb-3">
            <input
              type="checkbox"
              className="form-check-input"
              id="site-edit-active"
              checked={form.isActive}
              onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))}
            />
            <label className="form-check-label small" htmlFor="site-edit-active">
              Active
            </label>
          </div>
          <div className="d-flex gap-2 justify-content-end">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saveLoading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={saveLoading}>
              {saveLoading ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CreateUserModal({ onClose, onSave, loading, error }) {
  const [form, setForm] = useState({
    employeeId: "",
    name: "",
    email: "",
    password: "",
    role: "EMPLOYEE",
    address: "",
    dateOfBirth: "",
    bloodGroup: "A_POSITIVE",
    employeeStatus: "ACTIVE",
    fatherName: "",
    dateOfJoining: "",
    officeContactNumber: "",
    homeContactNumber: "",
    otherContactNumber: "",
    identificationMark: "",
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { ...form };
    if (!payload.dateOfBirth) delete payload.dateOfBirth;
    if (!payload.dateOfJoining) delete payload.dateOfJoining;
    onSave(payload);
  };

  return (
    <div className="admin-modal-backdrop" role="dialog">
      <div className="admin-modal admin-modal--wide">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h3 className="h5 mb-0">Create User</h3>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </div>
        {error ? <div className="alert alert-danger py-2 mb-2">{error}</div> : null}
        <form onSubmit={handleSubmit}>
          <div className="row g-2 mb-2">
            <div className="col-6"><label className="form-label small">Employee ID</label><input className="form-control form-control-sm" value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))} required /></div>
            <div className="col-6"><label className="form-label small">Name</label><input className="form-control form-control-sm" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required /></div>
          </div>
          <div className="row g-2 mb-2">
            <div className="col-6"><label className="form-label small">Email</label><input type="email" className="form-control form-control-sm" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} required /></div>
            <div className="col-6"><label className="form-label small">Password</label><input type="password" className="form-control form-control-sm" value={form.password} onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} required /></div>
          </div>
          <div className="row g-2 mb-2">
            <div className="col-6"><label className="form-label small">Role</label><select className="form-select form-select-sm" value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>{ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
            <div className="col-6"><label className="form-label small">Status</label><select className="form-select form-select-sm" value={form.employeeStatus} onChange={(e) => setForm((f) => ({ ...f, employeeStatus: e.target.value }))}>{EMPLOYEE_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
          </div>
          <div className="mb-2"><label className="form-label small">Address</label><input className="form-control form-control-sm" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} /></div>
          <div className="row g-2 mb-2">
            <div className="col-6"><label className="form-label small">Date of Birth</label><input type="date" className="form-control form-control-sm" value={form.dateOfBirth} onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))} /></div>
            <div className="col-6"><label className="form-label small">Blood Group</label><select className="form-select form-select-sm" value={form.bloodGroup} onChange={(e) => setForm((f) => ({ ...f, bloodGroup: e.target.value }))}>{BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
          </div>
          <div className="row g-2 mb-2">
            <div className="col-6"><label className="form-label small">Father Name</label><input className="form-control form-control-sm" value={form.fatherName} onChange={(e) => setForm((f) => ({ ...f, fatherName: e.target.value }))} /></div>
            <div className="col-6"><label className="form-label small">Date of Joining</label><input type="date" className="form-control form-control-sm" value={form.dateOfJoining} onChange={(e) => setForm((f) => ({ ...f, dateOfJoining: e.target.value }))} /></div>
          </div>
          <div className="row g-2 mb-2">
            <div className="col-4"><label className="form-label small">Office Contact</label><input className="form-control form-control-sm" value={form.officeContactNumber} onChange={(e) => setForm((f) => ({ ...f, officeContactNumber: e.target.value }))} /></div>
            <div className="col-4"><label className="form-label small">Home Contact</label><input className="form-control form-control-sm" value={form.homeContactNumber} onChange={(e) => setForm((f) => ({ ...f, homeContactNumber: e.target.value }))} /></div>
            <div className="col-4"><label className="form-label small">Other Contact</label><input className="form-control form-control-sm" value={form.otherContactNumber} onChange={(e) => setForm((f) => ({ ...f, otherContactNumber: e.target.value }))} /></div>
          </div>
          <div className="mb-3"><label className="form-label small">Identification Mark</label><input className="form-control form-control-sm" value={form.identificationMark} onChange={(e) => setForm((f) => ({ ...f, identificationMark: e.target.value }))} /></div>
          <div className="d-flex gap-2 justify-content-end">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={loading}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading}>{loading ? "Creating..." : "Create"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EditUserModal({ user, loading, saveLoading, error, onClose, onSave }) {
  const [form, setForm] = useState(null);

  /* eslint-disable react-hooks/set-state-in-effect -- form mirrors loaded user */
  useEffect(() => {
    if (user) setForm({ ...user });
    else setForm(null);
  }, [user]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (loading) return (
    <div className="admin-modal-backdrop"><div className="admin-modal"><p className="mb-0">Loading user...</p></div></div>
  );
  if (!form) return (
    <div className="admin-modal-backdrop"><div className="admin-modal"><p className="mb-0">User not found.</p><button type="button" className="btn btn-sm btn-outline-secondary mt-2" onClick={onClose}>Close</button></div></div>
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    onSave(form);
  };

  const update = (key, value) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="admin-modal-backdrop" role="dialog">
      <div className="admin-modal admin-modal--wide">
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h3 className="h5 mb-0">Edit User</h3>
          <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
        </div>
        {error ? <div className="alert alert-danger py-2 mb-2">{error}</div> : null}
        <form onSubmit={handleSubmit}>
          <div className="row g-2 mb-2">
            <div className="col-6"><label className="form-label small">Employee ID</label><input className="form-control form-control-sm" value={form.employeeId ?? ""} onChange={(e) => update("employeeId", e.target.value)} /></div>
            <div className="col-6"><label className="form-label small">Name</label><input className="form-control form-control-sm" value={form.name ?? ""} onChange={(e) => update("name", e.target.value)} /></div>
          </div>
          <div className="mb-2"><label className="form-label small">Email</label><input type="email" className="form-control form-control-sm" value={form.email ?? ""} onChange={(e) => update("email", e.target.value)} /></div>
          <div className="row g-2 mb-2">
            <div className="col-6"><label className="form-label small">Role</label><select className="form-select form-select-sm" value={form.role ?? "EMPLOYEE"} onChange={(e) => update("role", e.target.value)}>{ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}</select></div>
            <div className="col-6"><label className="form-label small">Status</label><input className="form-control form-control-sm" value={form.status ?? form.employeeStatus ?? ""} onChange={(e) => update("status", e.target.value)} /></div>
          </div>
          <div className="mb-2"><label className="form-label small">Address</label><input className="form-control form-control-sm" value={form.address ?? ""} onChange={(e) => update("address", e.target.value)} /></div>
          <div className="row g-2 mb-2">
            <div className="col-6"><label className="form-label small">Date of Birth</label><input type="date" className="form-control form-control-sm" value={form.dateOfBirth ? String(form.dateOfBirth).slice(0, 10) : ""} onChange={(e) => update("dateOfBirth", e.target.value)} /></div>
            <div className="col-6"><label className="form-label small">Blood Group</label><select className="form-select form-select-sm" value={form.bloodGroup ?? "A_POSITIVE"} onChange={(e) => update("bloodGroup", e.target.value)}>{BLOOD_GROUPS.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
          </div>
          <div className="row g-2 mb-2">
            <div className="col-6"><label className="form-label small">Father Name</label><input className="form-control form-control-sm" value={form.fatherName ?? ""} onChange={(e) => update("fatherName", e.target.value)} /></div>
            <div className="col-6"><label className="form-label small">Date of Joining</label><input type="date" className="form-control form-control-sm" value={form.dateOfJoining ? String(form.dateOfJoining).slice(0, 10) : ""} onChange={(e) => update("dateOfJoining", e.target.value)} /></div>
          </div>
          <div className="row g-2 mb-2">
            <div className="col-4"><label className="form-label small">Office Contact</label><input className="form-control form-control-sm" value={form.officeContactNumber ?? ""} onChange={(e) => update("officeContactNumber", e.target.value)} /></div>
            <div className="col-4"><label className="form-label small">Home Contact</label><input className="form-control form-control-sm" value={form.homeContactNumber ?? ""} onChange={(e) => update("homeContactNumber", e.target.value)} /></div>
            <div className="col-4"><label className="form-label small">Other Contact</label><input className="form-control form-control-sm" value={form.otherContactNumber ?? ""} onChange={(e) => update("otherContactNumber", e.target.value)} /></div>
          </div>
          <div className="mb-3"><label className="form-label small">Identification Mark</label><input className="form-control form-control-sm" value={form.identificationMark ?? ""} onChange={(e) => update("identificationMark", e.target.value)} /></div>
          <div className="d-flex gap-2 justify-content-end">
            <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saveLoading}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saveLoading}>{saveLoading ? "Saving..." : "Save"}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
