import { useCallback, useEffect, useRef, useState } from "react";
import LoginPage from "./Components/LoginPage";
import Dashboard from "./Components/Dashboard";
import AdminDashboard from "./Components/AdminDashboard";
import Header from "./Components/Header";
import Footer from "./Components/Footer";
import { ToastProvider } from "./Components/Toast";
import { refreshAccessToken } from "./utils/refreshAccessToken";
import { API_BASE_URL as BASE_URL } from "./config/apiBaseUrl.js";
import "./App.css";

const VISIT_REFRESH_THROTTLE_MS = 2 * 60 * 1000;

function getIsLoggedIn() {
  return Boolean(localStorage.getItem("accessToken"));
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(getIsLoggedIn);
  const [bootstrapping, setBootstrapping] = useState(() => Boolean(localStorage.getItem("refreshToken")));
  const lastVisitRefreshRef = useRef(0);
  const bootstrapDoneRef = useRef(false);

  useEffect(() => {
    const handleAuthUpdated = () => setIsLoggedIn(getIsLoggedIn());
    window.addEventListener("auth-updated", handleAuthUpdated);
    return () => window.removeEventListener("auth-updated", handleAuthUpdated);
  }, []);

  /** On first load: refresh access token if we have a refresh token (extends rolling 24h session). */
  useEffect(() => {
    let cancelled = false;
    const bootstrapTimeout = window.setTimeout(() => {
      if (cancelled) return;
      if (!bootstrapDoneRef.current) {
        bootstrapDoneRef.current = true;
        setBootstrapping(false);
      }
    }, 15000);
    (async () => {
      try {
        if (!localStorage.getItem("refreshToken")) {
          bootstrapDoneRef.current = true;
          setBootstrapping(false);
          return;
        }
        const result = await refreshAccessToken();
        if (cancelled) return;
        /**
         * Refresh was attempted because a refresh token existed. If the server rejects it (or tokens are unusable),
         * clear storage — otherwise the UI stays "logged in" with an expired access JWT and every admin call returns 401.
         * On likely network errors, keep the existing access token so a flaky load does not force logout.
         */
        if (!result.ok) {
          const msg = (result.message || "").toLowerCase();
          const networkish = msg.includes("network") || msg.includes("failed to fetch");
          if (networkish && localStorage.getItem("accessToken")) {
            setIsLoggedIn(getIsLoggedIn());
          } else {
            localStorage.removeItem("authRole");
            localStorage.removeItem("accessToken");
            localStorage.removeItem("refreshToken");
            localStorage.removeItem("tokenType");
            localStorage.removeItem("expiresIn");
            localStorage.removeItem("loginAt");
            localStorage.removeItem("accessIssuedAt");
            localStorage.removeItem("email");
            localStorage.removeItem("profileName");
            localStorage.removeItem("profilePhotoPath");
            localStorage.removeItem("userId");
            window.dispatchEvent(new Event("auth-updated"));
            setIsLoggedIn(false);
          }
        } else {
          setIsLoggedIn(getIsLoggedIn());
        }
      } finally {
        if (!cancelled) {
          bootstrapDoneRef.current = true;
          lastVisitRefreshRef.current = Date.now();
          setBootstrapping(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      window.clearTimeout(bootstrapTimeout);
    };
  }, []);

  /** When user returns to the tab/window, refresh tokens (throttled) to extend session again. */
  const tryRefreshOnReturn = useCallback(async () => {
    if (!bootstrapDoneRef.current || !localStorage.getItem("refreshToken")) return;
    const now = Date.now();
    if (now - lastVisitRefreshRef.current < VISIT_REFRESH_THROTTLE_MS) return;
    lastVisitRefreshRef.current = now;
    const result = await refreshAccessToken();
    if (result.ok) setIsLoggedIn(true);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") tryRefreshOnReturn();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", tryRefreshOnReturn);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", tryRefreshOnReturn);
    };
  }, [tryRefreshOnReturn]);

  const handleLogout = async (message) => {
    const refreshToken = localStorage.getItem("refreshToken");
    if (refreshToken) {
      try {
        await fetch(`${BASE_URL}/api/auth/logout`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
      } catch (_) {}
    }
    localStorage.removeItem("authRole");
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    localStorage.removeItem("tokenType");
    localStorage.removeItem("expiresIn");
    localStorage.removeItem("loginAt");
    localStorage.removeItem("accessIssuedAt");
    localStorage.removeItem("email");
    localStorage.removeItem("profileName");
    localStorage.removeItem("profilePhotoPath");
    localStorage.removeItem("userId");
    if (message) sessionStorage.setItem("logoutMessage", message);
    window.dispatchEvent(new Event("auth-updated"));
    setIsLoggedIn(false);
  };

  return (
    <ToastProvider>
      <div className="app-shell">
        <Header onLogout={handleLogout} sessionReady={!bootstrapping} />
        <main className={isLoggedIn ? "main-content" : "auth-page"}>
          {bootstrapping ? (
            <div className="session-bootstrap" role="status" aria-live="polite">
              <p className="session-bootstrap-text">Restoring your session…</p>
            </div>
          ) : isLoggedIn ? (
            localStorage.getItem("authRole") === "ADMIN" ? (
              <AdminDashboard onLogout={handleLogout} />
            ) : (
              <Dashboard onLogout={handleLogout} />
            )
          ) : (
            <LoginPage />
          )}
        </main>
        <Footer />
      </div>
    </ToastProvider>
  );
}

export default App;
