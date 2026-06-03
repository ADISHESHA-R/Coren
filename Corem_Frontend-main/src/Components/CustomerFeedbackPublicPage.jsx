import { useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useToast } from "./Toast.jsx";
import {
  buildCustomerFeedbackFrontDoorUrl,
  buildPublicCustomerFeedbackPostBody,
  resolvePublicCustomerFeedbackPostUrl,
  validateCustomerFeedbackFormForSubmit,
  validatePublicCustomerFeedbackInviteToken,
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
  const [searchParams] = useSearchParams();
  const inviteToken = useMemo(() => String(searchParams.get("token") ?? "").trim(), [searchParams]);
  const { showError } = useToast() ?? {};
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  /** Set when dev stub or server says success but nothing was persisted (see message). */
  const [submitNotice, setSubmitNotice] = useState("");

  const postUrl = useMemo(() => {
    const sid = String(siteId ?? "").trim();
    if (!sid) return "";
    return resolvePublicCustomerFeedbackPostUrl(sid);
  }, [siteId]);

  const invalidSite = !String(siteId ?? "").trim();
  const inviteTokenError = validatePublicCustomerFeedbackInviteToken(inviteToken);

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
    const tokenMsg = validatePublicCustomerFeedbackInviteToken(inviteToken);
    if (tokenMsg) {
      setError(tokenMsg);
      return;
    }
    const validationMsg = validateCustomerFeedbackFormForSubmit(form);
    if (validationMsg) {
      setError(validationMsg);
      return;
    }
    setLoading(true);
    setSubmitNotice("");
    try {
      const payload = buildPublicCustomerFeedbackPostBody(form, inviteToken);
      const res = await fetch(postUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const text = await res.text();
      let msg = "";
      let successFlag = true;
      let stubResponse = false;
      try {
        const j = text ? JSON.parse(text) : {};
        msg = j.message || j.error || j.detail || "";
        if (typeof j.success === "boolean" && j.success === false) successFlag = false;
        stubResponse =
          j.stub === true ||
          (typeof msg === "string" && msg.toLowerCase().includes("development stub"));
      } catch {
        msg = text?.slice(0, 280) || "";
      }
      if (!res.ok) {
        let errMsg = msg || `Request failed (${res.status})`;
        if (/invalid or expired/i.test(String(errMsg))) {
          errMsg = `${errMsg} Use the full feedback link from your administrator (with ?token=…), or ask them to send a new invite.`;
        } else if (
          /no static resource|not found|404/i.test(String(errMsg)) &&
          /customer-feedback/i.test(String(errMsg))
        ) {
          errMsg = `${errMsg} The API may require POST /api/public/sites/{siteId}/customer-feedback with a JSON body including **token** (invite) plus feedback fields. Configure VITE_PUBLIC_CUSTOMER_FEEDBACK_POST_URL_TEMPLATE at build time if your path differs.${
            import.meta.env.DEV
              ? " For local dev without the route, set VITE_DEV_STUB_PUBLIC_CUSTOMER_FEEDBACK=true in .env.development."
              : ""
          }`;
        }
        throw new Error(errMsg);
      }
      if (!successFlag) {
        throw new Error(msg || "The server did not accept this submission.");
      }
      if (stubResponse) {
        setSubmitNotice(
          msg ||
            "This response came from the local dev stub — nothing was saved to your API, so the admin screen will stay empty. Set VITE_DEV_STUB_PUBLIC_CUSTOMER_FEEDBACK=false and restart Vite once your backend exposes POST /api/public/sites/{siteId}/customer-feedback.",
        );
      } else {
        setSubmitNotice("");
      }
      setDone(true);
      setForm(emptyForm());
    } catch (err) {
      const m = err?.message || "Could not submit feedback. Check your connection and try again.";
      showError?.(m);
      setError(m);
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

  if (inviteTokenError) {
    return (
      <div className="container py-4" style={{ maxWidth: "36rem" }}>
        <h1 className="h4 mb-3">Customer feedback</h1>
        <p className="text-danger mb-0">{inviteTokenError}</p>
        <p className="text-muted small mt-3 mb-0">
          Site id in this link: <strong>{siteId}</strong>
        </p>
      </div>
    );
  }

  if (done) {
    return (
      <div className="container py-4" style={{ maxWidth: "36rem" }}>
        <h1 className="h4 mb-3">Thank you</h1>
        {submitNotice ? (
          <>
            <div className="alert alert-warning small" role="status">
              {submitNotice}
            </div>
            <p className="text-muted small mb-0">Nothing was stored on the server, so the admin page will not show this submission.</p>
          </>
        ) : (
          <p className="text-muted mb-0">Your feedback has been submitted.</p>
        )}
      </div>
    );
  }

  return (
    <div className="container py-4" style={{ maxWidth: "42rem" }}>
      <h1 className="h4 mb-1">Customer feedback</h1>
      <p className="text-muted small mb-4">
        Site <strong>{siteId}</strong>. You do not need an account to submit this form.
        {inviteToken ? (
          <>
            {" "}
            This session is tied to a secure invite link.
          </>
        ) : null}
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
                {label} <span className="text-muted">(0–10)</span>
              </label>
              <input
                id={`cfb-${key}`}
                type="number"
                min={0}
                max={10}
                className="form-control form-control-sm"
                value={form[key]}
                onChange={onChange(key)}
              />
            </div>
          ))}
          <div className="col-12 col-md-4">
            <label className="form-label small mb-0" htmlFor="cfb-likelihood">
              Likelihood to recommend (0–10)
            </label>
            <input
              id="cfb-likelihood"
              type="number"
              min={0}
              max={10}
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
        <code className="user-select-all">{buildCustomerFeedbackFrontDoorUrl(siteId, inviteToken)}</code>
      </p>
      <p className="small mt-2 mb-0">
        <Link to="/">Back to sign in</Link>
      </p>
    </div>
  );
}
