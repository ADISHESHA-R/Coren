import { createContext, useCallback, useContext, useRef, useState } from "react";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState({ message: "", visible: false });
  const timeoutRef = useRef(null);

  const showToast = useCallback((message) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToast({ message, visible: true });
    timeoutRef.current = setTimeout(() => {
      setToast((prev) => (prev.visible ? { ...prev, visible: false } : prev));
      timeoutRef.current = null;
    }, 3000);
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {toast.visible && toast.message ? (
        <div className="toast-notification" role="status" aria-live="polite">
          {toast.message}
        </div>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  return context;
}
