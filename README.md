# Coren

Attendance portal frontend (`Corem_Frontend-main`), Vite + React.

```bash
cd Corem_Frontend-main
npm install
npm run dev
```

In development, if your API proxy target does not implement `POST /api/public/sites/{id}/customer-feedback`, Vite can answer with a **dev stub** so the public feedback page still reaches a success state (see `VITE_DEV_STUB_PUBLIC_CUSTOMER_FEEDBACK` in `.env.development` and `vite.config.js`). Turn the stub off when your backend exposes that route.

## Render (production)

**Static Site on `*.onrender.com`:** add CDN **rewrite** `/api/*` → your API (see `Corem_Frontend-main/RENDER_DEPLOY.md` and root `render.yaml`). The app calls same-origin `/api` automatically on Render.

**Web Service:** `npm start` proxies `/api` — see `RENDER_DEPLOY.md`.

Optional blueprint: Render → **Blueprints** → `render.yaml`.
