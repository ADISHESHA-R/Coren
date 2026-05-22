/**
 * Production server for Render (Web Service): serve Vite `dist/` and proxy `/api` → real backend.
 * Browser stays same-origin → no CORS. Set API_PROXY_TARGET to your API base URL (no trailing slash).
 */
import express from 'express'
import { createProxyMiddleware } from 'http-proxy-middleware'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.join(__dirname, '..')
const dist = path.join(root, 'dist')

const PORT = Number(process.env.PORT) || 10000
const API_TARGET = (process.env.API_PROXY_TARGET || 'https://backendclientapi.onrender.com').replace(/\/$/, '')

if (!fs.existsSync(dist)) {
  console.error('Missing dist/. Run npm run build before npm start.')
  process.exit(1)
}

const app = express()

app.get('/healthz', (_req, res) => {
  res.status(200).type('text').send('ok')
})

app.use(
  '/api',
  createProxyMiddleware({
    target: API_TARGET,
    changeOrigin: true,
    secure: true,
    logLevel: 'warn',
  }),
)

app.use(express.static(dist, { index: false }))

app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next()
  if (req.path.startsWith('/api')) return next()
  res.sendFile(path.join(dist, 'index.html'), (err) => {
    if (err) next(err)
  })
})

app.listen(PORT, () => {
  console.log(`[render-serve] http://0.0.0.0:${PORT}  static:${dist}  proxy /api -> ${API_TARGET}`)
})
