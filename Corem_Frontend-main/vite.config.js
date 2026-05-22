import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    proxy: {
      "/api": {
        target: "https://backendclientapi.onrender.com",
        changeOrigin: true,
        secure: true,
      },
    },
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
      },
    })
  ]
})