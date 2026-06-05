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

- The parent still uses **`GET /api/admin/sites?…`** and `resolveSiteIdFromWorkflowSegment` to match the route segment to a row when possible, and passes a **numeric** `siteId` into the workflow when resolution succeeds.
- If resolution fails but the route segment is non-empty, the app may still mount the workflow with the **string segment** so deep links work once the backend accepts the slug in every path (encode path segments in fetches).
- **Attendance portal filtering** compares `Number(siteId)` to row `siteId`; if you standardise on slug-only props, adjust that filter to match `jobCode` / `site` fields instead of numeric id only.

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
| **Autosave** or **switch tab** (silent) | **`PUT`** `.../job-data/workflow-batch` first; on **404/405** → per-step **`PUT`**s + **`PUT`** `.../wizard`. |
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

Meta: **`GET /api/meta/challenge-line-heads`** for challenge head presets.

---

## Customer feedback public URL

- **Create invite:** `POST /api/admin/sites/{siteId}/feedback-invites` → opaque `token`.
- **`GET /api/admin/sites/{siteId}`** may include `customerFeedbackInviteToken`, `customerFeedbackInviteExpiresAt` when a valid invite exists.
- **`GET …/customer-feedback`** may include the same token fields.

**Frontend must build the customer link as** (`buildCustomerFeedbackFrontDoorUrl` in `src/config/customerFeedbackPublic.js`):

`{origin}{base}/customer-feedback/{siteId}?token={customerFeedbackInviteToken}`

Use the same `{siteId}` form your public POST expects (often numeric id in the path).

Submit: **`POST /api/public/sites/{siteId}/customer-feedback`** with JSON including **`token`**.

Do **not** ship a link without **`?token=`** when the API requires an invite.

---

## Frontend checklist

1. **`{siteId}` in paths** may be numeric id, job code, or slug (see server rules above); encode path segments in requests.
2. **On load:** call the matching **`GET`** endpoints and hydrate tables (wizard + job-data + register + portal + machinery + users, as in `loadAll`).
3. **On autosave / Save:** use **`workflow-batch`** for silent saves (with fallback) or individual **`PUT`**s for Save & next; wait for **`200`** and **`success: true`** before clearing “Saving…”.
4. **Equipment month grid:** include **`availabilityYear`** and **`availabilityMonth`** on equipment portal saves when persisting day checkboxes.
5. **Challenges:** send **`challengeLines`** (array / wrapper per server); wizard may embed challenge data — when both are sent in batch, **challengeLines wins**.
6. **Feedback step:** **`POST …/feedback-invites`** if no token yet; copy link using **`customerFeedbackInviteToken`** from site or customer-feedback **`GET`**.
