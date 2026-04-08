import { useEffect, useState } from 'react'
import { Card, Button, Input, StatusDot } from 'even-toolkit/web'
import { storageGet, storageSet, storageRemove } from 'even-toolkit/storage'
import { store, useAppState } from '../store'
import { bootstrap, checkHealth, deleteSession } from '../api'

// Storage keys go through even-toolkit/storage so we work both in a plain
// browser (localStorage) and inside the glasses WebView (bridge storage).
const LS_URL = 'cc-g2.backendUrl'
const LS_TOK = 'cc-g2.token'

// Wrap storage in try/catch: sandboxed WebViews and some browser extensions
// throw "Access to storage is not allowed from this context". We still want
// the app to boot in that case — credentials just won't persist across reloads.
async function safeGet(key: string): Promise<string> {
  try {
    return await storageGet<string>(key, '')
  } catch (err) {
    console.warn('[storage] read failed:', err)
    return ''
  }
}
async function safeSet(key: string, value: string): Promise<void> {
  try {
    await storageSet(key, value)
  } catch (err) {
    console.warn('[storage] write failed:', err)
  }
}
async function safeRemove(key: string): Promise<void> {
  try {
    await storageRemove(key)
  } catch (err) {
    console.warn('[storage] remove failed:', err)
  }
}

function maskToken(tok: string | null): string {
  if (!tok) return ''
  if (tok.length <= 10) return tok
  return tok.slice(0, 4) + '…' + tok.slice(-4)
}

interface DiagnoseResult {
  url: string
  ok: boolean
  status?: number
  bodySnippet?: string
  error?: string
  timeMs: number
}

async function runDiagnose(backendUrl: string): Promise<DiagnoseResult> {
  const target = backendUrl.replace(/\/$/, '') + '/api/health'
  const start = Date.now()
  try {
    const res = await fetch(target, { method: 'GET' })
    const body = await res.text().catch(() => '')
    return {
      url: target,
      ok: res.ok,
      status: res.status,
      bodySnippet: body.slice(0, 120),
      timeMs: Date.now() - start,
    }
  } catch (err) {
    return {
      url: target,
      ok: false,
      error: (err as Error).message || String(err),
      timeMs: Date.now() - start,
    }
  }
}

export function Connect() {
  const state = useAppState()
  const [urlInput, setUrlInput] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [diagnose, setDiagnose] = useState<DiagnoseResult | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    void (async () => {
      // Query-string handoff: ./dev.sh puts ?backend=<tunnel>&token=<bearer>
      // into the QR code so a single scan pre-fills both fields. The backend
      // value is URL-encoded by dev.sh, so URLSearchParams.get decodes it.
      const params = new URLSearchParams(window.location.search)
      const qsUrl = params.get('backend')
      const qsTok = params.get('token')
      if (qsUrl && qsTok) {
        setUrlInput(qsUrl)
        setTokenInput(qsTok)
        await Promise.all([safeSet(LS_URL, qsUrl), safeSet(LS_TOK, qsTok)])
        store.setCredentials(qsUrl, qsTok)
        window.history.replaceState({}, '', window.location.pathname)
        await checkAndBoot(qsUrl, qsTok)
        return
      }
      const [savedUrl, savedTok] = await Promise.all([
        safeGet(LS_URL),
        safeGet(LS_TOK),
      ])
      if (savedUrl) setUrlInput(savedUrl)
      if (savedTok) setTokenInput(savedTok)
      if (savedUrl && savedTok) {
        store.setCredentials(savedUrl, savedTok)
        await checkAndBoot(savedUrl, savedTok)
      }
    })()
    // One-shot hydrate; intentionally empty deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkAndBoot(url: string, token: string) {
    const result = await checkHealth(url, token)
    if (result.ok) {
      store.setConnection('ok')
      await bootstrap()
    } else {
      store.setConnection('error', result.reason ?? 'health check failed')
    }
  }

  async function onSave() {
    const url = urlInput.trim().replace(/\/$/, '')
    const token = tokenInput.trim()
    if (!url || !token) return
    setSaving(true)
    try {
      await Promise.all([safeSet(LS_URL, url), safeSet(LS_TOK, token)])
      store.setCredentials(url, token)
      await checkAndBoot(url, token)
    } finally {
      setSaving(false)
    }
  }

  async function onLogout() {
    await Promise.all([safeRemove(LS_URL), safeRemove(LS_TOK)])
    store.clearCredentials()
    setUrlInput('')
    setTokenInput('')
    setDiagnose(null)
  }

  async function onDiagnose() {
    const url = (urlInput || state.backendUrl || '').trim()
    if (!url) return
    setDiagnose(null)
    const r = await runDiagnose(url)
    setDiagnose(r)
  }

  async function onCopyBackend() {
    const url = state.backendUrl ?? urlInput
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable */
    }
  }

  async function onDeleteSession(id: string) {
    try {
      await deleteSession(id)
      store.deleteSession(id)
    } catch (err) {
      console.error(err)
    }
  }

  const configured = Boolean(state.backendUrl && state.token)
  const connected = state.connection === 'ok'

  return (
    <div className="px-3 pt-4 pb-8 space-y-4">
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-large-title">Claude Code G2</h2>
          <StatusDot connected={connected} />
        </div>
        <p className="text-normal-body text-text-dim">
          Paste the backend URL and bearer token printed by the Mac Mini.
        </p>

        {configured ? (
          <div className="rounded bg-surface p-2 text-normal-detail text-text-dim space-y-1">
            <div className="truncate">
              <span className="text-text">backend</span> {state.backendUrl}
            </div>
            <div>
              <span className="text-text">token</span> {maskToken(state.token)}
            </div>
          </div>
        ) : null}

        <div className="space-y-2">
          <label className="text-normal-subtitle">Backend URL</label>
          <Input
            type="url"
            placeholder="https://abc123.trycloudflare.com"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <label className="text-normal-subtitle">Bearer Token</label>
          <Input
            type="password"
            placeholder="..."
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={onSave} disabled={saving || !urlInput || !tokenInput}>
            {configured ? 'Reconnect' : 'Connect'}
          </Button>
          <Button variant="ghost" onClick={() => void onDiagnose()} disabled={!urlInput && !state.backendUrl}>
            Diagnose
          </Button>
          {configured ? (
            <>
              <Button variant="ghost" onClick={() => void onCopyBackend()}>
                {copied ? 'Copied!' : 'Copy URL'}
              </Button>
              <Button variant="ghost" onClick={() => void onLogout()}>Logout</Button>
            </>
          ) : null}
        </div>

        {state.connectionError ? (
          <div className="rounded bg-negative/10 p-2">
            <div className="text-normal-subtitle text-negative">Connection error</div>
            <div className="text-normal-detail text-negative break-words">{state.connectionError}</div>
          </div>
        ) : null}

        {diagnose ? (
          <div className="rounded bg-surface p-2 space-y-1 text-normal-detail">
            <div className="text-normal-subtitle">Diagnose</div>
            <div className="break-words text-text-dim">GET {diagnose.url}</div>
            {diagnose.ok ? (
              <div className="text-positive">
                ✓ HTTP {diagnose.status} · {diagnose.timeMs}ms
              </div>
            ) : (
              <div className="text-negative break-words">
                ✗ {diagnose.error ?? `HTTP ${diagnose.status}`} · {diagnose.timeMs}ms
              </div>
            )}
            {diagnose.bodySnippet ? (
              <div className="break-words text-text-dim">body: {diagnose.bodySnippet}</div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card className="p-4 space-y-2">
        <h3 className="text-medium-title">Sessions ({state.sessions.length})</h3>
        {state.sessions.length === 0 ? (
          <p className="text-normal-body text-text-dim">
            No sessions yet. Put on the glasses and say something.
          </p>
        ) : (
          <ul className="space-y-2">
            {state.sessions.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2 border-b border-border-light pb-2 last:border-0">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-normal-title">{s.title}</div>
                  <div className="text-normal-detail text-text-dim">
                    {s.projectName} · {new Date(s.lastActiveAt).toLocaleTimeString()}
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void onDeleteSession(s.id)}>
                  Delete
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4">
        <h3 className="text-medium-title">Tips</h3>
        <ul className="text-normal-body text-text-dim list-disc pl-4 space-y-1">
          <li>Tap the temple once to select or record.</li>
          <li>Swipe up/down to scroll.</li>
          <li>Double-tap the temple to go back.</li>
          <li>If connection fails, tap Diagnose — shows the raw fetch result.</li>
        </ul>
      </Card>
    </div>
  )
}
