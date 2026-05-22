/**
 * API origin (cross-origin to Render in production when the SPA is on another host).
 *
 * Default production base: https://backendclientapi.onrender.com
 *
 * **Avoid CORS during local dev / LAN testing**
 * - Use relative base `""` so requests go to `http(s)://<your-host>:port/api/...` (same origin as Vite).
 * - `vite.config.js` proxies `/api` → real backend (`VITE_API_PROXY_TARGET` or default).
 *
 * Override in `.env` / `.env.development` / `.env.production`:
 *   VITE_API_BASE_URL=https://your-api.example.com   (browser calls API directly; backend must send CORS headers)
 * Force same-origin + proxy in dev even when other vars are set:
 *   VITE_API_BASE_URL=
 *
 * **Deployed SPA** (Netlify, S3, etc.): set `VITE_API_BASE_URL` at build time to your API origin, and configure
 * the API server to allow `Access-Control-Allow-Origin` for your frontend origin (or use a reverse proxy so both are same-origin).
 *
 * **Render Web Service** (this repo’s `npm start` server): set at build time `VITE_SAME_ORIGIN_API=true` so the
 * bundle calls `/api/...` on the same host; `server/render-serve.mjs` proxies to `API_PROXY_TARGET` (no browser CORS).
 */
const PRODUCTION_DEFAULT = 'https://backendclientapi.onrender.com'

/** True for localhost and typical LAN dev hosts (phone testing same Wi‑Fi). */
function isSameOriginDevHostname(hostname) {
  if (!hostname || typeof hostname !== 'string') return false
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]') return true
  // RFC1918 private — use empty API base + Vite proxy for `vite preview` on LAN, etc.
  if (/^192\.168\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  if (/^10\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)) return true
  const m = hostname.match(/^172\.(\d{1,3})\./)
  if (m) {
    const second = Number(m[1])
    if (second >= 16 && second <= 31) return true
  }
  return false
}

function resolveApiBaseUrl() {
  const raw = import.meta.env.VITE_API_BASE_URL
  const explicit = typeof raw === 'string' ? raw.trim() : undefined

  if (explicit === '') return ''
  if (explicit != null && explicit !== '') return explicit.replace(/\/$/, '')

  if (typeof window !== 'undefined') {
    const h = window.location.hostname
    if (isSameOriginDevHostname(h)) return ''
  }

  // `vite dev` — always same-origin + proxy regardless of hostname (tunnel, custom hosts).
  if (import.meta.env.DEV) return ''

  // Production build served behind our Node proxy (Render Web Service) — same-origin `/api`.
  if (import.meta.env.VITE_SAME_ORIGIN_API === 'true' || import.meta.env.VITE_SAME_ORIGIN_API === '1') {
    return ''
  }

  return PRODUCTION_DEFAULT
}

export const API_BASE_URL = resolveApiBaseUrl()
