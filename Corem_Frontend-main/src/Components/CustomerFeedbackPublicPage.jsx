import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useToast } from "./Toast.jsx";
import {
  buildCustomerFeedbackFrontDoorUrl,
  buildPublicCustomerFeedbackPostBody,
  parsePublicFeedbackContextResponse,
  publicFeedbackContextAllowsForm,
  publicFeedbackContextTerminalKind,
  resolvePublicCustomerFeedbackGetUrl,
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

const defaultCtx = () => ({
  jobCode: "",
  customerName: "",
  companyNameHint: "",
  certificateClientStatus: "NONE",
  expired: false,
  revoked: false,
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

  const [contextLoad, setContextLoad] = useState("idle");
  const [contextLoadError, setContextLoadError] = useState("");
  const [ctx, setCtx] = useState(null);

  const sid = String(siteId ?? "").trim();
  const invalidSite = !sid;

  const getUrl = useMemo(() => (invalidSite ? "" : resolvePublicCustomerFeedbackGetUrl(sid)), [invalidSite, sid]);
  const postUrl = useMemo(() => (invalidSite ? "" : resolvePublicCustomerFeedbackPostUrl(sid)), [invalidSite, sid]);

  const inviteTokenError = validatePublicCustomerFeedbackInviteToken(inviteToken);

  useEffect(() => {
    if (invalidSite || !getUrl) return undefined;
    let cancelled = false;
    setContextLoad("loading");
    setContextLoadError("");
    setCtx(null);
    (async () => {
      try {
        const res = await fetch(getUrl, { method: "GET", headers: { Accept: "application/json" } });
        const text = await res.text();
        let j = {};
        try {
          j = text ? JSON.parse(text) : {};
        } catch {
          j = {};
        }
        if (cancelled) return;
        if (res.status === 404) {
          setContextLoad("404");
          return;
        }
        if (!res.ok) {
          const msg = j.message || j.error || j.detail || text?.slice(0, 280) || `Request failed (${res.status})`;
          setContextLoad("error");
          setContextLoadError(String(msg));
          return;
        }
        if (typeof j.success === "boolean" && j.success === false) {
          const msg = j.message || j.error || j.detail || "The server could not load this feedback page.";
          setContextLoad("error");
          setContextLoadError(String(msg));
          return;
        }
        const parsed = parsePublicFeedbackContextResponse(j) ?? defaultCtx();
        setCtx(parsed);
        setContextLoad("ok");
      } catch (e) {
        if (!cancelled) {
          setContextLoad("error");
          setContextLoadError(e?.message || "Could not load this page.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [invalidSite, getUrl, sid]);

  const effectiveCtx = ctx ?? defaultCtx();
  const terminalKind = publicFeedbackContextTerminalKind(effectiveCtx);
  const allowsForm = publicFeedbackContextAllowsForm(effectiveCtx);

  useEffect(() => {
    if (contextLoad !== "ok" || !effectiveCtx.customerName) return undefined;
    setForm((prev) => {
      if (String(prev.name ?? "").trim()) return prev;
      return { ...prev, name: effectiveCtx.customerName };
    });
    return undefined;
  }, [contextLoad, effectiveCtx.customerName]);

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
          errMsg = `${errMsg} Configure VITE_PUBLIC_CUSTOMER_FEEDBACK_POST_URL_TEMPLATE at build time if your path differs.${
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

  const contextHeadingParts = [];
  if (effectiveCtx.jobCode) contextHeadingParts.push(`Job ${effectiveCtx.jobCode}`);
  if (effectiveCtx.customerName) contextHeadingParts.push(effectiveCtx.customerName);
  if (effectiveCtx.companyNameHint) contextHeadingParts.push(effectiveCtx.companyNameHint);

  if (invalidSite) {
    return (
      <div className="container py-4" style={{ maxWidth: "36rem" }}>
        <h1 className="h4 mb-3">Customer feedback</h1>
        <p className="text-danger mb-0">This link is invalid. Ask your site contact for the correct feedback URL.</p>
      </div>
    );
  }

  if (contextLoad === "loading" || contextLoad === "idle") {
    return (
      <div className="container py-4" style={{ maxWidth: "36rem" }}>
        <h1 className="h4 mb-3">Customer feedback</h1>
        <p className="text-muted mb-0">Loading…</p>
      </div>
    );
  }

  if (contextLoad === "404") {
    return (
      <div className="container py-4" style={{ maxWidth: "36rem" }}>
        <h1 className="h4 mb-3">Customer feedback</h1>
        <p className="text-muted mb-0">This feedback page is not available. The link may be incorrect or no longer active.</p>
        <p className="small mt-3 mb-0">
          <Link to="/">Back to sign in</Link>
        </p>
      </div>
    );
  }

  if (contextLoad === "error") {
    return (
      <div className="container py-4" style={{ maxWidth: "36rem" }}>
        <h1 className="h4 mb-3">Customer feedback</h1>
        <p className="text-danger mb-0">{contextLoadError || "Something went wrong while loading this page."}</p>
        <p className="small mt-3 mb-0">
          <Link to="/">Back to sign in</Link>
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

  if (terminalKind === "submitted") {
    return (
      <div className="container py-4" style={{ maxWidth: "36rem" }}>
        <h1 className="h4 mb-2">Thank you</h1>
        {contextHeadingParts.length ? (
          <p className="text-muted small mb-3">{contextHeadingParts.join(" · ")}</p>
        ) : null}
        <p className="mb-0">Your feedback has already been received.</p>
        <p className="small mt-3 mb-0">
          <Link to="/">Back to sign in</Link>
        </p>
      </div>
    );
  }

  if (terminalKind === "approved") {
    return (
      <div className="container py-4" style={{ maxWidth: "36rem" }}>
        <h1 className="h4 mb-2">Thank you</h1>
        {contextHeadingParts.length ? (
          <p className="text-muted small mb-3">{contextHeadingParts.join(" · ")}</p>
        ) : null}
        <p className="mb-0">This certificate has been approved on your side. No further action is needed here.</p>
        <p className="small mt-3 mb-0">
          <Link to="/">Back to sign in</Link>
        </p>
      </div>
    );
  }

  if (effectiveCtx.expired) {
    return (
      <div className="container py-4" style={{ maxWidth: "36rem" }}>
        <h1 className="h4 mb-3">Customer feedback</h1>
        <p className="text-muted mb-0">This feedback link has expired. Ask your site contact for a new link if you still need to respond.</p>
      </div>
    );
  }

  if (effectiveCtx.revoked) {
    return (
      <div className="container py-4" style={{ maxWidth: "36rem" }}>
        <h1 className="h4 mb-3">Customer feedback</h1>
        <p className="text-muted mb-0">This feedback link is no longer valid.</p>
      </div>
    );
  }

  if (!allowsForm) {
    const st = effectiveCtx.certificateClientStatus || "UNKNOWN";
    return (
      <div className="container py-4" style={{ maxWidth: "36rem" }}>
        <h1 className="h4 mb-2">Customer feedback</h1>
        {contextHeadingParts.length ? (
          <p className="text-muted small mb-3">{contextHeadingParts.join(" · ")}</p>
        ) : null}
        <p className="mb-0">This page is not open for new feedback right now.</p>
        <p className="small text-muted mt-2 mb-0">Status: {st}</p>
      </div>
    );
  }

  if (inviteTokenError) {
    return (
      <div className="container py-4" style={{ maxWidth: "36rem" }}>
        <h1 className="h4 mb-3">Customer feedback</h1>
        {contextHeadingParts.length ? (
          <p className="text-muted small mb-3">{contextHeadingParts.join(" · ")}</p>
        ) : null}
        <p className="text-danger mb-0">{inviteTokenError}</p>
        <p className="text-muted small mt-3 mb-0">
          Site id in this link: <strong>{siteId}</strong>
        </p>
      </div>
    );
  }

  return (
    <div className="container py-4" style={{ maxWidth: "42rem" }}>
      <h1 className="h4 mb-1">Customer feedback</h1>
      {contextHeadingParts.length ? (
        <p className="text-muted small mb-1">{contextHeadingParts.join(" · ")}</p>
      ) : (
        <p className="text-muted small mb-1">
          Site <strong>{siteId}</strong>
        </p>
      )}
      <p className="text-muted small mb-4">You do not need an account to submit this form.</p>

      <form onSubmit={onSubmit} className="border rounded-3 p-3 p-md-4 shadow-sm bg-body">
        {inviteToken ? (
          <p className="small text-muted border-bottom pb-2 mb-3">This session uses a secure invite link.</p>
        ) : null}
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
