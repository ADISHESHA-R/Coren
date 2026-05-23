# Deploy on Render (fix CORS)

Your browser blocks **cross-origin** calls when the SPA is on `https://*.onrender.com` and the API is on another host (unless the API sends CORS headers). This repo fixes that in two supported ways.

---

## Option A — **Static Site** (what you have now) + **CDN rewrite** (recommended if you stay on Static)

The frontend now calls **same-origin** `/api/...` when hosted on `*.onrender.com`. Render’s CDN must **rewrite** those requests to your real API (browser URL stays yours → **no CORS**).

### A1. Add rules in the Render Dashboard (fastest)

1. Open your **Static Site** → **Redirects / Rewrites** (or **Routes**).
2. Add **rewrite** (not redirect), **first** in the list:
   - **Source:** `/api/*`
   - **Destination:** `https://backendclientapi.onrender.com/api/*`
   - **Action:** Rewrite  
   (If your API base is different, change the destination host only.)
3. Add **SPA fallback** **after** the `/api` rule:
   - **Source:** `/*`
   - **Destination:** `/index.html`
   - **Action:** Rewrite
4. Save, wait for the change to apply, then **clear cache / hard refresh** and try login again.

### A2. Or use the repo `render.yaml` (Blueprint)

Root `render.yaml` defines the same static site + routes. In Render: **Blueprints** → connect this repo → sync (or create a new Blueprint).  
If you already have a static site with the same name, rename the service in `render.yaml` or merge routes manually to avoid duplicates.

### A3. Redeploy the frontend

Push the latest `main` and trigger a **new deploy** so the bundle includes the `*.onrender.com` → relative `/api` behavior.

---

## Option B — **Web Service** (`npm start`)

Node serves `dist/` and proxies `/api` to the API. No CDN rewrite needed.

1. **New → Web Service** → repo **Coren**.
2. **Root Directory:** `Corem_Frontend-main`
3. **Build:** `npm install && npm run build`
4. **Start:** `npm start`
5. **Health check:** `/healthz`
6. Env (available at **build** time too):

| Key | Value |
|-----|--------|
| `NODE_VERSION` | `22` |
| `VITE_SAME_ORIGIN_API` | `true` |
| `API_PROXY_TARGET` | `https://backendclientapi.onrender.com` |

Use the **Web Service URL** (or point your domain to it). Turn off the old Static Site if you migrate here.

---

## If you still see errors

- **CORS** on `login`: the request is still going to the **API host** in the Network tab → rebuild/deploy the frontend, or you still have `VITE_API_BASE_URL` set to the full API URL in Render **build** env (remove it for Option A).
- **404** on `/api/...`: the **CDN rewrite** is missing or wrong — fix Option A1 routes.
- **403** on **preflight** to the API host only: fix **backend** CORS / `OPTIONS` (Option A should avoid the browser calling the API host at all).
- **HTTP 200 + empty body** on `/api/auth/.../login` (content-length 0): the response is **not** your API JSON — usually **Render `/api` rewrite not applied to POST** or an edge returns an empty body. Re-check rewrite order and destination `https://<your-api-host>/api/*`. Or use **Option B (Web Service)** so Node proxies POST correctly.
