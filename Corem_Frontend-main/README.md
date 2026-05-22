# React + Vite

## API and CORS

- **Local dev (`npm run dev`)** and **`npm run preview`**: keep `VITE_API_BASE_URL` unset. The app calls same-origin `/api/...`; Vite proxies those requests to the real backend (see `vite.config.js` and `VITE_API_PROXY_TARGET` in `.env.example`). That avoids browser CORS during development, including when you open the app via a LAN IP (e.g. from a phone).
- **Production build** on a host different from the API: set `VITE_API_BASE_URL` at build time to your API origin. Your backend must return appropriate `Access-Control-Allow-*` headers for that frontend origin, **or** put both behind one reverse proxy so the browser sees a single origin.

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
