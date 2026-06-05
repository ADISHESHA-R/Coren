# Site job workflow — backend APIs and frontend integration

Base path (admin, JWT required): `/api/admin/sites/{siteId}`  
Replace `{siteId}` with the numeric site id (e.g. `1`). The SPA resolves slugs such as `bangalore-blr001` via `GET /api/admin/sites` (or your slug route) before calling these APIs.

---

## APIs for this page (route → backend)

**Route:** `/admin/sites/:siteKey/site-job-workflow`  
Optional query: **`?step=`** (1-based, `1` … `10`). If omitted or invalid, the UI uses the server wizard step after load.

### Before the workflow mounts (parent shell)

| When | Method | Path | Purpose |
|------|--------|------|---------|
| Workflow or sites view is active | `GET` | `/api/admin/sites?page=0&size=20` (query string from `AdminDashboard`) | Site list so **`siteKey`** maps to **`siteId`** (`resolveSiteIdFromWorkflowSegment` in `src/utils/adminSiteRoutes.js`). |

If the slug cannot be resolved, the parent shows an invalid-link message and **does not** run workflow `loadAll`.

### Initial load — `loadAll` (once per `siteId`; `AdminSiteJobWorkflow.jsx`)

All calls use the same admin **JWT** as the rest of the dashboard.

| Order | Method | Path | Purpose |
|-------|--------|------|---------|
| 1 | `GET` | `/api/admin/sites/{siteId}` | Site header, job code, feedback token fields, etc. |
| 2 | `GET` | `/api/admin/sites/{siteId}/wizard` | Wizard blob + persisted `step`. |
| 3 | `GET` | `/api/meta/challenge-line-heads` | Challenge presets (fallback if empty). |
| 4 (parallel) | `GET` | `/api/admin/sites/{siteId}/job-data/advance-expense-lines` | Step 4 expenses. |
| 4 | `GET` | `/api/admin/sites/{siteId}/job-data/technician-payments` | Step 4 technicians. |
| 4 | `GET` | `/api/admin/sites/{siteId}/job-data/tool-issues` | Step 6 tool issues. |
| 4 | `GET` | `/api/admin/sites/{siteId}/job-data/challenge-lines` | Step 7 challenges. |
| 4 | `GET` | `/api/admin/sites/{siteId}/job-data/behaviour-report` | Step 8 behaviour. |
| 4 | `GET` | `/api/admin/sites/{siteId}/attendance-register?blockIndex=0&daysPerBlock=15` | Step 9 register (default block; `15` = `DAYS_CHECKLIST` in code). |
| 4 | `GET` | `/api/admin/sites/{siteId}/customer-feedback` | Completion / feedback DTO. |
| 4 | `GET` | `/api/admin/machinery?siteId={siteId}` | Machinery catalog (tools step). |
| 4 | `GET` | `/api/admin/sites/{siteId}/job-data/equipment-portal?year={Y}&month={M}` | Step 3 grid; **Y/M** from wizard intro `toolsChecklistMonth`. |
| 5 | `GET` | `/api/admin/users?page=0&size=500` | User directory (started in parallel with row 4). |

Then the UI sets the tab from **`?step=`** if valid, else wizard `step`; it may update **`?step=`** only when it differs (avoids redundant navigations).

### Extra GETs when navigating inside the workflow

| Condition | Method | Path |
|-----------|--------|------|
| Tools step and intro month changed vs last portal fetch | `GET` | `/api/admin/sites/{siteId}/job-data/equipment-portal?year=&month=` |
| Attendance register tab (step 9) | `GET` | `/api/admin/attendance?…` (several statuses) — `refreshSiteAttendanceList` |
| Completion tab (step 10) | `GET` | `/api/admin/sites/{siteId}/customer-feedback` and `GET` `/api/admin/sites/{siteId}` — `refreshCustomerFeedback` |

Optional: **`PUT`** `/api/admin/sites/{siteId}/job-data/equipment-portal/layout` after drag-reorder when rows have server IDs.

### Saves (which APIs fire)

| User action | APIs |
|-------------|------|
| **Autosave** or **switch tab** (silent) | **`PUT`** `.../job-data/workflow-batch` (wizard + current-step fields); on **404/405** → same per-step **`PUT`**s as Save & next + **`PUT`** `.../wizard`. |
| **Save & next** | Per-step **`PUT`**s (no batch). |

**Save & next** by step index in code (`currentStepIndex`, 0-based; UI step = +1):

| Index | UI step | Writes |
|-------|---------|--------|
| 0–1 | 1–2 | `PUT …/wizard` |
| 2 | 3 | `PUT …/job-data/equipment-portal`, `PUT …/wizard` |
| 3 | 4 | `PUT …/advance-expense-lines`, `PUT …/technician-payments`, `PUT …/wizard` |
| 4 | 5 | `PUT …/wizard` (team movement in blob) |
| 5 | 6 | `PUT …/job-data/tool-issues`, `PUT …/wizard` |
| 6 | 7 | `PUT …/job-data/challenge-lines`, `PUT …/wizard` |
| 7 | 8 | `PUT …/job-data/behaviour-report`, `PUT …/wizard` |
| 8 | 9 | `PUT …/job-data/attendance-register-cells` if needed, `PUT …/wizard`, then optional `GET …/attendance-register` reload |
| 9 | 10 | `PUT …/wizard` |

---

## One-call autosave (recommended)

**`PUT` or `POST`** `/api/admin/sites/{siteId}/job-data/workflow-batch`  
`Content-Type: application/json`

Body: object; **omit** a property or set it to `null` to skip that section. Non-null sections are applied in this order on the server:

1. `wizard` — object with `step` (1-based) and `data` (wizard blob), same semantics as `PUT .../wizard`.
2. `advanceExpenseLines` — array (same shape as `PUT .../job-data/advance-expense-lines`).
3. `technicianPayments` — array.
4. `toolIssues` — array.
5. `equipmentPortal` — object (same shape as `PUT .../job-data/equipment-portal`, including `availabilityYear` / `availabilityMonth` when saving the monthly grid).
6. `behaviourReport` — JSON object (backend may store as string).
7. `challengeLines` — JSON array **or** wrapper with `rows` / `challengeLines` / etc. (same rules as `PUT .../job-data/challenge-lines`).
8. `attendanceRegisterCells` — `{ "cells": [ ... ] }` (same as `PUT .../job-data/attendance-register-cells`).

If you send both `wizard` and `challengeLines`, **challengeLines wins** for normalized challenge rows (per backend contract).

### Frontend behaviour (`AdminSiteJobWorkflow.jsx`)

- **Silent saves** (autosave ~4s, saving before switching workflow tabs): the app **tries `PUT .../workflow-batch` first**. If the server responds **404 or 405**, it **falls back** to the legacy sequence (per-endpoint `PUT`s + `PUT .../wizard`).
- **Save & next** (non-silent): still uses the **per-endpoint** writes so step-specific failures stay easy to debug.

## Per-step dedicated endpoints (legacy / Save & next)

| Workflow area | GET | PUT / POST |
|---------------|-----|------------|
| Wizard blob (intro, engineering, team movement JSON, etc.) | `GET .../wizard` | `PUT .../wizard` |
| Step 3 — equipment checklist (month grid) | `GET .../job-data/equipment-portal?year=&month=` | `PUT .../job-data/equipment-portal` |
| Step 4 — advance + technician tables | `GET .../job-data/advance-expense-lines`, `GET .../job-data/technician-payments` | `PUT` each |
| Step 5 — team members movement register | (fields in wizard `teamMovementRegister`) | `PUT .../wizard` (snapshot includes normalized register) |
| Step 6 — tool issues | `GET .../job-data/tool-issues` | `PUT .../job-data/tool-issues` |
| Step 7 — challenges | `GET .../job-data/challenge-lines` | `PUT` or `POST` `.../job-data/challenge-lines` |
| Step 8 — site behaviour | `GET .../job-data/behaviour-report` | `PUT .../job-data/behaviour-report` |
| Step 9 — attendance register grid | `GET .../attendance-register?blockIndex=&daysPerBlock=` | `PUT .../job-data/attendance-register-cells` then optional register reload |
| Customer feedback (admin) | `GET .../customer-feedback` | — |
| Customer feedback invite | — | `POST .../feedback-invites` |

Meta: `GET /api/meta/challenge-line-heads` for challenge head presets.

## Customer feedback public URL

- **Create invite:** `POST /api/admin/sites/{siteId}/feedback-invites` → returns opaque `token`.
- **Site details** `GET /api/admin/sites/{siteId}` may include when a valid invite exists: `customerFeedbackInviteToken`, `customerFeedbackInviteExpiresAt`.
- **Admin feedback payload:** `GET .../customer-feedback` may include the same token fields.

**Frontend builds the customer link as** (see `src/config/customerFeedbackPublic.js` — `buildCustomerFeedbackFrontDoorUrl`):

`{origin}{base}/customer-feedback/{siteId}?token={customerFeedbackInviteToken}`

Submit feedback with `POST /api/public/sites/{siteId}/customer-feedback` and a JSON body that includes `token` (per `CustomerFeedbackSubmitRequest`).

Do **not** use only `/customer-feedback/{siteId}` without `token` when the API requires an invite.

## Frontend checklist

1. **Resolve `siteId`** for the workflow route (slug → id once, then use id in all API paths).
2. **On load:** `loadAll` hydrates wizard + parallel `GET`s for job-data tables, attendance register, equipment portal, etc.
3. **On autosave / tab change:** prefer **`workflow-batch`** (with fallback). **Save & next:** per-endpoint `PUT`s + wizard. Wait for `200` and `success: true` before clearing “Saving…”.
4. **Equipment month grid:** `buildEquipmentPortalPutBody` sets `availabilityYear` and `availabilityMonth` when persisting day checkboxes.
5. **Challenges:** send `challengeLines` as stripped row DTOs; wizard may also embed challenge data — batch `challengeLines` wins when both are sent.
6. **Feedback step:** call `POST .../feedback-invites` if no token yet; copy link using `customerFeedbackInviteToken` from site or customer-feedback `GET`.
