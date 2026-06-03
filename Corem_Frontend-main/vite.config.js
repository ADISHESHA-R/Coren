import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * Backend origin for dev/preview proxy (browser calls same-origin `/api`, Vite forwards here — no CORS).
 * Default matches the deployed API (`apiBaseUrl.js` PRODUCTION_DEFAULT). For a local backend, set
 * `VITE_API_PROXY_TARGET=http://127.0.0.1:8080` in `.env` / `.env.local`, then restart Vite.
 */
const DEFAULT_API_PROXY_TARGET = 'https://backendclientapi.onrender.com'

function resolveApiProxyTarget(env) {
  const fromEnv = (env.VITE_API_PROXY_TARGET || env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '')
  return fromEnv || DEFAULT_API_PROXY_TARGET
}

function apiProxy(env) {
  const target = resolveApiProxyTarget(env)
  return {
    '/api': {
      target,
      changeOrigin: true,
      secure: true,
    },
  }
}

/**
 * When the proxied API has no POST /api/public/sites/{id}/customer-feedback (Spring "No static resource"),
 * respond locally so the public feedback page can be tested. Disable when your backend implements the route.
 */
function publicCustomerFeedbackDevStubPlugin(mode, env) {
  const enabled =
    mode === 'development' &&
    (env.VITE_DEV_STUB_PUBLIC_CUSTOMER_FEEDBACK === 'true' || env.VITE_DEV_STUB_PUBLIC_CUSTOMER_FEEDBACK === '1')

  return {
    name: 'corem-public-customer-feedback-dev-stub',
    enforce: 'pre',
    configureServer(server) {
      if (!enabled) return

      const handler = (req, res, next) => {
        if (req.method !== 'POST') return next()
        const pathOnly = (req.url || '').split('?')[0]
        if (!/^\/api\/public\/sites\/[^/]+\/customer-feedback\/?$/.test(pathOnly)) return next()

        const chunks = []
        req.on('data', (c) => chunks.push(c))
        req.on('end', () => {
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(
            JSON.stringify({
              success: true,
              stub: true,
              message:
                'Development stub: nothing was saved. Your API proxy target has no public customer-feedback route yet. Set VITE_DEV_STUB_PUBLIC_CUSTOMER_FEEDBACK=false and implement POST /api/public/sites/{siteId}/customer-feedback on the backend (or point VITE_API_PROXY_TARGET at an API that already has it).',
            }),
          )
        })
      }

      const stack = server.middlewares.stack
      if (Array.isArray(stack)) {
        stack.unshift({ route: '', handle: handler })
      } else {
        server.middlewares.use(handler)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxy = apiProxy(env)

  return {
    server: {
      port: 5173,
      /** Do not fall back to 5174+ — this project is expected on 5173 for local docs and bookmarks. */
      strictPort: true,
      proxy,
    },
    /** `npm run preview` uses this server — mirror dev proxy so `/api` still works without CORS. */
    preview: {
      proxy,
    },
    plugins: [
      publicCustomerFeedbackDevStubPlugin(mode, env),
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        /** Avoid registering a service worker during `npm run dev` — a bad SW cache often shows as a blank white page on localhost. */
        devOptions: {
          enabled: false,
        },
        /** Precache public assets used by the manifest / install UI (APK wrappers read built manifest + SW). */
        includeAssets: ['pwa-icon.jpg'],
        manifest: {
          name: 'Attendance App',
          short_name: 'Attendance App',
          description: 'Corem — secure attendance for employees and administrators.',
          theme_color: '#0d6efd',
          background_color: '#f8fafc',
          display: 'standalone',
          orientation: 'portrait-primary',
          start_url: '/',
          scope: '/',
          /** Same as start_url base; use a new install if the old “Camera App” build is still cached. */
          id: '/',
          lang: 'en',
          icons: [
            {
              src: '/pwa-icon.jpg',
              sizes: '192x192',
              type: 'image/jpeg',
              purpose: 'any',
            },
            {
              src: '/pwa-icon.jpg',
              sizes: '512x512',
              type: 'image/jpeg',
              purpose: 'any',
            },
            {
              src: '/pwa-icon.jpg',
              sizes: '512x512',
              type: 'image/jpeg',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,woff2}'],
          /** New cache name so old precached bundles are dropped after deploy. */
          cacheId: 'corem-pwa-v3',
          /** SPA shell only for real navigations; never treat /api as the app shell. */
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\b/],
        },
      }),
    ],
  }
})
