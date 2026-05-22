import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { avatarBackgroundForUser, getUserInitials } from "../utils/userDirectoryDisplay.js";
import "../styles/user-directory-combobox.css";

function primaryDisplayName(u) {
  if (!u) return "";
  return String(u.name ?? "").trim() || String(u.email ?? "").trim() || (u.id != null ? `User ${u.id}` : "");
}

/**
 * User picker with circular initials + full name (dark dropdown list).
 * @param {object} props
 * @param {Array} props.options - users from /api/admin/users (need `id`)
 * @param {string} props.value - "" or numeric id string (same as native select value)
 * @param {(next: string) => void} props.onChange - "" when cleared, else id string
 * @param {string} [props.placeholder]
 * @param {string} [props.ariaLabel]
 * @param {boolean} [props.compact] - smaller trigger for dense tables
 * @param {boolean} [props.disabled]
 */
export default function UserDirectoryCombobox({
  options,
  value,
  onChange,
  placeholder = "Select user…",
  ariaLabel = "Select user",
  compact = false,
  disabled = false,
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [coords, setCoords] = useState(null);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);

  const selected = useMemo(() => {
    if (value == null || value === "") return null;
    const id = Number(value);
    if (!Number.isFinite(id)) return null;
    return options.find((o) => Number(o.id) === id) ?? null;
  }, [options, value]);

  const filtered = useMemo(() => {
    const list = options.filter((o) => o.id != null);
    const t = q.trim().toLowerCase();
    if (!t) return list;
    return list.filter((o) => {
      const hay = [o.name, o.email, o.employeeId, o.role].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(t);
    });
  }, [options, q]);

  const updateCoords = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const maxH = Math.max(120, Math.min(360, window.innerHeight - r.bottom - 12));
    setCoords({
      top: r.bottom + 2,
      left: r.left,
      width: Math.max(260, r.width),
      maxHeight: maxH,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    updateCoords();
    const onRe = () => updateCoords();
    window.addEventListener("scroll", onRe, true);
    window.addEventListener("resize", onRe);
    return () => {
      window.removeEventListener("scroll", onRe, true);
      window.removeEventListener("resize", onRe);
    };
  }, [open, updateCoords]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") {
        setOpen(false);
        setQ("");
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (wrapRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
      setQ("");
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const pick = (idStr) => {
    onChange(idStr === "" || idStr == null ? "" : String(idStr));
    setOpen(false);
    setQ("");
    setCoords(null);
  };

  const toggle = () => {
    if (disabled) return;
    if (!open) {
      updateCoords();
      setOpen(true);
    } else {
      setOpen(false);
      setQ("");
      setCoords(null);
    }
  };

  const menu =
    open && coords
      ? createPortal(
          <div
            ref={menuRef}
            className="udc-menu"
            style={{
              position: "fixed",
              top: coords.top,
              left: coords.left,
              width: coords.width,
              maxWidth: "min(100vw - 16px, 420px)",
              "--udc-max-h": `${coords.maxHeight}px`,
            }}
            role="listbox"
            aria-label="Users"
          >
            <div className="udc-search-wrap">
              <input
                type="search"
                className="udc-search"
                placeholder="Search by name, email, ID…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onMouseDown={(e) => e.stopPropagation()}
                autoComplete="off"
              />
            </div>
            <ul className="udc-list" style={{ maxHeight: coords.maxHeight }}>
              {value ? (
                <li key="clear">
                  <button type="button" className="udc-item udc-item--clear" onClick={() => pick("")}>
                    Clear selection
                  </button>
                </li>
              ) : null}
              {filtered.length === 0 ? (
                <li className="udc-empty">No users match your search.</li>
              ) : (
                filtered.map((u) => {
                  const id = u.id;
                  const label = primaryDisplayName(u);
                  const sub = [u.employeeId, u.role].filter(Boolean).join(" · ");
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        className="udc-item"
                        role="option"
                        aria-selected={String(id) === String(value)}
                        onClick={() => pick(String(id))}
                      >
                        <span className="udc-avatar" style={{ background: avatarBackgroundForUser(u) }}>
                          {getUserInitials(u)}
                        </span>
                        <span className="udc-item-text">
                          <span className="udc-item-name">{label}</span>
                          {sub ? <span className="udc-item-meta">{sub}</span> : null}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <div ref={wrapRef} className={`udc${compact ? " udc--compact" : ""}`}>
        <button
          type="button"
          className="udc-trigger"
          disabled={disabled}
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-haspopup="listbox"
          onClick={toggle}
        >
          {selected ? (
            <>
              <span className="udc-avatar" style={{ background: avatarBackgroundForUser(selected) }}>
                {getUserInitials(selected)}
              </span>
              <span className="udc-trigger-name">{primaryDisplayName(selected)}</span>
            </>
          ) : (
            <span className="udc-trigger-placeholder">{placeholder}</span>
          )}
          <span className="udc-chevron" aria-hidden>
            ▾
          </span>
        </button>
      </div>
      {menu}
    </>
  );
}
