# Coren

Attendance portal frontend (`Corem_Frontend-main`), Vite + React.

```bash
cd Corem_Frontend-main
npm install
npm run dev
```

## Render (production)

**Static Site on `*.onrender.com`:** add CDN **rewrite** `/api/*` → your API (see `Corem_Frontend-main/RENDER_DEPLOY.md` and root `render.yaml`). The app calls same-origin `/api` automatically on Render.

**Web Service:** `npm start` proxies `/api` — see `RENDER_DEPLOY.md`.

Optional blueprint: Render → **Blueprints** → `render.yaml`.
