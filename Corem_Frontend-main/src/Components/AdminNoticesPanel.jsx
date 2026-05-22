import { useCallback, useEffect, useMemo, useState } from "react";

import { API_BASE_URL as BASE_URL } from "../config/apiBaseUrl.js";
import UserDirectoryCombobox from "./UserDirectoryCombobox.jsx";

const MESSAGE_MAX = 2000;
/** Same directory size as other admin pickers (User Management list). */
const NOTICE_USER_DIRECTORY_SIZE = 500;

function getAuthHeader() {
  const tokenType = (localStorage.getItem("tokenType") || "Bearer").trim();
  let accessToken = (localStorage.getItem("accessToken") || "").trim();
  if (/^bearer\s+/i.test(accessToken)) {
    accessToken = accessToken.replace(/^bearer\s+/i, "").trim();
  }
  return accessToken ? `${tokenType} ${accessToken}` : "";
}

function formatNoticeTime(iso) {
  if (iso == null || iso === "") return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

function parseNoticesPage(data) {
  const root = data?.data;
  if (!root || typeof root !== "object") return { list: [], totalElements: 0, totalPages: 1 };
  const content = root.content;
  const list = Array.isArray(content) ? content : [];
  const totalElements = Number(root.totalElements ?? 0);
  const rawPages = Number(root.totalPages);
  const size = Number(root.size ?? 20) || 20;
  const totalPages =
    Number.isFinite(rawPages) && rawPages > 0
      ? rawPages
      : Math.max(1, Math.ceil((Number.isFinite(totalElements) ? totalElements : 0) / size));
  return { list, totalElements: Number.isFinite(totalElements) ? totalElements : 0, totalPages };
}

/** Backend may use different names until DTOs are aligned. */
function getNoticeTargetUserId(n) {
  if (!n || typeof n !== "object") return null;
  const raw = n.targetUserId ?? n.recipientUserId ?? n.userId ?? n.employeeUserId;
  if (raw == null || raw === "") return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function userLabelFromRow(u) {
  if (!u) return "";
  return String(u.name ?? "").trim() || String(u.email ?? "").trim() || (u.id != null ? `User ${u.id}` : "");
}

function formatNoticeAudience(n, userById) {
  const tid = getNoticeTargetUserId(n);
  if (tid == null) return "All employees";
  const fromApi =
    n.targetUserName ??
    n.recipientName ??
    n.targetUser?.name ??
    n.user?.name ??
    n.recipient?.name;
  if (fromApi && String(fromApi).trim()) return String(fromApi).trim();
  const u = userById[tid];
  if (u) return userLabelFromRow(u);
  return `User #${tid}`;
}

async function fetchUserDirectoryForNotices(auth) {
  try {
    const res = await fetch(`${BASE_URL}/api/admin/users?page=0&size=${NOTICE_USER_DIRECTORY_SIZE}`, {
      headers: { Authorization: auth },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.success === false) return [];
    const root = data?.data;
    let list = [];
    if (Array.isArray(root)) list = root;
    else if (root && typeof root === "object" && Array.isArray(root.content)) list = root.content;
    return [...list].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  } catch {
    return [];
  }
}

function noticePayloadTargetUserId(audience, targetUserIdStr) {
  if (audience !== "user") return null;
  const s = (targetUserIdStr || "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Admin notices: broadcast to all employees, or target one user via `targetUserId`.
 * Backend should persist `targetUserId` (null = all) and filter `GET /api/notices` for employees.
 *
 * @param {{ showSuccess: (msg: string) => void }} props
 */
export default function AdminNoticesPanel({ showSuccess }) {
  const [notices, setNotices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [editNotice, setEditNotice] = useState(null);
  const [deleteId, setDeleteId] = useState(null);
  const [saveLoading, setSaveLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [formMessage, setFormMessage] = useState("");
  const [formAudience, setFormAudience] = useState("all");
  const [formTargetUserId, setFormTargetUserId] = useState("");
  const [formError, setFormError] = useState("");
  const [noticesSearchInput, setNoticesSearchInput] = useState("");
  const [noticesSearchQuery, setNoticesSearchQuery] = useState("");
  const [noticesPage, setNoticesPage] = useState(0);
  const [noticesSize] = useState(20);
  const [noticesTotal, setNoticesTotal] = useState(0);
  const [noticesTotalPages, setNoticesTotalPages] = useState(1);
  const [noticeDirectoryUsers, setNoticeDirectoryUsers] = useState([]);
  const [noticeDirectoryLoading, setNoticeDirectoryLoading] = useState(false);

  const userById = useMemo(() => {
    const m = {};
    for (const u of noticeDirectoryUsers) {
      if (u?.id == null) continue;
      const id = Number(u.id);
      if (Number.isFinite(id)) m[id] = u;
    }
    return m;
  }, [noticeDirectoryUsers]);

  useEffect(() => {
    const auth = getAuthHeader();
    if (!auth) return;
    let cancelled = false;
    setNoticeDirectoryLoading(true);
    fetchUserDirectoryForNotices(auth)
      .then((list) => {
        if (!cancelled) setNoticeDirectoryUsers(list);
      })
      .finally(() => {
        if (!cancelled) setNoticeDirectoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const fetchNotices = useCallback(async () => {
    const auth = getAuthHeader();
    if (!auth) return;
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      params.set("page", String(noticesPage));
      params.set("size", String(noticesSize));
      const q = noticesSearchQuery.trim();
      if (q) params.set("search", q);
      const res = await fetch(`${BASE_URL}/api/admin/notices?${params.toString()}`, { headers: { Authorization: auth } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        const { list, totalElements, totalPages } = parseNoticesPage(data);
        const sorted = [...list].sort((a, b) => {
          const ta = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
          const tb = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
          return tb - ta;
        });
        setNotices(sorted);
        setNoticesTotal(totalElements);
        setNoticesTotalPages(Math.max(1, totalPages));
      } else {
        setError(data?.message || "Failed to load notices.");
        setNotices([]);
        setNoticesTotal(0);
        setNoticesTotalPages(1);
      }
    } catch {
      setError("Failed to load notices.");
      setNotices([]);
      setNoticesTotal(0);
      setNoticesTotalPages(1);
    }
    setLoading(false);
  }, [noticesPage, noticesSize, noticesSearchQuery]);

  useEffect(() => {
    fetchNotices();
  }, [fetchNotices]);

  const applyNoticeSearch = () => {
    setNoticesSearchQuery(noticesSearchInput.trim());
    setNoticesPage(0);
  };

  const openCreate = () => {
    setFormMessage("");
    setFormAudience("all");
    setFormTargetUserId("");
    setFormError("");
    setCreateOpen(true);
  };

  const openEdit = (n) => {
    const tid = getNoticeTargetUserId(n);
    setFormMessage(n.message ?? "");
    setFormAudience(tid != null ? "user" : "all");
    setFormTargetUserId(tid != null ? String(tid) : "");
    setFormError("");
    setEditNotice({ id: n.id });
  };

  const submitCreate = async (e) => {
    e.preventDefault();
    const msg = formMessage.trim();
    if (!msg) {
      setFormError("Message is required.");
      return;
    }
    if (formAudience === "user" && !(formTargetUserId || "").trim()) {
      setFormError("Choose an employee, or select “All employees”.");
      return;
    }
    const auth = getAuthHeader();
    if (!auth) return;
    setSaveLoading(true);
    setFormError("");
    const targetUserId = noticePayloadTargetUserId(formAudience, formTargetUserId);
    try {
      const res = await fetch(`${BASE_URL}/api/admin/notices`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ message: msg, targetUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        showSuccess(data.message || "Notice created successfully.");
        setCreateOpen(false);
        setFormMessage("");
        setFormAudience("all");
        setFormTargetUserId("");
        await fetchNotices();
      } else {
        setFormError(data?.message || "Failed to create notice.");
      }
    } catch {
      setFormError("Failed to create notice.");
    }
    setSaveLoading(false);
  };

  const submitEdit = async (e) => {
    e.preventDefault();
    if (!editNotice) return;
    const msg = formMessage.trim();
    if (!msg) {
      setFormError("Message is required.");
      return;
    }
    if (formAudience === "user" && !(formTargetUserId || "").trim()) {
      setFormError("Choose an employee, or select “All employees”.");
      return;
    }
    const auth = getAuthHeader();
    if (!auth) return;
    setSaveLoading(true);
    setFormError("");
    const targetUserId = noticePayloadTargetUserId(formAudience, formTargetUserId);
    try {
      const res = await fetch(`${BASE_URL}/api/admin/notices/${editNotice.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ message: msg, targetUserId }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        showSuccess(data.message || "Notice updated successfully.");
        setEditNotice(null);
        setFormMessage("");
        setFormAudience("all");
        setFormTargetUserId("");
        await fetchNotices();
      } else {
        setFormError(data?.message || "Failed to update notice.");
      }
    } catch {
      setFormError("Failed to update notice.");
    }
    setSaveLoading(false);
  };

  const confirmDelete = async () => {
    if (deleteId == null) return;
    const auth = getAuthHeader();
    if (!auth) return;
    setDeleteLoading(true);
    try {
      const res = await fetch(`${BASE_URL}/api/admin/notices/${deleteId}`, {
        method: "DELETE",
        headers: { Authorization: auth },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success !== false) {
        showSuccess(data.message || "Notice deleted successfully.");
        setDeleteId(null);
        await fetchNotices();
      } else {
        setError(data?.message || "Failed to delete notice.");
        setDeleteId(null);
      }
    } catch {
      setError("Failed to delete notice.");
      setDeleteId(null);
    }
    setDeleteLoading(false);
  };

  const audienceFields = (
    <fieldset className="mb-3 border-0 p-0 m-0">
      <legend className="form-label small mb-1">Send to</legend>
      <div className="form-check">
        <input
          className="form-check-input"
          type="radio"
          name="notice-audience"
          id="notice-audience-all"
          checked={formAudience === "all"}
          onChange={() => {
            setFormAudience("all");
            setFormTargetUserId("");
          }}
        />
        <label className="form-check-label small" htmlFor="notice-audience-all">
          All employees
        </label>
      </div>
      <div className="form-check">
        <input
          className="form-check-input"
          type="radio"
          name="notice-audience"
          id="notice-audience-one"
          checked={formAudience === "user"}
          onChange={() => setFormAudience("user")}
        />
        <label className="form-check-label small" htmlFor="notice-audience-one">
          One employee
        </label>
      </div>
      {formAudience === "user" ? (
        <div className="mt-2">
          <label className="form-label small mb-1 d-block" htmlFor="notice-target-user">
            Employee
          </label>
          {noticeDirectoryLoading ? (
            <p className="small text-muted mb-0">Loading users…</p>
          ) : (
            <UserDirectoryCombobox
              options={noticeDirectoryUsers}
              value={formTargetUserId}
              onChange={setFormTargetUserId}
              placeholder="Search and select employee…"
              ariaLabel="Notice recipient"
            />
          )}
        </div>
      ) : null}
    </fieldset>
  );

  return (
    <div className="dashboard-section admin-notices-panel">
      <div className="d-flex justify-content-between align-items-center flex-wrap gap-2 mb-2">
        <h2 className="section-title mb-0">Notices</h2>
        <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
          New notice
        </button>
      </div>
      <p className="small text-muted mb-2">
        Send to all employees or to one person; targeted notices show only for that employee once the server stores the
        recipient and filters the employee notification list. Search matches notice text.
      </p>
      <div className="row g-2 align-items-end mb-3">
        <div className="col-12 col-md-6 col-lg-5">
          <label className="form-label small mb-0" htmlFor="notices-search-input">
            Search message
          </label>
          <div className="input-group input-group-sm">
            <input
              id="notices-search-input"
              type="search"
              className="form-control"
              placeholder="Search in notice text…"
              value={noticesSearchInput}
              onChange={(e) => setNoticesSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyNoticeSearch();
              }}
            />
            <button type="button" className="btn btn-outline-secondary" onClick={applyNoticeSearch}>
              Search
            </button>
          </div>
        </div>
      </div>
      {error ? <div className="alert alert-danger py-2 mb-2">{error}</div> : null}
      {loading ? (
        <p className="text-muted mb-0">Loading notices…</p>
      ) : notices.length === 0 ? (
        <p className="text-muted mb-0">No notices yet.</p>
      ) : (
        <>
          <div className="table-responsive">
            <table className="table table-bordered table-hover table-sm align-middle">
              <thead>
                <tr>
                  <th style={{ minWidth: "32%" }}>Message</th>
                  <th className="text-nowrap">Audience</th>
                  <th>Updated</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {notices.map((n) => (
                  <tr key={n.id}>
                    <td className="small admin-notice-message-cell">{n.message ?? "—"}</td>
                    <td className="small text-nowrap">{formatNoticeAudience(n, userById)}</td>
                    <td className="small text-muted text-nowrap">{formatNoticeTime(n.updatedAt ?? n.createdAt)}</td>
                    <td>
                      <div className="admin-actions">
                        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => openEdit(n)}>
                          Edit
                        </button>
                        <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => setDeleteId(n.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {noticesTotal > 0 ? (
            <div className="d-flex justify-content-between align-items-center mt-2 flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={noticesPage === 0}
                onClick={() => setNoticesPage((p) => Math.max(0, p - 1))}
              >
                Previous
              </button>
              <span className="small text-muted">
                Page {noticesPage + 1} of {noticesTotalPages} ({noticesTotal} total)
              </span>
              <button
                type="button"
                className="btn btn-outline-secondary btn-sm"
                disabled={noticesPage >= noticesTotalPages - 1}
                onClick={() => setNoticesPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      )}

      {createOpen && (
        <div className="admin-modal-backdrop" role="dialog">
          <div className="admin-modal admin-modal--wide">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h3 className="h6 mb-0">New notice</h3>
              <button type="button" className="btn-close" aria-label="Close" onClick={() => setCreateOpen(false)} />
            </div>
            {formError ? <div className="alert alert-danger py-2 mb-2">{formError}</div> : null}
            <form onSubmit={submitCreate}>
              {audienceFields}
              <label className="form-label small" htmlFor="notice-create-msg">
                Message (max {MESSAGE_MAX} characters)
              </label>
              <textarea
                id="notice-create-msg"
                className="form-control form-control-sm mb-2"
                rows={5}
                maxLength={MESSAGE_MAX}
                value={formMessage}
                onChange={(e) => setFormMessage(e.target.value)}
                required
              />
              <div className="d-flex justify-content-between align-items-center">
                <span className="small text-muted">
                  {formMessage.length}/{MESSAGE_MAX}
                </span>
                <div className="d-flex gap-2">
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setCreateOpen(false)} disabled={saveLoading}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saveLoading}>
                    {saveLoading ? "Saving…" : "Publish"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {editNotice && (
        <div className="admin-modal-backdrop" role="dialog">
          <div className="admin-modal admin-modal--wide">
            <div className="d-flex justify-content-between align-items-center mb-2">
              <h3 className="h6 mb-0">Edit notice #{editNotice.id}</h3>
              <button type="button" className="btn-close" aria-label="Close" onClick={() => setEditNotice(null)} />
            </div>
            {formError ? <div className="alert alert-danger py-2 mb-2">{formError}</div> : null}
            <form onSubmit={submitEdit}>
              {audienceFields}
              <label className="form-label small" htmlFor="notice-edit-msg">
                Message (max {MESSAGE_MAX} characters)
              </label>
              <textarea
                id="notice-edit-msg"
                className="form-control form-control-sm mb-2"
                rows={5}
                maxLength={MESSAGE_MAX}
                value={formMessage}
                onChange={(e) => setFormMessage(e.target.value)}
                required
              />
              <div className="d-flex justify-content-between align-items-center">
                <span className="small text-muted">
                  {formMessage.length}/{MESSAGE_MAX}
                </span>
                <div className="d-flex gap-2">
                  <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setEditNotice(null)} disabled={saveLoading}>
                    Cancel
                  </button>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={saveLoading}>
                    {saveLoading ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteId != null && (
        <div className="admin-modal-backdrop" role="dialog">
          <div className="admin-modal">
            <p className="mb-0">Delete this notice? Recipients will no longer see it.</p>
            <div className="d-flex gap-2 justify-content-end mt-3">
              <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setDeleteId(null)} disabled={deleteLoading}>
                Cancel
              </button>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => confirmDelete()} disabled={deleteLoading}>
                {deleteLoading ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
