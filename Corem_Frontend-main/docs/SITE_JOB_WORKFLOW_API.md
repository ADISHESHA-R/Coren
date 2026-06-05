# Site job workflow — backend APIs and frontend integration

Base path (admin, JWT required): `/api/admin/sites/{siteId}`

## `{siteId}` in the path (server resolution)

The server resolves **`{siteId}`** as any of:

- **Numeric primary key** (e.g. `1`)
- Exact **job code** (case-insensitive), e.g. `BLR001`
- **UI slug** `{name}-{jobCode}`: the segment after the **last hyphen** is treated as the job code, e.g. `bangalore-blr001` → `blr001` → same site as `BLR001`

So the SPA may call **`/api/admin/sites/{segment}/…`** using the same value as in the browser path **without** a separate “resolve to numeric id” step, as long as the segment is encoded for URLs (e.g. `encodeURIComponent`).

**Machinery** `?siteId=` query parameters accept the same formats (`src/Components/AdminSiteJobWorkflow.jsx`).

### Coren SPA today (`AdminDashboard` + `AdminSiteJobWorkflow`)

- The parent uses **`GET /api/admin/sites?…`** and `resolveSiteIdFromWorkflowSegment` when possible, then passes a **numeric** `siteId` into the workflow. If lookup misses, it passes the **URL segment** (slug) so APIs still work server-side.
- **`workflowSiteId` is sticky:** once a numeric id is known for the current route segment, the parent does **not** downgrade back to the slug when `sites` / dashboard stats refresh — that used to change the `siteId` prop and retrigger **`loadAll`** in a tight loop.
- **Attendance portal filtering** uses numeric `site?.id` when the `siteId` prop is a slug (see `refreshSiteAttendanceList`).

---

## APIs for this page (route → backend)

**Route:** `/admin/sites/:siteKey/site-job-workflow`  
Optional query: **`?step=`** (1-based, `1` … `10`). If omitted or invalid, the UI uses the server wizard step after load.

### Before / during workflow mount

| When | Method | Path | Purpose |
|------|--------|------|---------|
| Sites / workflow view | `GET` | `/api/admin/sites?page=0&size=20` (dashboard query) | Populate site list for slug → row matching and admin UI. |

### Initial load — `loadAll` (`AdminSiteJobWorkflow.jsx`)

Substitute `{siteId}` with your chosen identifier (numeric, job code, or encoded slug).

| Order | Method | Path |
|-------|--------|------|
| 1 | `GET` | `/api/admin/sites/{siteId}` |
| 2 | `GET` | `/api/admin/sites/{siteId}/wizard` |
| 3 | `GET` | `/api/meta/challenge-line-heads` |
| 4 (parallel) | `GET` | `/api/admin/sites/{siteId}/job-data/advance-expense-lines` |
| 4 | `GET` | `/api/admin/sites/{siteId}/job-data/technician-payments` |
| 4 | `GET` | `/api/admin/sites/{siteId}/job-data/tool-issues` |
| 4 | `GET` | `/api/admin/sites/{siteId}/job-data/challenge-lines` |
| 4 | `GET` | `/api/admin/sites/{siteId}/job-data/behaviour-report` |
| 4 | `GET` | `/api/admin/sites/{siteId}/attendance-register?blockIndex=0&daysPerBlock=15` |
| 4 | `GET` | `/api/admin/sites/{siteId}/customer-feedback` |
| 4 | `GET` | `/api/admin/machinery?siteId={siteId}` |
| 4 | `GET` | `/api/admin/sites/{siteId}/job-data/equipment-portal?year={Y}&month={M}` |
| 5 | `GET` | `/api/admin/users?page=0&size=500` |

Then the UI sets the tab from **`?step=`** if valid, else wizard `step`; it may update **`?step=`** only when it differs from the URL (avoids redundant `setSearchParams`).

### Extra GETs when navigating inside the workflow

| Condition | Method | Path |
|-----------|--------|------|
| Tools step and intro month changed vs last portal fetch | `GET` | `/api/admin/sites/{siteId}/job-data/equipment-portal?year=&month=` |
| Attendance register tab (UI step 9) | `GET` | `/api/admin/attendance?…` (several statuses) |
| Completion tab (UI step 10) | `GET` | `/api/admin/sites/{siteId}/customer-feedback`, `GET` `/api/admin/sites/{siteId}` |

Optional: **`PUT`** `/api/admin/sites/{siteId}/job-data/equipment-portal/layout` after drag-reorder when rows have server IDs.

### Saves (Coren SPA behaviour)

| User action | APIs |
|-------------|------|
| **Autosave** or **switch tab** (silent) | **`PUT`** `.../job-data/workflow-batch` first; if the response is not OK or `success` is false (including **404** or **400** body mismatch), **fall back** to per-step **`PUT`**s + **`PUT`** `.../wizard`. The bundled `wizard.step` is **`max(serverPersistedStep, currentTab1Based)`** so later tabs are not saved with an outdated low step value. |
| **Save & next** | Per-step **`PUT`**s + **`PUT`** `.../wizard` (no batch). |

**Save & next** by `currentStepIndex` (0-based in code; UI step = index + 1):

| Index | UI step | Writes |
|-------|---------|--------|
| 0–1 | 1–2 | `PUT …/wizard` |
| 2 | 3 | `PUT …/job-data/equipment-portal`, `PUT …/wizard` |
| 3 | 4 | `PUT …/advance-expense-lines`, `PUT …/technician-payments`, `PUT …/wizard` |
| 4 | 5 | `PUT …/wizard` (team movement lives in wizard blob in this SPA) |
| 5 | 6 | `PUT …/job-data/tool-issues`, `PUT …/wizard` |
| 6 | 7 | `PUT …/job-data/challenge-lines`, `PUT …/wizard` |
| 7 | 8 | `PUT …/job-data/behaviour-report`, `PUT …/wizard` |
| 8 | 9 | `PUT …/job-data/attendance-register-cells` if needed, `PUT …/wizard`, optional `GET …/attendance-register` reload |
| 9 | 10 | `PUT …/wizard` |

---

## One-call autosave (recommended)

**`PUT` or `POST`** `/api/admin/sites/{siteId}/job-data/workflow-batch`  
`Content-Type: application/json`

Body: object; **omit** a property or set it to `null` to skip that section. Non-null sections are applied on the server in this order:

1. `wizard` — JSON object stored as the wizard blob. The Coren SPA sends `{ "step": <1-based>, "data": { … } }` to mirror `PUT …/wizard`; if your server expects only the inner blob, align one shape in the batch handler.
2. `advanceExpenseLines` — array (same shape as the dedicated endpoint).
3. `technicianPayments` — array.
4. `toolIssues` — array.
5. `equipmentPortal` — object (same shape as `PUT …/job-data/equipment-portal`, including `availabilityYear` / `availabilityMonth` when saving the monthly grid).
6. `behaviourReport` — JSON object (backend may store as string).
7. `challengeLines` — JSON array **or** wrapper with `rows` / `challengeLines` / etc. (same rules as `PUT …/job-data/challenge-lines`).
8. `attendanceRegisterCells` — `{ "cells": [ … ] }` (same as register-cells endpoint).

If you send both `wizard` and `challengeLines`, **challengeLines wins** for normalized challenge rows.

---

## Per-step dedicated endpoints (reference)

| Workflow area | GET | PUT / POST |
|---------------|-----|------------|
| Wizard blob (intro, engineering, embedded JSON, etc.) | `GET …/wizard` | `PUT …/wizard` |
| Step 3 — equipment checklist | `GET …/job-data/equipment-portal?year=&month=` | `PUT …/job-data/equipment-portal` |
| Step 4 — advance + technician | `GET …/advance-expense-lines`, `GET …/technician-payments` | `PUT` each |
| Step 5 — team movement (this SPA) | (inside wizard) | `PUT …/wizard` with `teamMovementRegister` in `data` |
| Step 6 — tool issues | `GET …/tool-issues` | `PUT …/tool-issues` |
| Step 7 — challenges | `GET …/challenge-lines` | `PUT` or `POST` `…/challenge-lines` |
| Step 8 — behaviour | `GET …/behaviour-report` | `PUT …/behaviour-report` |
| Step 9 — attendance register grid | `GET …/attendance-register?blockIndex=&daysPerBlock=` | `PUT …/job-data/attendance-register-cells` (+ optional register `GET`) |
| Customer feedback (admin) | `GET …/customer-feedback` | — |
| Customer feedback invite | — | `POST …/feedback-invites` |

**Challenge lines GET / batch:** The SPA accepts `data` as a bare array, `{ challengeLines }`, Spring `Page.content`, stringified JSON, or nested `data`; rows match heads via `headIndex` / `index` / `challengeHeadIndex` / `challengeHeadId` (and snake_case aliases). After a successful **workflow-batch** autosave on the challenges step, it **refetches** `GET …/challenge-lines` so the grid matches the server.

**Admin customer feedback DTO (ProjectC / current dev):** `GET …/customer-feedback` returns `{ success, data }` where **`data`** is **`SiteCustomerFeedbackAdminDto`**: answers appear as **top-level camelCase** fields (`name`, `email`, `phone`, `companyName`, `productQuality`, …, `additionalComments`) matching the public POST, plus unchanged **`feedbackJson`** (raw string) when present. The SPA binds read-only fields from **`data.*`**; `parseCustomerFeedbackRecord` still merges **`feedbackJson`** and snake_case / nested shapes for older or odd responses. **`GET …/sites/{id}`** may also expose **`customerFeedbackJson`** (same stored blob); the completion step **merges** site + dedicated GET so wizard-only persistence still displays.

### Backend JSON contract (admin customer feedback)

This is the shape **`AdminSiteJobWorkflow`** Step 10 expects after **`extractCustomerFeedbackDtoFromAdminResponse`** (`src/data/siteJobWorkflowForms.js`). Backend teams should align **`GET /api/admin/sites/{siteId}/customer-feedback`** (and optional mirrors on **`GET /api/admin/sites/{siteId}`**) with this. The client then runs **`normalizeAdminCustomerFeedbackDto`** (same module) on the extracted/merged object before field merge — that handles paging, object-typed `feedbackJson`, and nested string wrappers.

**Current server alignment:** The API matches the preferred contract: **`data`** is a normal JSON object, the admin DTO is **camelCase-first** with **`@JsonAlias`** for snake_case on ingest, **`success`** / **`Success`** / **`status`** stay consistent for clients that read different flags, **`feedback_json`** is duplicated alongside **`feedbackJson`** when the blob is non-empty, and the **site** row exposes **`customer_feedback_json`** / **`customer_feedback_payload`** (plus camelCase mirrors) for merge. **`likelihoodRecommend`** may be a JSON number; the UI accepts string or number. Double-encoded blobs, stringified **`data`**, `Page.content`, and **`data` / `result` / `payload`** drilling remain **client-side** tolerances for gateways or legacy stacks — not required from this API.

#### 1. HTTP envelope

- Body must indicate success with at least one of: **`success: true`**, **`Success: true`**, or **`status`** in `{ true, "true", 1, "1" }` (JSON **boolean** `true` for `status` / `success` is the usual case and is accepted).
- **Preferred:** `{ "success": true, "message": "…", "data": { … } }` where **`data`** is a **JSON object** (not a bare array).
- **`data`** may be a **string** of JSON; the client parses it once.
- Extra gateway wrappers are tolerated: a single-key `{ "data": { … } }` chain is unwrapped; the client may also drill **`data` → `result` → `payload`** until it finds an object that looks like the DTO (e.g. contains `feedbackJson`, `certificateClientStatus`, `siteId`, `jobCode`, or `name` / `email`).

#### 2. Ideal DTO inside `data` (best for Step 10)

Put answers on the **same object** as metadata, **camelCase**, matching the public form:

| Field | Notes |
|-------|--------|
| `certificateClientStatus` | e.g. `FEEDBACK_SUBMITTED` |
| `customerFeedbackApprovedAt` | optional |
| `siteId`, `jobCode` | optional identifiers |
| `name`, `email`, `phone`, `companyName` | strings |
| `productQuality`, `customerService`, `machiningQuality`, `pricing`, `shippingDelivery` | as stored |
| `likelihoodRecommend` | string or number |
| `otherCategoryNote`, `specificFeedback`, `suggestions`, `additionalComments` | strings |

**Example (ideal — no `feedbackJson` required):**

```json
{
  "success": true,
  "data": {
    "siteId": 12,
    "jobCode": "sam123",
    "certificateClientStatus": "FEEDBACK_SUBMITTED",
    "name": "Test Test",
    "email": "user@example.com"
  }
}
```

#### 3. When answers live only in `feedbackJson`

The client still supports **`feedbackJson`** or **`feedback_json`** as a **string** whose value is JSON (possibly nested / double-encoded).

- **Single-encoded inner form:**  
  `"feedbackJson": "{\"name\":\"Test Test\",\"email\":\"user@example.com\"}"`
- **Double-encoded wrapper** (string contains `{ "feedbackJson": "<another JSON string>" }`):  
  `"feedbackJson": "{\"feedbackJson\":\"{\\\"name\\\":\\\"Test Test\\\",\\\"email\\\":\\\"user@example.com\\\"}\"}"`  
  The UI flattens repeated string `feedbackJson` / `feedback_json` layers until `name`, `email`, etc. are visible.
- **`feedbackJson` as a JSON object** (e.g. Jackson `Map`): same keys as the inner form; the client stringifies then runs the same flatten path.
- **Spring `Page`:** `data` may be `{ "content": [ { …dto… } ], … }`; the first array element is used when it looks like the feedback DTO.

Optional string/blob keys merged the same way include **`customerFeedbackJson`**, **`payload`**, **`json`**, **`body`**, etc. (see `mergeJsonFromKnownStringFields` in `siteJobWorkflowForms.js`). When **both** the dedicated GET and **`GET …/sites/{id}`** carry different blobs, the site blob is attached as **`customerFeedbackJson`** and merged **before** `feedbackJson` so the endpoint wins on key clashes but the site row can **fill missing** fields (`mergeSiteAndEndpointCustomerFeedbackForAdmin` + ordered merge in `mergeJsonFromKnownStringFields`).

#### 4. Snake_case

If the API returns snake_case on the DTO, a subset is mapped to camelCase (e.g. `customer_name` → `name`, `customer_email` / `e_mail` → `email`, `company_name` → `companyName`, `phone_number` → `phone`, `product_quality` → `productQuality`). CamelCase on **`data`** is still preferred.

#### 5. Site row mirror (`GET …/sites/{id}`)

For the completion step, the SPA **merges** the dedicated customer-feedback GET with the **site** object. Supported blob fields on the site include: **`customerFeedbackJson`**, **`customer_feedback_json`**, **`customerFeedbackPayload`**, **`customer_feedback_payload`**. If the dedicated GET omits `feedbackJson` but the site row carries the same stored blob, the UI can still populate fields.

Meta: **`GET /api/meta/challenge-line-heads`** for challenge head presets.

---

## Customer feedback public URL

- **Create invite (optional):** `POST /api/admin/sites/{siteId}/feedback-invites` → opaque `token` (for legacy `?token=` links or **`POST /api/public/feedback/{token}/approve`**).
- **`GET /api/admin/sites/{siteId}`** may include `customerFeedbackInviteToken`, `customerFeedbackInviteExpiresAt` when a valid invite exists.
- **`GET …/customer-feedback`** may include the same token fields.

**Bootstrap (public, no JWT):** **`GET /api/public/sites/{siteId}/customer-feedback`** — same `{siteId}` as the browser path (id, job code, or slug). Response drives headings and “already submitted” / “thank you” via **`certificateClientStatus`**, **`expired`**, **`revoked`**. **404** → inactive/unknown site.

**Frontend builds the customer link** (`buildCustomerFeedbackFrontDoorUrl` in `src/config/customerFeedbackPublic.js`):

`{origin}{base}/customer-feedback/{siteId}` with optional **`?token=`** for stricter invite flows.

Use the same `{siteId}` segment as in the admin workflow route when possible (slug + job code); fallback to numeric id.

**Submit:** **`POST /api/public/sites/{siteId}/customer-feedback`** with the same JSON shape as today (`feedbackJson` or flat). Omit **`token`** when using the tokenless URL; include **`token`** when **`?token=`** is present (or set **`VITE_PUBLIC_CUSTOMER_FEEDBACK_TOKEN_REQUIRED=true`** to require the query param before showing the form).

**Admin:** after a customer submits, refetch **`GET …/sites/{siteId}`** and **`GET …/customer-feedback`** so `certificateClientStatus` and answer fields under **`data`** stay current (completion step triggers refresh on enter). Persistence across reload is unchanged: this SPA must **`PUT`** wizard / **`workflow-batch`** / job-data endpoints per the backend workflow doc — not automatic from the Java repo alone.

---

## Frontend checklist

1. **`{siteId}` in paths** may be numeric id, job code, or slug (see server rules above); encode path segments in requests.
2. **On load:** call the matching **`GET`** endpoints and hydrate tables (wizard + job-data + register + portal + machinery + users, as in `loadAll`).
3. **On autosave / Save (this SPA only):** use **`workflow-batch`** for silent saves (with fallback) or individual **`PUT`**s for Save & next; wait for **`200`** and **`success: true`** before clearing “Saving…”. Reload persistence depends on these writes (see backend **`SITE_JOB_WORKFLOW_FRONTEND.md`** checklist).
4. **Equipment month grid:** include **`availabilityYear`** and **`availabilityMonth`** on equipment portal saves when persisting day checkboxes.
5. **Challenges:** send **`challengeLines`** (array / wrapper per server); wizard may embed challenge data — when both are sent in batch, **challengeLines wins**.
6. **Feedback step:** optional **`POST …/feedback-invites`** for token links; copy link using **`customerFeedbackInviteToken`** from site or customer-feedback **`GET`**. Prefer workflow-aligned **`{siteId}`** in the public URL; refetch admin **`GET …/customer-feedback`** and **`GET …/sites/{siteId}`** when entering the completion step or after submit so **`certificateClientStatus`** updates.
