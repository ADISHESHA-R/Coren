/**
 * URL segments for admin site job workflow (human-readable, stable per site).
 * Example: /admin/sites/bangalore-blr001/site-job-workflow?step=6
 */

/** Lowercase URL segment: letters, digits, hyphen only */
export function slugifySegment(str) {
  return String(str ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "site";
}

/** Single path segment for `/admin/sites/:segment/site-job-workflow` */
export function siteWorkflowPathSegment(site) {
  if (!site || typeof site !== "object") return "";
  const id = site.id ?? site.siteId;
  const name = slugifySegment(site.name ?? site.siteName ?? "");
  const jc = slugifySegment(site.jobCode ?? "");
  if (name && jc) return `${name}-${jc}`;
  if (name) return `${name}-${String(id ?? "").replace(/\D/g, "") || "0"}`;
  return `site-${String(id ?? "")}`;
}

export function collectSiteRowsForRouteLookup(sites, siteStats) {
  const map = new Map();
  const add = (row) => {
    if (!row || typeof row !== "object") return;
    const id = row.id ?? row.siteId;
    if (id == null || id === "") return;
    const key = String(id);
    if (!map.has(key)) {
      map.set(key, { ...row, id: row.id ?? row.siteId, siteId: row.siteId ?? row.id });
    }
  };
  if (Array.isArray(sites)) sites.forEach(add);
  if (Array.isArray(siteStats)) siteStats.forEach((s) => add({ ...s, id: s.siteId ?? s.id, siteId: s.siteId ?? s.id }));
  return [...map.values()];
}

/** @returns {number | null} numeric site id */
export function resolveSiteIdFromWorkflowSegment(segment, sites, siteStats) {
  if (!segment || typeof segment !== "string") return null;
  const rows = collectSiteRowsForRouteLookup(sites, siteStats);
  for (const row of rows) {
    if (siteWorkflowPathSegment(row) === segment) {
      const n = Number(row.id ?? row.siteId);
      return Number.isFinite(n) ? n : null;
    }
  }
  if (/^\d+$/.test(segment)) {
    const n = Number(segment);
    if (rows.some((r) => Number(r.id ?? r.siteId) === n)) return n;
  }
  return null;
}

export function buildSiteWorkflowPath(site, stepIndex0) {
  const seg = siteWorkflowPathSegment(site);
  if (!seg) return "/admin/sites";
  const step1 = (stepIndex0 ?? 0) + 1;
  const q = step1 > 1 ? `?step=${step1}` : "";
  return `/admin/sites/${encodeURIComponent(seg)}/site-job-workflow${q}`;
}
