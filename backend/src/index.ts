import 'dotenv/config'
import express, { type Request, type Response, type NextFunction } from 'express'
import { loadConfig, saveSettings, type SettingsUpdate } from './config.ts'
import { bearerAuth, checkToken, extractToken } from './auth.ts'
import { SseHub } from './events.ts'
import { SessionManager } from './sessions/manager.ts'
import { truncateTranscriptForGlasses } from './sessions/store.ts'
import { transcribeHandler } from './transcribe.ts'

// -----------------------------------------------------------------------------
// Entry point. Wires config → manager → SSE hub → HTTP routes.
// -----------------------------------------------------------------------------

// `cfg` is mutable so /api/settings can hot-reload after a save without
// restarting the backend.
let cfg = loadConfig()
const sse = new SseHub()
const manager = new SessionManager(cfg, sse)

const app = express()

// -------- request logger -----------------------------------------------------
// Paths that fire constantly and would drown the signal. We still log them
// on error (≥400) so real problems surface.
const QUIET_PATHS = new Set(['/api/health', '/api/events', '/api/ping'])

app.use((req, res, next) => {
  // Skip preflight noise entirely; it's handled by the CORS middleware below.
  if (req.method === 'OPTIONS') return next()
  const start = Date.now()
  // Capture the full path eagerly — sub-routers rewrite req.path before the
  // finish handler fires, so reading it there would log '/sessions' instead
  // of '/api/sessions'. req.originalUrl includes the query string which we
  // don't want to log (it can contain the bearer token), so strip it.
  const fullPath = (req.originalUrl ?? req.url).split('?')[0]
  res.on('finish', () => {
    const status = res.statusCode
    if (QUIET_PATHS.has(fullPath!) && status < 400) return
    const ms = Date.now() - start
    const ts = new Date().toISOString().slice(11, 19)
    console.log(`${ts} ${req.method.padEnd(6)} ${status} ${ms}ms ${fullPath}`)
  })
  next()
})

// Global CORS. Bearer token is the real auth; CORS is just a browser courtesy.
// We do NOT set Allow-Credentials because we use bearer headers, not cookies.
// Echoing Origin + Vary: Origin handles every WebView we care about without
// leaking wildcards with credentials.
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin)
    res.setHeader('Vary', 'Origin')
  } else {
    res.setHeader('Access-Control-Allow-Origin', '*')
  }
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Accept')
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS')
  res.setHeader('Access-Control-Expose-Headers', 'Content-Type')
  res.setHeader('Access-Control-Max-Age', '86400')
  if (req.method === 'OPTIONS') {
    res.status(204).end()
    return
  }
  next()
})

// -------- public routes (no auth) --------------------------------------------
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'cc-g2-backend' })
})
// Plain-text /api/ping for diagnostics. Some embedded WebViews choke on
// JSON parsing — `pong` is hard to get wrong.
app.get('/api/ping', (_req, res) => {
  res.type('text/plain').send('pong')
})

// -------- authenticated routes below ------------------------------------------
const authed = express.Router()
authed.use(bearerAuth(cfg.token))
authed.use(express.json({ limit: '2mb' }))

authed.get('/config', (_req, res) => {
  res.json({
    projects: cfg.projects.map((p) => ({ name: p.name })),
    defaultProjectName: cfg.defaultProjectName,
  })
})

// -------- settings (read + write) --------------------------------------------
authed.get('/settings', (_req, res) => {
  res.json({
    permissionMode: cfg.permissionMode,
    model: cfg.model,
    defaultProjectName: cfg.defaultProjectName,
    projects: cfg.projects.map((p) => ({ name: p.name })),
  })
})

authed.post('/settings', (req, res) => {
  const body = req.body as SettingsUpdate
  try {
    cfg = saveSettings(cfg, body)
    manager.applyConfig(cfg)
    res.json({
      ok: true,
      permissionMode: cfg.permissionMode,
      model: cfg.model,
      defaultProjectName: cfg.defaultProjectName,
    })
  } catch (err) {
    console.error('[settings] save failed:', err)
    res.status(400).json({ error: (err as Error).message })
  }
})

authed.get('/sessions', (_req, res) => {
  res.json({ sessions: manager.list() })
})

authed.get('/sessions/:id', (req, res) => {
  const s = manager.get(req.params.id!)
  if (!s) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  res.json({
    session: {
      id: s.id,
      title: s.title,
      projectName: s.projectName,
      cwd: s.cwd,
      createdAt: s.createdAt,
      lastActiveAt: s.lastActiveAt,
      transcript: truncateTranscriptForGlasses(s.transcript, 80),
    },
  })
})

authed.post('/sessions', (req, res) => {
  const body = req.body as { projectName?: string; firstPrompt?: string; model?: string }
  const projectName = String(body.projectName ?? '').trim()
  const firstPrompt = String(body.firstPrompt ?? '').trim()
  if (!projectName || !firstPrompt) {
    res.status(400).json({ error: 'projectName and firstPrompt required' })
    return
  }
  try {
    const session = manager.create({
      projectName,
      firstPrompt,
      model: body.model,
    })
    res.json({ session: { id: session.id, title: session.title, projectName: session.projectName, createdAt: session.createdAt, lastActiveAt: session.lastActiveAt } })
  } catch (err) {
    console.error('[sessions] create failed:', err)
    res.status(400).json({ error: (err as Error).message })
  }
})

authed.post('/sessions/:id/turn', (req, res) => {
  const body = req.body as { text?: string }
  const text = String(body.text ?? '').trim()
  if (!text) {
    res.status(400).json({ error: 'text required' })
    return
  }
  try {
    manager.send(req.params.id!, text)
    res.json({ ok: true })
  } catch (err) {
    console.error('[sessions] turn failed:', err)
    res.status(400).json({ error: (err as Error).message })
  }
})

authed.delete('/sessions/:id', (req, res) => {
  const ok = manager.delete(req.params.id!)
  if (!ok) {
    res.status(404).json({ error: 'not_found' })
    return
  }
  res.json({ ok: true })
})

// Transcribe uses raw-body middleware instead of json.
authed.post(
  '/transcribe',
  express.raw({ type: '*/*', limit: '15mb' }),
  transcribeHandler,
)

app.use('/api', authed)

// -------- SSE endpoint (token via query param; EventSource can't set headers) -
app.get('/api/events', (req: Request, res: Response, _next: NextFunction) => {
  const token = extractToken(req)
  if (!checkToken(cfg.token, token)) {
    res.status(401).end('unauthorized')
    return
  }
  const sessionId = String(req.query.sessionId ?? '*')
  const channel = sessionId === '*' ? '*' : `session:${sessionId}`
  sse.subscribe(channel, res)
})

// -------- catch-all 404 --------------------------------------------------------
app.use((req, res) => {
  res.status(404).json({ error: 'not_found', path: req.path })
})

const PORT = Number(process.env.PORT ?? 8787)
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`cc-g2-backend listening on http://0.0.0.0:${PORT}`)
})

// -------- graceful shutdown ---------------------------------------------------
function shutdown() {
  console.log('\n[shutdown] saving state and killing child CLIs...')
  manager.shutdown()
  sse.close()
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
