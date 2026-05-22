import React from "react";

function hideImgAndShowPlaceholder(e) {
  const img = e.target;
  const next = img.nextElementSibling;
  if (next) next.classList.remove("profile-photo-placeholder--hidden");
  img.style.display = "none";
}

function ProfileDialog({
  open,
  loading,
  saving,
  uploadingPhoto,
  uploadingSignature,
  error,
  uploadError,
  uploadSuccess,
  profile,
  address,
  phoneNumber,
  phoneError,
  currentPhotoUrl,
  onPhotoFileChange,
  onSignatureFileChange,
  onUploadPhoto,
  onUploadSignature,
  onAddressChange,
  onPhoneChange,
  onClose,
  onSave,
}) {
  if (!open) {
    return null;
  }

  const placeholderClass = currentPhotoUrl
    ? "profile-photo-placeholder profile-photo-placeholder--hidden"
    : "profile-photo-placeholder";

  return (
    <div className="profile-modal-backdrop" role="dialog" aria-modal="true" aria-label="Employee profile">
      <div className="profile-modal">
        <div className="profile-modal-body">
          <div className="profile-modal-header">
            <h2 className="profile-modal-title">Employee Profile</h2>
            <button type="button" className="btn-close" aria-label="Close" onClick={onClose} />
          </div>

          {loading ? <p className="mb-2">Loading profile...</p> : null}
          {error ? <div className="alert alert-danger py-2">{error}</div> : null}
          {uploadError ? <div className="alert alert-danger py-2">{uploadError}</div> : null}
          {uploadSuccess ? <div className="alert alert-success py-2">{uploadSuccess}</div> : null}

          {profile ? (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                onSave();
              }}
              className="profile-form"
            >
              <div className="profile-photo-top">
                <div className="profile-photo-preview-wrap profile-photo-preview-wrap--large">
                  {currentPhotoUrl ? (
                    <img
                      src={currentPhotoUrl}
                      alt="Current profile"
                      className="profile-photo-preview"
                      onError={hideImgAndShowPlaceholder}
                    />
                  ) : null}
                  <div className={placeholderClass}>
                    No photo
                  </div>
                </div>
                <label className="form-label mt-2">Change profile photo (JPG/PNG, max 3MB)</label>
                <div className="profile-photo-actions">
                  <input type="file" accept=".jpg,.jpeg,.png" className="form-control" onChange={onPhotoFileChange} />
                  <button type="button" className="btn btn-outline-primary mt-2" onClick={onUploadPhoto} disabled={uploadingPhoto}>
                    {uploadingPhoto ? "Uploading..." : "Upload Photo"}
                  </button>
                </div>
              </div>

              <div className="profile-grid">
                <div>
                  <label className="form-label">Employee ID</label>
                  <input className="form-control" value={profile.employeeId || ""} readOnly />
                </div>
                <div>
                  <label className="form-label">Name</label>
                  <input className="form-control" value={profile.name || ""} readOnly />
                </div>
                <div>
                  <label className="form-label">Email</label>
                  <input className="form-control" value={profile.email || ""} readOnly />
                </div>
                <div>
                  <label className="form-label">Role</label>
                  <input className="form-control" value={profile.role || ""} readOnly />
                </div>
                <div>
                  <label className="form-label">Status</label>
                  <input className="form-control" value={profile.status || ""} readOnly />
                </div>
                <div>
                  <label className="form-label">Address</label>
                  <input
                    className="form-control"
                    value={address}
                    onChange={(event) => onAddressChange(event.target.value)}
                    placeholder="Enter address"
                  />
                </div>
                <div>
                  <label className="form-label">Phone Number</label>
                  <input
                    type="tel"
                    inputMode="numeric"
                    autoComplete="tel"
                    className={phoneError ? "form-control is-invalid" : "form-control"}
                    value={phoneNumber}
                    onChange={(event) => onPhoneChange(event.target.value)}
                    placeholder="e.g. 9876543210"
                    maxLength={10}
                  />
                  {phoneError ? <div className="invalid-feedback d-block">{phoneError}</div> : null}
                </div>
              </div>

              <div className="upload-row">
                <div className="upload-item">
                  <label className="form-label">Upload Signature (JPG/PNG, max 2MB)</label>
                  <input type="file" accept=".jpg,.jpeg,.png" className="form-control" onChange={onSignatureFileChange} />
                  <button
                    type="button"
                    className="btn btn-outline-primary mt-2"
                    onClick={onUploadSignature}
                    disabled={uploadingSignature}
                  >
                    {uploadingSignature ? "Uploading..." : "Upload Signature"}
                  </button>
                </div>
              </div>

              <div className="profile-actions">
                <button type="button" className="btn btn-outline-secondary" onClick={onClose} disabled={saving}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={saving || loading || !!phoneError}>
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export default ProfileDialog;
