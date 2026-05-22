import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ProfileDialog from "./ProfileDialog";
import { useToast } from "./Toast";
import coremLogo from "../Logo/corem.png.jpg";

import { API_BASE_URL as BASE_URL } from "../config/apiBaseUrl.js";
import { toggleTheme } from "../utils/theme.js";
const MB = 1024 * 1024;
const PHOTO_MAX_SIZE = 3 * MB;
const SIGNATURE_MAX_SIZE = 2 * MB;
const ALLOWED_TYPES = ["image/jpeg", "image/png"];

/** Default avatar when no photo or image fails to load (inline SVG) */
const DEFAULT_AVATAR =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle fill="%23dbe7ff" cx="50" cy="50" r="50"/><text x="50" y="58" font-size="36" fill="%232149bb" text-anchor="middle" font-family="sans-serif">?</text></svg>'
  );

/**
 * Builds the profile image API URL. Use with fetch + Authorization for auth-required endpoints.
 * @param {string} [photoPath] - Path from user profile (e.g. photos/photo_34_xxx.jpg)
 * @returns {string} Full URL, or empty if no path
 */
function getProfileImageUrl(photoPath) {
  if (!photoPath || typeof photoPath !== "string") return "";
  const trimmed = photoPath.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `${BASE_URL}/api/files?path=${encodeURIComponent(trimmed)}`;
}

/**
 * Returns URLs to try in order for loading a file. Backends may use ?path= or path-as-segment or /uploads/.
 * @param {string} [filePath] - Path from API (e.g. photos/photo_4_xxx.jpg or uploads/photos/...)
 * @returns {string[]} Array of full URLs to try
 */
function getFileUrlsToTry(filePath) {
  if (!filePath || typeof filePath !== "string") return [];
  const trimmed = filePath.trim();
  if (/^https?:\/\//i.test(trimmed)) return [trimmed];
  const pathSegment = trimmed.split("/").map(encodeURIComponent).join("/");
  const urls = [
    `${BASE_URL}/api/files?path=${encodeURIComponent(trimmed)}`,
    `${BASE_URL}/api/files/${pathSegment}`,
    `${BASE_URL}/${trimmed}`,
  ];
  if (!trimmed.startsWith("uploads/")) {
    urls.push(`${BASE_URL}/uploads/${trimmed}`);
  }
  return urls;
}

/** Returns error message if invalid, null if valid. Optional field; if provided, must be exactly 10 digits. */
function validatePhoneNumber(value) {
  const digits = (value || "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.length !== 10) {
    return "Please enter a valid 10-digit mobile number.";
  }
  return null;
}

function formatNoticeTime(iso) {
  if (iso == null || iso === "") return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
}

function noticeReadIdsStorageKey() {
  return `employeeNoticeReadIds:${localStorage.getItem("email") || "default"}`;
}

function loadReadNoticeIdSet() {
  try {
    const raw = localStorage.getItem(noticeReadIdsStorageKey());
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr.map(String) : []);
  } catch {
    return new Set();
  }
}

function persistReadNoticeIdSet(set) {
  localStorage.setItem(noticeReadIdsStorageKey(), JSON.stringify([...set]));
}

function Header({ onLogout, sessionReady = true }) {
  const showToast = useToast();
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingSignature, setUploadingSignature] = useState(false);
  const [profileError, setProfileError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [uploadSuccess, setUploadSuccess] = useState("");
  const [profile, setProfile] = useState(null);
  const [address, setAddress] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [signatureFile, setSignatureFile] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(Boolean(localStorage.getItem("accessToken")));
  const [cachedName, setCachedName] = useState(localStorage.getItem("profileName") || "");
  const [cachedPhotoPath, setCachedPhotoPath] = useState(localStorage.getItem("profilePhotoPath") || "");
  const [avatarPhotoVersion, setAvatarPhotoVersion] = useState(0);
  const [avatarImageUrl, setAvatarImageUrl] = useState(null);
  const avatarBlobUrlRef = useRef(null);
  const [authRole, setAuthRole] = useState(() => localStorage.getItem("authRole") || "");
  const [notices, setNotices] = useState([]);
  const [noticesLoading, setNoticesLoading] = useState(false);
  const [noticesError, setNoticesError] = useState("");
  const [notifyOpen, setNotifyOpen] = useState(false);
  const notifyWrapRef = useRef(null);
  const [readNoticeIdList, setReadNoticeIdList] = useState(() => [...loadReadNoticeIdSet()]);
  const [colorTheme, setColorTheme] = useState(() =>
    typeof document !== "undefined" && document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"
  );

  const isEmployee = authRole === "EMPLOYEE";

  const readNoticeIdSet = useMemo(() => new Set(readNoticeIdList), [readNoticeIdList]);

  const unreadNotices = useMemo(
    () => notices.filter((n) => n.id != null && !readNoticeIdSet.has(String(n.id))),
    [notices, readNoticeIdSet]
  );
  const unreadCount = unreadNotices.length;

  const fallbackImageUrl = useMemo(() => {
    if (!cachedPhotoPath || avatarImageUrl) return "";
    return getProfileImageUrl(cachedPhotoPath);
  }, [cachedPhotoPath, avatarImageUrl]);

  useEffect(() => {
    if (!cachedPhotoPath || !isAuthenticated || !sessionReady) {
      if (avatarBlobUrlRef.current) {
        URL.revokeObjectURL(avatarBlobUrlRef.current);
        avatarBlobUrlRef.current = null;
      }
      setAvatarImageUrl(null);
      return;
    }
    const urlsToTry = getFileUrlsToTry(cachedPhotoPath);
    if (urlsToTry.length === 0) {
      setAvatarImageUrl(null);
      return;
    }
    const auth = getAuthHeader();
    const headers = auth ? { Authorization: auth } : {};
    let cancelled = false;

    (async () => {
      for (const url of urlsToTry) {
        if (cancelled) return;
        try {
          const res = await fetch(url, { headers });
          if (!res.ok) continue;
          const blob = await res.blob();
          if (cancelled) return;
          if (avatarBlobUrlRef.current) URL.revokeObjectURL(avatarBlobUrlRef.current);
          const blobUrl = URL.createObjectURL(blob);
          avatarBlobUrlRef.current = blobUrl;
          setAvatarImageUrl(blobUrl);
          return;
        } catch {
          // try next URL
        }
      }
      if (!cancelled) setAvatarImageUrl(null);
    })();

    return () => {
      cancelled = true;
      if (avatarBlobUrlRef.current) {
        URL.revokeObjectURL(avatarBlobUrlRef.current);
        avatarBlobUrlRef.current = null;
      }
      setAvatarImageUrl(null);
    };
  }, [cachedPhotoPath, avatarPhotoVersion, isAuthenticated, sessionReady]);

  const avatarInitials = useMemo(() => {
    const source = (cachedName || localStorage.getItem("email") || "U").trim();
    const words = source.split(" ").filter(Boolean);
    if (words.length >= 2) {
      return `${words[0][0]}${words[1][0]}`.toUpperCase();
    }
    return source.slice(0, 2).toUpperCase();
  }, [cachedName]);

  const getAuthHeader = () => {
    const tokenType = (localStorage.getItem("tokenType") || "Bearer").trim();
    let accessToken = (localStorage.getItem("accessToken") || "").trim();
    if (/^bearer\s+/i.test(accessToken)) {
      accessToken = accessToken.replace(/^bearer\s+/i, "").trim();
    }
    return accessToken ? `${tokenType} ${accessToken}` : "";
  };

  const fetchMeWithFallback = async (authHeader) => {
    const urls = [`${BASE_URL}/api/users/me`, `${BASE_URL}/api/user/me`];
    for (const url of urls) {
      const res = await fetch(url, { headers: { Authorization: authHeader } });
      const payload = await res.json().catch(() => ({}));
      if (res.ok) return payload;
      if (res.status !== 404) return null;
    }
    return null;
  };

  const syncAuthFromStorage = () => {
    setIsAuthenticated(Boolean(localStorage.getItem("accessToken")));
    setCachedName(localStorage.getItem("profileName") || "");
    setCachedPhotoPath(localStorage.getItem("profilePhotoPath") || "");
    setAuthRole(localStorage.getItem("authRole") || "");
  };

  useEffect(() => {
    syncAuthFromStorage();
    setReadNoticeIdList([...loadReadNoticeIdSet()]);
    const listener = () => {
      syncAuthFromStorage();
      setReadNoticeIdList([...loadReadNoticeIdSet()]);
    };
    window.addEventListener("auth-updated", listener);
    return () => window.removeEventListener("auth-updated", listener);
  }, []);

  const markAllNoticesRead = useCallback(() => {
    setReadNoticeIdList((prev) => {
      const next = new Set(prev);
      notices.forEach((n) => {
        if (n.id != null) next.add(String(n.id));
      });
      persistReadNoticeIdSet(next);
      return [...next];
    });
  }, [notices]);

  const fetchEmployeeNotices = useCallback(async () => {
    const auth = getAuthHeader();
    if (!auth) return;
    setNoticesLoading(true);
    setNoticesError("");
    try {
      const res = await fetch(`${BASE_URL}/api/notices`, { headers: { Authorization: auth } });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success) {
        const raw = data.data;
        const list = Array.isArray(raw) ? raw : [];
        list.sort((a, b) => {
          const ta = new Date(a.updatedAt ?? a.createdAt ?? 0).getTime();
          const tb = new Date(b.updatedAt ?? b.createdAt ?? 0).getTime();
          return tb - ta;
        });
        setNotices(list);
      } else {
        setNoticesError(data?.message || "Could not load notifications.");
        setNotices([]);
      }
    } catch {
      setNoticesError("Could not load notifications.");
      setNotices([]);
    }
    setNoticesLoading(false);
  }, []);

  useEffect(() => {
    if (!isAuthenticated || !sessionReady || !isEmployee) {
      setNotices([]);
      setNoticesError("");
      setNotifyOpen(false);
      return;
    }
    fetchEmployeeNotices();
  }, [isAuthenticated, sessionReady, isEmployee, fetchEmployeeNotices]);

  useEffect(() => {
    if (!isEmployee || !isAuthenticated) return;
    const onFocus = () => fetchEmployeeNotices();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isEmployee, isAuthenticated, fetchEmployeeNotices]);

  useEffect(() => {
    if (!notifyOpen) return;
    const onDoc = (e) => {
      if (notifyWrapRef.current && !notifyWrapRef.current.contains(e.target)) {
        setNotifyOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [notifyOpen]);

  useEffect(() => {
    if (!isAuthenticated || !sessionReady) return;
    const auth = getAuthHeader();
    if (!auth) return;
    let cancelled = false;
    fetchMeWithFallback(auth).then((payload) => {
      if (cancelled || !payload?.success || !payload?.data) return;
      applyProfileToState(payload.data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [isAuthenticated, sessionReady]);

  const applyProfileToState = (userProfile, options = {}) => {
    if (!userProfile) return;
    setProfile(userProfile);
    setAddress(userProfile.address || "");
    setPhoneNumber(userProfile.homeContactNumber || "");
    const name = userProfile.name || userProfile.employee?.name || "";
    const photoPath = userProfile.photoPath ?? userProfile.photo_path ?? userProfile.employee?.photoPath ?? userProfile.employee?.photo_path ?? "";
    localStorage.setItem("profileName", name);
    localStorage.setItem("profilePhotoPath", photoPath);
    setCachedName(name);
    setCachedPhotoPath(photoPath);
    if (options.bumpAvatarVersion) setAvatarPhotoVersion((v) => v + 1);
  };

  const fetchProfile = async () => {
    const authorization = getAuthHeader();
    if (!authorization) {
      setProfileError("Please login first.");
      return;
    }

    setProfileLoading(true);
    setProfileError("");
    setUploadError("");
    setUploadSuccess("");
    try {
      const payload = await fetchMeWithFallback(authorization);
      if (!payload?.success) {
        throw new Error(payload?.message || "Unable to fetch profile.");
      }
      applyProfileToState(payload.data || {});
    } catch (error) {
      setProfileError(error?.message || "Unable to fetch profile.");
    } finally {
      setProfileLoading(false);
    }
  };

  const handleOpenDialog = async () => {
    setProfileDialogOpen(true);
    await fetchProfile();
  };

  const handleSaveProfile = async () => {
    if (!profile) {
      return;
    }

    const phoneError = validatePhoneNumber(phoneNumber);
    if (phoneError) {
      setProfileError(phoneError);
      return;
    }

    const authorization = getAuthHeader();
    if (!authorization) {
      setProfileError("Please login first.");
      return;
    }

    setProfileSaving(true);
    setProfileError("");
    setUploadSuccess("");

    try {
      const payloadBody = {
        name: profile.name || "",
        email: profile.email || "",
        address: address.trim(),
        dateOfBirth: profile.dateOfBirth || "",
        bloodGroup: profile.bloodGroup || "",
        fatherName: profile.fatherName || "",
        dateOfJoining: profile.dateOfJoining || "",
        officeContactNumber: profile.officeContactNumber || "",
        homeContactNumber: phoneNumber.trim(),
        otherContactNumber: profile.otherContactNumber || "",
        identificationMark: profile.identificationMark || "",
      };

      const response = await fetch(`${BASE_URL}/api/users/me`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
        },
        body: JSON.stringify(payloadBody),
      });

      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || "Unable to update profile.");
      }

      applyProfileToState(payload.data || {});
      setProfileDialogOpen(false);
    } catch (error) {
      setProfileError(error.message || "Unable to update profile.");
    } finally {
      setProfileSaving(false);
    }
  };

  const uploadFile = async (file, endpoint, kind) => {
    const authorization = getAuthHeader();
    if (!authorization) {
      setUploadError("Please login first.");
      return;
    }
    if (!file) {
      setUploadError(`Please select a ${kind} file first.`);
      return;
    }
    if (!ALLOWED_TYPES.includes(file.type)) {
      setUploadError("Only JPG and PNG formats are allowed.");
      return;
    }
    const maxSize = kind === "photo" ? PHOTO_MAX_SIZE : SIGNATURE_MAX_SIZE;
    if (file.size > maxSize) {
      const maxText = kind === "photo" ? "3MB" : "2MB";
      setUploadError(`${kind === "photo" ? "Photo" : "Signature"} must be ${maxText} or smaller.`);
      return;
    }

    setUploadError("");
    setUploadSuccess("");
    const formData = new FormData();
    formData.append("file", file);

    const setLoading = kind === "photo" ? setUploadingPhoto : setUploadingSignature;
    setLoading(true);
    try {
      const response = await fetch(`${BASE_URL}${endpoint}`, {
        method: "POST",
        headers: {
          Authorization: authorization,
        },
        body: formData,
      });

      const payload = await response.json();
      if (!response.ok || !payload.success) {
        throw new Error(payload.message || `Unable to upload ${kind}.`);
      }

      const data = payload.data || {};
      const updatedProfile = { ...profile, ...data };
      if (kind === "photo") {
        const newPhotoPath = data.photoPath ?? data.photo_path ?? data.employee?.photoPath ?? data.employee?.photo_path ?? profile?.photoPath ?? profile?.photo_path ?? "";
        updatedProfile.photoPath = newPhotoPath || updatedProfile.photoPath;
        updatedProfile.photo_path = updatedProfile.photoPath;
      }
      applyProfileToState(updatedProfile, { bumpAvatarVersion: kind === "photo" });
      const successMsg = kind === "photo" ? "Photo uploaded successfully." : "Signature uploaded successfully.";
      setUploadSuccess(successMsg);
      if (showToast) showToast(successMsg);
      if (kind === "photo") {
        setPhotoFile(null);
      } else {
        setSignatureFile(null);
      }
    } catch (error) {
      setUploadError(error.message || `Unable to upload ${kind}.`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <header className="site-header">
        <div className="site-container site-header-inner">
          <div className="brand-block">
            <div className="brand-logo" aria-hidden="true">
              <img src={coremLogo} alt="COREM" className="brand-logo-image" />
            </div>
            <div>
              <h1 className="brand-title">Attendance Portal</h1>
              <p className="brand-subtitle">Secure access for employees and administrators</p>
            </div>
          </div>

          <div className="header-actions" ref={notifyWrapRef}>
            {isAuthenticated && isEmployee && sessionReady && (
              <div className="header-notify-wrap">
                <button
                  type="button"
                  className="header-notify-btn"
                  onClick={() => {
                    setNotifyOpen((prev) => {
                      const next = !prev;
                      if (next) fetchEmployeeNotices();
                      return next;
                    });
                  }}
                  title="Notifications"
                  aria-label={
                    unreadCount > 0
                      ? `Notifications, ${unreadCount} unread`
                      : "Notifications"
                  }
                  aria-expanded={notifyOpen}
                  aria-haspopup="true"
                  aria-controls="header-notify-panel"
                >
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  {unreadCount > 0 ? (
                    <span className="header-notify-badge">{unreadCount > 99 ? "99+" : unreadCount}</span>
                  ) : null}
                </button>
                {notifyOpen ? (
                  <div id="header-notify-panel" className="header-notify-panel" role="region" aria-label="Notifications">
                    <div className="header-notify-panel-head">
                      <div className="header-notify-panel-title">Announcements</div>
                      <button
                        type="button"
                        className="btn btn-link btn-sm header-notify-mark-read p-0"
                        disabled={noticesLoading || unreadCount === 0}
                        onClick={() => markAllNoticesRead()}
                      >
                        Mark all as read
                      </button>
                    </div>
                    {noticesLoading ? (
                      <p className="header-notify-empty mb-0">Loading…</p>
                    ) : noticesError ? (
                      <p className="header-notify-error mb-0">{noticesError}</p>
                    ) : notices.length === 0 ? (
                      <p className="header-notify-empty mb-0">No notifications.</p>
                    ) : (
                      <ul className="header-notify-list list-unstyled mb-0">
                        {notices.map((n) => {
                          const isRead = n.id == null || readNoticeIdSet.has(String(n.id));
                          return (
                            <li key={n.id} className={`header-notify-item${isRead ? "" : " header-notify-item--unread"}`}>
                              <p className="header-notify-message mb-1">{n.message}</p>
                              <time className="header-notify-time" dateTime={n.updatedAt ?? n.createdAt}>
                                {formatNoticeTime(n.updatedAt ?? n.createdAt)}
                              </time>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                ) : null}
              </div>
            )}
            <button
              type="button"
              className="header-theme-toggle"
              onClick={() => setColorTheme(toggleTheme())}
              title={colorTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              aria-label={colorTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {colorTheme === "dark" ? (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="4" />
                  <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
              ) : (
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
              )}
            </button>
            {isAuthenticated && onLogout && (
              <button
                type="button"
                className="header-logout-btn"
                onClick={() => {
                  if (window.confirm("Are you sure you want to logout?")) {
                    onLogout();
                  }
                }}
                title="Logout"
                aria-label="Logout"
              >
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
              </button>
            )}
            <button
              type="button"
              className="profile-avatar-button"
              onClick={handleOpenDialog}
              disabled={!isAuthenticated}
              title={isAuthenticated ? "Open profile" : "Login to open profile"}
            >
              {(avatarImageUrl || (fallbackImageUrl && cachedPhotoPath)) ? (
                <img
                  src={avatarImageUrl || fallbackImageUrl}
                  alt="Profile"
                  className="profile-avatar-image"
                  onError={(e) => {
                    e.target.onerror = null;
                    e.target.src = DEFAULT_AVATAR;
                  }}
                />
              ) : (
                <span>{avatarInitials}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      <ProfileDialog
        open={profileDialogOpen}
        loading={profileLoading}
        saving={profileSaving}
        uploadingPhoto={uploadingPhoto}
        uploadingSignature={uploadingSignature}
        error={profileError}
        uploadError={uploadError}
        uploadSuccess={uploadSuccess}
        profile={profile}
        address={address}
        phoneNumber={phoneNumber}
        phoneError={validatePhoneNumber(phoneNumber)}
        currentPhotoUrl={avatarImageUrl || (fallbackImageUrl && cachedPhotoPath ? fallbackImageUrl : null)}
        onAddressChange={setAddress}
        onPhoneChange={(value) => setPhoneNumber(value.replace(/\D/g, "").slice(0, 10))}
        onPhotoFileChange={(event) => setPhotoFile(event.target.files?.[0] || null)}
        onSignatureFileChange={(event) => setSignatureFile(event.target.files?.[0] || null)}
        onUploadPhoto={() => uploadFile(photoFile, "/api/users/me/photo", "photo")}
        onUploadSignature={() => uploadFile(signatureFile, "/api/users/me/signature", "signature")}
        onClose={() => setProfileDialogOpen(false)}
        onSave={handleSaveProfile}
      />
    </>
  );
}

export default Header;
