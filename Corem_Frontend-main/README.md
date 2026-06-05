# React + Vite

## API and CORS

- **Local dev (`npm run dev`)** and **`npm run preview`**: keep `VITE_API_BASE_URL` unset. The app calls same-origin `/api/...`; Vite proxies those requests to your backend (default **`https://backendclientapi.onrender.com`** in `vite.config.js`, matching production). To hit a **local** API instead, set `VITE_API_PROXY_TARGET=http://127.0.0.1:8080` in `.env` / `.env.local` and restart Vite. That avoids browser CORS during development, including when you open the app via a LAN IP (e.g. from a phone).
- **Admin URLs**: signed-in admins use **`/admin/...`** paths (e.g. `/admin/dashboard`, `/admin/sites`, `/admin/sites/bangalore-blr001/site-job-workflow?step=6`). The host is always your frontend origin (`localhost:5173` locally, your Render static site URL in production); only the path changes. Deployed static sites must keep the SPA fallback `/* → /index.html` **after** the `/api/*` rewrite (see root `render.yaml`).
- **Public customer feedback**: **`/customer-feedback/{siteId}`** (optional **?token=** for legacy invite links). On load the SPA calls **`GET /api/public/sites/{siteId}/customer-feedback`** (no JWT) to read context (`jobCode`, `customerName`, `certificateClientStatus`, `expired`, `revoked`, …). Unknown or inactive sites → **404** → generic “not available” copy. **Submit** uses **`POST`** to the same path; **`token`** is omitted from the JSON when there is no **?token=** in the URL. Set **`VITE_PUBLIC_CUSTOMER_FEEDBACK_TOKEN_REQUIRED=true`** if you still require a token in the URL before showing the form. Body shape: **`feedbackJson`** (default) vs **`VITE_PUBLIC_CUSTOMER_FEEDBACK_BODY_MODE=flat`**. Configure **`VITE_PUBLIC_CUSTOMER_FEEDBACK_POST_URL_TEMPLATE`** if the path differs (see `.env.example`). Admin “Copy link” prefers the same slug/job-code style segment as the workflow route when possible.
- **Production build** on a host different from the API: set `VITE_API_BASE_URL` at build time to your API origin. Your backend must return appropriate `Access-Control-Allow-*` headers for that frontend origin, **or** put both behind one reverse proxy so the browser sees a single origin.

## Equipment portal (admin site job-data)

Handoff for **GET/PUT** `/api/admin/sites/{siteId}/job-data/equipment-portal` and **PUT** `.../equipment-portal/layout` (JSON shapes, month checkbox rules, layout vs full save): [docs/EQUIPMENT_PORTAL_FE_HANDOFF.md](docs/EQUIPMENT_PORTAL_FE_HANDOFF.md).

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
