# Coren

Attendance portal frontend (`Corem_Frontend-main`), Vite + React.

```bash
cd Corem_Frontend-main
npm install
npm run dev
```

## Render (production)

**Static Site** + separate API → browser CORS unless the API is configured for your frontend origin.

**Recommended:** deploy as a **Web Service** with `npm start` (see `Corem_Frontend-main/RENDER_DEPLOY.md` or root `render.yaml`). Optional blueprint: Render → **Blueprints** → connect repo and apply `render.yaml`.
