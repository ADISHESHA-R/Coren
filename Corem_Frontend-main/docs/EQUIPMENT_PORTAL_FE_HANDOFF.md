# Equipment portal — frontend integration (one-shot handoff)

Use the same admin auth as other site job-data APIs: `Authorization: Bearer <JWT>` (or your app’s token type + access token). Base URL: `API_BASE_URL` / `VITE_*` env you already use for `/api/admin/sites/...`.

**Not** the tools missing/damage screen: that stays `.../job-data/tool-issues`. Equipment availability grid is **only** `.../job-data/equipment-portal` (+ `.../equipment-portal/layout` for drag-and-drop).

---

## Response wrapper (all endpoints)

```json
{
  "success": true,
  "message": "Success",
  "data": {}
}
```

- Read portal payload from **`response.data.data`** (inner `data` is the portal object below).
- After **PUT** `equipment-portal`, `message` is often `"Equipment portal saved"`; **`data`** is again the full portal (same shape as GET).

Errors: `success: false`, HTTP non-2xx — show `message`.

---

## 1) GET — load grid (+ optional month checkboxes)

**`GET /api/admin/sites/{siteId}/job-data/equipment-portal`**

Optional query (use **both** or **neither**):

- `year` — e.g. `2026`
- `month` — `1`–`12`

Examples:

- With month:  
  `{baseUrl}/api/admin/sites/123/job-data/equipment-portal?year=2026&month=5`
- Structure only (no month ticks / null context):  
  `{baseUrl}/api/admin/sites/123/job-data/equipment-portal`

**`data`** (portal payload — no extra nesting):

```json
{
  "year": 2026,
  "month": 5,
  "categories": [
    {
      "id": 1,
      "title": "A. MEASURING INSTRUMENTS",
      "sortOrder": 0,
      "items": [
        {
          "id": 101,
          "lineOrder": 0,
          "itemDescription": "Dial Gauge with Magnetic Base",
          "uom": "Nos",
          "qty": "1",
          "dateNote": null,
          "dayPresent": {
            "1": true,
            "2": true
          }
        },
        {
          "id": 102,
          "lineOrder": 1,
          "itemDescription": "Vernier Caliper - 300mm",
          "uom": "Each",
          "qty": "2",
          "dateNote": "22.09.24",
          "dayPresent": {}
        }
      ]
    },
    {
      "id": 2,
      "title": "B. DRILLING MACHINE TOOLS",
      "sortOrder": 1,
      "items": []
    }
  ]
}
```

**GET notes**

- If `year` + `month` are **omitted**, `data.year` / `data.month` may be **`null`**, and each item’s `dayPresent` may be **`{}`** or omitted — treat as “no month loaded for ticks.”
- **`dayPresent`** keys are **strings** `"1"` … `"31"` (day of month). Only entries with **`true`** need to exist when round-tripping a month; missing day ⇒ not present.

---

## 2) PUT — save full tree (authoritative items)

**`PUT /api/admin/sites/{siteId}/job-data/equipment-portal`**  
`Content-Type: application/json`

Root body keys:

| Key | Required | Meaning |
|-----|----------|--------|
| `categories` | **Yes** | Full list of categories and items (see below). |
| `availabilityYear` | Optional | Must appear **together** with `availabilityMonth` or **both omitted**. |
| `availabilityMonth` | Optional | `1`–`12`. Same pairing rule as GET. |

**Authoritative rule:** Any existing equipment **item** for this site that is **not** included somewhere under `categories[].items[]` in this body is **deleted** (and its availability). To only change text fields without deleting rows, **re-send the full tree** you got from GET, then apply edits.

**Category row**

```json
{
  "id": 1,
  "title": "A. MEASURING INSTRUMENTS",
  "sortOrder": 0,
  "items": []
}
```

- `id: null` — create a new category (server assigns id).
- Keep server `id` for categories you retain.

**Item row**

```json
{
  "id": 101,
  "lineOrder": 0,
  "itemDescription": "Dial Gauge with Magnetic Base",
  "uom": "Nos",
  "qty": "1",
  "dateNote": null,
  "dayPresent": {
    "1": true,
    "2": true,
    "3": false
  }
}
```

- `id: null` — create a new item.
- `lineOrder` — optional in contract; send sensible order (0, 1, 2, …) per category.

### When `availabilityYear` **and** `availabilityMonth` are both set

For each **item**:

| `dayPresent` | Effect for that item |
|----------------|----------------------|
| **`null`** | **Do not change** stored month cells for that item (skip month patch for this row). |
| **Object** | **Replace** that item’s calendar month: only keys with **`true`** store “present”; **`false`** or omitted keys ⇒ not present / remove that day for the month. |

Example: update May 2026 for some rows; one row skips month; one new row gets day 5 only.

```json
{
  "availabilityYear": 2026,
  "availabilityMonth": 5,
  "categories": [
    {
      "id": 1,
      "title": "A. MEASURING INSTRUMENTS",
      "sortOrder": 0,
      "items": [
        {
          "id": 101,
          "lineOrder": 0,
          "itemDescription": "Dial Gauge with Magnetic Base",
          "uom": "Nos",
          "qty": "1",
          "dateNote": null,
          "dayPresent": {
            "1": true,
            "2": true,
            "3": false
          }
        },
        {
          "id": null,
          "lineOrder": 1,
          "itemDescription": "New row from UI",
          "uom": "Set",
          "qty": "1",
          "dateNote": null,
          "dayPresent": {
            "5": true
          }
        }
      ]
    },
    {
      "id": 2,
      "title": "B. DRILLING MACHINE TOOLS",
      "sortOrder": 1,
      "items": [
        {
          "id": 103,
          "lineOrder": 0,
          "itemDescription": "Example tool moved here after category edit",
          "uom": "Nos",
          "qty": "1",
          "dateNote": null,
          "dayPresent": null
        }
      ]
    }
  ]
}
```

### When **both** `availabilityYear` and `availabilityMonth` are **omitted**

Use for **structure-only** saves (titles, UOM, qty, `dateNote`, reorder within payload, add/remove rows) **without** interpreting `dayPresent` as a month replace — align with backend: typically **omit** `dayPresent` on items or send only what your backend documents for this mode.

### Clear all equipment data for the site

```json
{
  "categories": []
}
```

---

## 3) PUT — drag-and-drop only (reorder + move across categories)

**`PUT /api/admin/sites/{siteId}/job-data/equipment-portal/layout`**  
`Content-Type: application/json`

Every **item id** for the site must appear **exactly once** across all `itemIds` arrays.

```json
{
  "categories": [
    { "categoryId": 1, "itemIds": [101, 102] },
    { "categoryId": 2, "itemIds": [103] }
  ]
}
```

**Response `data`:** same portal type as GET; **`year` / `month` are often `null`** unless your product does a follow-up GET with query params.

**FE flow:** on drag end → call **layout** PUT → replace local portal state from **`data`**. Do **not** send the full `equipment-portal` PUT unless you are also doing an authoritative data save.

---

## TypeScript types (optional — project is `.jsx`; use as JSDoc or paste into `.d.ts`)

```ts
type DayPresent = Record<string, boolean>; // keys "1".."31"

type EquipmentItem = {
  id: number | null;
  lineOrder: number | null;
  itemDescription: string | null;
  uom: string | null;
  qty: string | null;
  dateNote: string | null;
  /** GET: map of present days. PUT with year+month: null = skip month update; object = replace month. */
  dayPresent: DayPresent | null;
};

type EquipmentCategory = {
  id: number | null;
  title: string;
  sortOrder: number | null;
  items: EquipmentItem[];
};

type EquipmentPortalPayload = {
  year: number | null;
  month: number | null;
  categories: EquipmentCategory[];
};

type ApiResponse<T> = { success: boolean; message: string; data: T };
```

---

## Implementation checklist (one pass)

1. **Load:** GET with selected `year` & `month` when the user picks a month for day columns; otherwise GET without query for structure-only.
2. **State:** Hold `EquipmentPortalPayload` (or equivalent) in React state; derive “Days 01–15” / “16–31” columns from `year`+`month` + `dayPresent`.
3. **Edit rows / categories:** Mutate local state; on **Save** → **PUT** `equipment-portal` with full `categories` tree; include `availabilityYear`/`availabilityMonth` when saving checkboxes; use `dayPresent: null` on rows that must not touch stored month cells.
4. **Drag-and-drop:** **PUT** `equipment-portal/layout` only; merge response `data` into state.
5. **Deletes:** Removing a row locally means it is **absent** from the next full PUT — server deletes it. Confirm UX (destructive).
6. **Postman:** If `Attendance-System.postman_collection.json` exists in your branch, it should list **GET Equipment portal**, **PUT Equipment portal**, **PUT Equipment portal layout** — use the same paths and bodies as above.

---

## This repo (`AdminSiteJobWorkflow.jsx`)

Step **“Tools checklist (by category)”** loads **`GET …/equipment-portal?year=&month=`** (month from Project introduction **Tools checklist month** YYYY-MM, else current month), edits local state, saves the full grid with **`PUT …/equipment-portal`** when the user clicks **Save & next** on that step, and saves **reorder / cross-category moves** with **`PUT …/equipment-portal/layout`** after drag-and-drop when every category and item already has a numeric id (after at least one successful full save). The wizard still stores `toolChecklist` for backward compatibility but that step’s grid is driven by the equipment portal API.

---

## Branch / backend reference (adjust for your repo)

Example: ProjectC → `dev`, commit `edc0e82` or “latest `dev` after equipment portal merge.”
