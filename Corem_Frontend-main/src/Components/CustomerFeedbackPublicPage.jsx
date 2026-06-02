import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  buildCustomerFeedbackFrontDoorUrl,
  resolvePublicCustomerFeedbackPostUrl,
} from "../config/customerFeedbackPublic.js";

const emptyForm = () => ({
  name: "",
  email: "",
  phone: "",
  companyName: "",
  productQuality: "",
  customerService: "",
  machiningQuality: "",
  pricing: "",
  shippingDelivery: "",
  likelihoodRecommend: "",
  otherCategoryNote: "",
  specificFeedback: "",
  suggestions: "",
  additionalComments: "",
});

export default function CustomerFeedbackPublicPage() {
  const { siteId } = useParams();
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  const postUrl = useMemo(() => {
    const sid = String(siteId ?? "").trim();
    if (!sid) return "";
    return resolvePublicCustomerFeedbackPostUrl(sid);
  }, [siteId]);

  const invalidSite = !String(siteId ?? "").trim();

  const onChange = (key) => (e) => {
    const v = e.target.value;
    setForm((prev) => ({ ...prev, [key]: v }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (invalidSite || !postUrl) {
      setError("Invalid feedback link (site id).");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(postUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const text = await res.text();
      let msg = "";
      try {
        const j = text ? JSON.parse(text) : {};
        msg = j.message || j.error || "";
      } catch {
        msg = text?.slice(0, 200) || "";
      }
      if (!res.ok) {
        throw new Error(msg || `Request failed (${res.status})`);
      }
      setDone(true);
      setForm(emptyForm());
    } catch (err) {
      setError(err?.message || "Could not submit feedback. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  };

  if (invalidSite) {
    return (
      <div className="container py-4" style={{ maxWidth: "36rem" }}>
        <h1 className="h4 mb-3">Customer feedback</h1>
        <p className="text-danger mb-0">This link is invalid. Ask your site contact for the correct feedback URL.</p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="container py-4" style={{ maxWidth: "36rem" }}>
        <h1 className="h4 mb-3">Thank you</h1>
        <p className="text-muted mb-0">Your feedback has been submitted.</p>
      </div>
    );
  }

  return (
    <div className="container py-4" style={{ maxWidth: "42rem" }}>
      <h1 className="h4 mb-1">Customer feedback</h1>
      <p className="text-muted small mb-4">
        Site <strong>{siteId}</strong>. You do not need an account to submit this form.
      </p>

      <form onSubmit={onSubmit} className="border rounded-3 p-3 p-md-4 shadow-sm bg-body">
        {error ? (
          <div className="alert alert-danger py-2 small" role="alert">
            {error}
          </div>
        ) : null}

        <div className="row g-2 mb-2">
          <div className="col-12 col-md-6">
            <label className="form-label small mb-0" htmlFor="cfb-name">
              Name
            </label>
            <input id="cfb-name" className="form-control form-control-sm" value={form.name} onChange={onChange("name")} />
          </div>
          <div className="col-12 col-md-6">
            <label className="form-label small mb-0" htmlFor="cfb-company">
              Company
            </label>
            <input
              id="cfb-company"
              className="form-control form-control-sm"
              value={form.companyName}
              onChange={onChange("companyName")}
            />
          </div>
          <div className="col-12 col-md-6">
            <label className="form-label small mb-0" htmlFor="cfb-email">
              Email
            </label>
            <input
              id="cfb-email"
              type="email"
              className="form-control form-control-sm"
              value={form.email}
              onChange={onChange("email")}
            />
          </div>
          <div className="col-12 col-md-6">
            <label className="form-label small mb-0" htmlFor="cfb-phone">
              Phone
            </label>
            <input id="cfb-phone" className="form-control form-control-sm" value={form.phone} onChange={onChange("phone")} />
          </div>
        </div>

        <p className="small text-muted mb-2">Ratings / scores (as provided by your organisation)</p>
        <div className="row g-2 mb-2">
          {[
            ["productQuality", "Product quality"],
            ["customerService", "Customer service"],
            ["machiningQuality", "Machining quality"],
            ["pricing", "Pricing"],
            ["shippingDelivery", "Shipping / delivery"],
          ].map(([key, label]) => (
            <div className="col-12 col-md-4" key={key}>
              <label className="form-label small mb-0" htmlFor={`cfb-${key}`}>
                {label}
              </label>
              <input id={`cfb-${key}`} className="form-control form-control-sm" value={form[key]} onChange={onChange(key)} />
            </div>
          ))}
          <div className="col-12 col-md-4">
            <label className="form-label small mb-0" htmlFor="cfb-likelihood">
              Likelihood to recommend (0–10)
            </label>
            <input
              id="cfb-likelihood"
              className="form-control form-control-sm"
              value={form.likelihoodRecommend}
              onChange={onChange("likelihoodRecommend")}
            />
          </div>
          <div className="col-12">
            <label className="form-label small mb-0" htmlFor="cfb-other">
              Other category note
            </label>
            <input
              id="cfb-other"
              className="form-control form-control-sm"
              value={form.otherCategoryNote}
              onChange={onChange("otherCategoryNote")}
            />
          </div>
        </div>

        <div className="mb-2">
          <label className="form-label small mb-0" htmlFor="cfb-specific">
            Specific feedback
          </label>
          <textarea
            id="cfb-specific"
            className="form-control form-control-sm"
            rows={3}
            value={form.specificFeedback}
            onChange={onChange("specificFeedback")}
          />
        </div>
        <div className="mb-2">
          <label className="form-label small mb-0" htmlFor="cfb-suggestions">
            Suggestions
          </label>
          <textarea
            id="cfb-suggestions"
            className="form-control form-control-sm"
            rows={3}
            value={form.suggestions}
            onChange={onChange("suggestions")}
          />
        </div>
        <div className="mb-3">
          <label className="form-label small mb-0" htmlFor="cfb-additional">
            Additional comments
          </label>
          <textarea
            id="cfb-additional"
            className="form-control form-control-sm"
            rows={2}
            value={form.additionalComments}
            onChange={onChange("additionalComments")}
          />
        </div>

        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "Submitting…" : "Submit feedback"}
        </button>
      </form>

      <p className="small text-muted mt-3 mb-0">
        Public page URL (bookmark or share):{" "}
        <code className="user-select-all">{buildCustomerFeedbackFrontDoorUrl(siteId)}</code>
      </p>
      <p className="small mt-2 mb-0">
        <Link to="/">Back to sign in</Link>
      </p>
    </div>
  );
}
