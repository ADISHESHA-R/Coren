import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

/** Backend origin for dev/preview proxy (browser calls same-origin `/api`, Vite forwards here — no CORS). */
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxy = apiProxy(env)

  return {
    server: {
      proxy,
    },
    /** `npm run preview` uses this server — mirror dev proxy so `/api` still works without CORS. */
    preview: {
      proxy,
    },
    plugins: [
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
