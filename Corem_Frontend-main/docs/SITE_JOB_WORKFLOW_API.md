# Site job workflow — backend APIs and frontend integration

Base path (admin, JWT required): `/api/admin/sites/{siteId}`  
Replace `{siteId}` with the numeric site id (e.g. `1`). The SPA resolves slugs such as `bangalore-blr001` via `GET /api/admin/sites` (or your slug route) before calling these APIs.

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
