import { useCallback, useEffect, useRef, useState } from "react";

import { API_BASE_URL as BASE_URL } from "../config/apiBaseUrl.js";

const SHIFT_OPTIONS = [
  { value: "FIRST_HALF", label: "First Half" },
  { value: "SECOND_HALF", label: "Second Half" },
  { value: "FULL_DAY", label: "Full Day" },
];

function AddRecordModal({ open, onClose, onSuccess, getAuthHeader, onOpen, hasRejectedToday }) {
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [siteId, setSiteId] = useState("");
  const [shift, setShift] = useState("FULL_DAY");
  const [sites, setSites] = useState([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  }, []);

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }
    setError("");
    setPhotoFile(null);
    setPhotoPreview("");
    setSiteId("");
    setShift("FULL_DAY");
    setCameraOpen(false);
    onOpen?.();

    const fetchSites = async () => {
      setLoadingSites(true);
      try {
        const auth = getAuthHeader();
        const response = await fetch(`${BASE_URL}/api/sites`, {
          headers: auth ? { Authorization: auth } : {},
        });
        if (response.ok) {
          const data = await response.json();
          const list = data?.data ?? data?.list ?? (Array.isArray(data) ? data : []);
          setSites(Array.isArray(list) ? list : []);
        }
      } catch (_) {}
      setLoadingSites(false);
    };
    fetchSites();
    return () => stopCamera();
  }, [open, getAuthHeader, stopCamera]);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview("");
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const openCamera = async () => {
    setError("");
    stopCamera();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      setCameraOpen(true);
      setCapturing(false);
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err) {
      setError(err.message || "Could not open camera. Please allow camera access.");
    }
  };

  const captureImage = () => {
    const video = videoRef.current;
    const stream = streamRef.current;
    if (!video || !stream || !video.videoWidth) return;
    setCapturing(true);
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(video, 0, 0);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], "capture.jpg", { type: "image/jpeg" });
          setPhotoFile(file);
          setError("");
        }
        stopCamera();
        setCapturing(false);
      },
      "image/jpeg",
      0.9
    );
  };

  useEffect(() => {
    if (!cameraOpen || !videoRef.current || !streamRef.current) return;
    videoRef.current.srcObject = streamRef.current;
  }, [cameraOpen]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (!photoFile) {
      setError("Please open camera and capture a photo.");
      return;
    }
    const sid = siteId.trim();
    if (!sid) {
      setError("Please select a site.");
      return;
    }
    const numId = Number(sid);
    if (Number.isNaN(numId) || numId < 1) {
      setError("Please select a valid site.");
      return;
    }
    const validShifts = ["FIRST_HALF", "SECOND_HALF", "FULL_DAY"];
    if (!shift || !validShifts.includes(shift)) {
      setError("Please select a shift.");
      return;
    }

    const auth = getAuthHeader();
    if (!auth) {
      setError("Session expired. Please login again.");
      return;
    }

    setSubmitting(true);
    try {
      const formData = new FormData();
      formData.append("photo", photoFile);
      formData.append("siteId", String(numId));
      formData.append("shift", shift);

      const response = await fetch(`${BASE_URL}/api/attendance/mark`, {
        method: "POST",
        headers: { Authorization: auth },
        body: formData,
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.message || "Failed to mark attendance.");
      }
      onSuccess?.(payload);
      onClose();
    } catch (err) {
      setError(err.message || "Failed to mark attendance.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const siteOptions = sites.length > 0
    ? sites
    : [
        { id: 1, name: "Site 1" },
        { id: 2, name: "Site 2" },
        { id: 3, name: "Site 3" },
      ];

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="add-record-title">
      <div className="modal-content add-record-modal">
        <div className="modal-header">
          <h2 id="add-record-title" className="modal-title">Add Record</h2>
          <button type="button" className="btn-close" aria-label="Close" onClick={() => { stopCamera(); onClose(); }} />
        </div>

        {hasRejectedToday && (
          <div className="alert alert-info py-2 mx-3 mt-2 mb-0 small">
            Your previous submission for today was rejected. You can mark attendance again below.
          </div>
        )}

        <form onSubmit={handleSubmit}>
          {error ? (
            <div className="alert alert-danger py-2">
              {error}
              {/Cannot resubmit|already approved|pending for this day/i.test(error) && (
                <p className="small mb-0 mt-2 text-muted">Add attendance will stay disabled for this day at this site. Close this dialog and try again later if the status changes.</p>
              )}
            </div>
          ) : null}

          <div className="form-group">
            <label className="form-label">Photo (required)</label>
            {!cameraOpen && !photoPreview ? (
              <button type="button" className="btn btn-outline-primary w-100" onClick={openCamera}>
                Open Camera and Capture the image
              </button>
            ) : cameraOpen ? (
              <div className="camera-box">
                <video ref={videoRef} autoPlay playsInline muted className="camera-video" />
                <button
                  type="button"
                  className="btn btn-primary mt-2 w-100"
                  onClick={captureImage}
                  disabled={capturing}
                >
                  {capturing ? "Capturing..." : "Capture"}
                </button>
              </div>
            ) : (
              <div className="mt-2 text-center">
                <img src={photoPreview} alt="Preview" className="add-record-preview" />
                <button type="button" className="btn btn-outline-secondary btn-sm mt-2" onClick={() => { setPhotoFile(null); setPhotoPreview(""); }}>
                  Retake photo
                </button>
              </div>
            )}
          </div>

          <div className="form-group">
            <label className="form-label">Shift (required)</label>
            <select
              className="form-select"
              value={shift}
              onChange={(e) => setShift(e.target.value)}
              required
            >
              {SHIFT_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Site (required)</label>
            <select
              className="form-select"
              value={siteId}
              onChange={(e) => setSiteId(e.target.value)}
              required
              disabled={loadingSites}
            >
              <option value="">Select site</option>
              {siteOptions.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name || `Site ${site.id}`}
                </option>
              ))}
            </select>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-outline-secondary" onClick={() => { stopCamera(); onClose(); }} disabled={submitting}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={submitting || !photoFile}>
              {submitting ? "Adding..." : "Add"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default AddRecordModal;
