/**
 * Query string for GET /api/admin/attendance (same contract as Admin Dashboard → Pending).
 * Filter by siteId so employee marks for e.g. Bangalore only appear for that site.
 */
export function buildAdminAttendanceQuery({ page, size, status, date, employeeId, siteId, jobCode }) {
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

/** Parse Spring-style page payload from /api/admin/attendance */
export function parseAdminAttendancePage(data) {
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
