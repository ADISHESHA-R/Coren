import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

const TOAST_MS = 3500;
const ERROR_TOAST_MS = 5500;

const ToastContext = createContext(null);

/**
 * @typedef {{ showToast: (message: string) => void, showError: (message: string) => void }} ToastApi
 */

export function ToastProvider({ children }) {
  const [toast, setToast] = useState({ message: "", visible: false, variant: "info" });
  const timeoutRef = useRef(null);

  const hideSoon = useCallback((ms) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      setToast((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      timeoutRef.current = null;
    }, ms);
  }, []);

  const showToast = useCallback(
    (message) => {
      const m = String(message ?? "").trim();
      if (!m) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setToast({ message: m, visible: true, variant: "info" });
      hideSoon(TOAST_MS);
    },
    [hideSoon],
  );

  const showError = useCallback(
    (message) => {
      const m = String(message ?? "").trim() || "Something went wrong.";
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setToast({ message: m, visible: true, variant: "error" });
      hideSoon(ERROR_TOAST_MS);
    },
    [hideSoon],
  );

  const value = useMemo(() => ({ showToast, showError }), [showToast, showError]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast.visible && toast.message ? (
        <div
          className={`toast-notification${toast.variant === "error" ? " toast-notification--error" : ""}`}
          role={toast.variant === "error" ? "alert" : "status"}
          aria-live={toast.variant === "error" ? "assertive" : "polite"}
        >
          {toast.message}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

/** @returns {ToastApi | null} */
export function useToast() {
  return useContext(ToastContext);
}
