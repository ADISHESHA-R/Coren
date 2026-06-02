import { useCallback, useEffect, useRef, useState } from "react";
import { Routes, Route, Navigate, useLocation, useNavigate } from "react-router-dom";
import LoginPage from "./Components/LoginPage";
import Dashboard from "./Components/Dashboard";
import AdminDashboard from "./Components/AdminDashboard";
import CustomerFeedbackPublicPage from "./Components/CustomerFeedbackPublicPage.jsx";
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

function getAuthRole() {
  return localStorage.getItem("authRole") || "";
}

function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(getIsLoggedIn);
  const [bootstrapping, setBootstrapping] = useState(() => Boolean(localStorage.getItem("refreshToken")));
  const lastVisitRefreshRef = useRef(0);
  const bootstrapDoneRef = useRef(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const handleAuthUpdated = () => setIsLoggedIn(getIsLoggedIn());
    window.addEventListener("auth-updated", handleAuthUpdated);
    return () => window.removeEventListener("auth-updated", handleAuthUpdated);
  }, []);

  /** Admins use `/admin/...` in the address bar; employees stay on `/`. Public feedback is exempt. */
  useEffect(() => {
    if (bootstrapping || !isLoggedIn) return;
    const role = getAuthRole();
    const p = location.pathname || "/";
    if (p.startsWith("/customer-feedback/")) return;
    if (role === "ADMIN") {
      if (p === "/" || p === "") {
        navigate("/admin/dashboard", { replace: true });
      }
    } else if (p.startsWith("/admin")) {
      navigate("/", { replace: true });
    }
  }, [bootstrapping, isLoggedIn, location.pathname, navigate]);

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
    navigate("/", { replace: true });
  };

  const role = isLoggedIn ? getAuthRole() : "";

  return (
    <ToastProvider>
      <Routes>
        <Route
          path="/customer-feedback/:siteId"
          element={
            <div className="app-shell">
              <main className="auth-page">
                <CustomerFeedbackPublicPage />
              </main>
              <Footer />
            </div>
          }
        />
        <Route
          path="*"
          element={
            <div className="app-shell">
              <Header onLogout={handleLogout} sessionReady={!bootstrapping} />
              <main className={isLoggedIn ? "main-content" : "auth-page"}>
                {bootstrapping ? (
                  <div className="session-bootstrap" role="status" aria-live="polite">
                    <p className="session-bootstrap-text">Restoring your session…</p>
                  </div>
                ) : isLoggedIn ? (
                  role === "ADMIN" ? (
                    <Routes>
                      <Route path="/admin/*" element={<AdminDashboard onLogout={handleLogout} />} />
                      <Route path="*" element={<Navigate to="/admin/dashboard" replace />} />
                    </Routes>
                  ) : (
                    <Routes>
                      <Route path="/*" element={<Dashboard onLogout={handleLogout} />} />
                    </Routes>
                  )
                ) : (
                  <Routes>
                    <Route path="*" element={<LoginPage />} />
                  </Routes>
                )}
              </main>
              <Footer />
            </div>
          }
        />
      </Routes>
    </ToastProvider>
  );
}

export default App;
