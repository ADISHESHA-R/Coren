/** Shared helpers for User Management directory pickers (same data as GET /api/admin/users). */

export function formatUserDirectoryLabel(u) {
  if (!u || u.id == null) return "";
  return [u.name, u.employeeId, u.role].filter(Boolean).join(" · ") || u.email || `User ${u.id}`;
}

/** Match saved free-text to a directory user for pre-selection (exact name or email). */
export function inferDirectoryUserIdFromText(employeeOptions, text) {
  const t = String(text ?? "").trim();
  if (!t) return null;
  const lower = t.toLowerCase();
  for (const u of employeeOptions) {
    if (u.id == null) continue;
    if (String(u.name ?? "").trim().toLowerCase() === lower) return Number(u.id);
    if (String(u.email ?? "").trim().toLowerCase() === lower) return Number(u.id);
  }
  return null;
}

export function directorySelectValue(explicitUserId, textFallback, employeeOptions) {
  if (explicitUserId != null && Number.isFinite(Number(explicitUserId))) {
    const id = Number(explicitUserId);
    if (employeeOptions.some((u) => Number(u.id) === id)) return String(id);
  }
  const inferred = inferDirectoryUserIdFromText(employeeOptions, textFallback);
  return inferred != null ? String(inferred) : "";
}

const AVATAR_HUES = [215, 28, 152, 268, 42, 12, 185, 330, 88, 200];

/** Two-letter initials for avatar (first + last word, or first two chars). */
export function getUserInitials(u) {
  if (!u) return "??";
  const name = String(u.name ?? "").trim();
  if (name) {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const a = parts[0][0] || "";
      const b = parts[parts.length - 1][0] || "";
      return (a + b).toUpperCase() || "?";
    }
    if (parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] || "?").toUpperCase();
  }
  const email = String(u.email ?? "").trim();
  if (email.length >= 2) return email.slice(0, 2).toUpperCase();
  if (u.id != null) return String(u.id).slice(-2).toUpperCase();
  return "??";
}

export function avatarBackgroundForUser(u) {
  const id = Number(u?.id) || 0;
  const hue = AVATAR_HUES[Math.abs(id) % AVATAR_HUES.length];
  return `hsl(${hue} 58% 38%)`;
}
