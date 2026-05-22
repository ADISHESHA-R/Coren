# Deploy on Render (fix CORS for `https://your-app.onrender.com`)

A **Static Site** serves only files; the browser then calls `https://backend…/api/...` cross-origin → **CORS** unless the API allows your frontend origin.

This app can run as a **Web Service** instead: Node serves `dist/` and **proxies** `/api` to the real API. The browser only talks to your app origin → **no CORS**.

## Steps

1. In Render, create a **New → Web Service** (not Static Site), connect repo `ADISHESHA-R/Coren`.
2. **Root Directory:** `Corem_Frontend-main`
3. **Build Command:** `npm install && npm run build`
4. **Start Command:** `npm start`
5. **Health check path:** `/healthz`

### Environment variables (same group for build + runtime on Render)

| Key | Value |
|-----|--------|
| `NODE_VERSION` | `22` |
| `VITE_SAME_ORIGIN_API` | `true` |
| `API_PROXY_TARGET` | Your API base, e.g. `https://backendclientapi.onrender.com` (no trailing slash) |

`VITE_SAME_ORIGIN_API` must be present at **build** time so the bundle uses relative `/api` URLs. Render exposes service env vars during build by default.

6. **Remove or stop** the old **Static Site** for this app if you had one, so you do not maintain two deployments.

7. After deploy, open the Web Service URL and try login again.

### If you insist on staying on Static Site only

You must configure the **backend** to send CORS headers for `https://coren-y0us.onrender.com` and allow `OPTIONS` preflight (often `403` means Spring Security / WAF blocked `OPTIONS` before CORS ran).
