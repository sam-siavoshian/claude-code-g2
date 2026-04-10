import { useEffect, useState } from 'react'
import { Badge, Button, Input, StatusDot, Divider, Kbd } from 'even-toolkit/web'
import { storageGet, storageSet, storageRemove } from 'even-toolkit/storage'
import { store, useAppState } from '../store'
import { bootstrap, checkHealth, deleteSession } from '../api'

const LS_URL = 'cc-g2.backendUrl'
const LS_TOK = 'cc-g2.token'

async function safeGet(key: string): Promise<string> {
  try { return await storageGet<string>(key, '') }
  catch { return '' }
}
async function safeSet(key: string, value: string): Promise<void> {
  try { await storageSet(key, value) } catch { /* sandboxed */ }
}
async function safeRemove(key: string): Promise<void> {
  try { await storageRemove(key) } catch { /* sandboxed */ }
}

function maskToken(tok: string | null): string {
  if (!tok) return ''
  if (tok.length <= 10) return tok
  return tok.slice(0, 4) + '…' + tok.slice(-4)
}

function timeAgo(ts: number): string {
  const sec = Math.floor((Date.now() - ts) / 1000)
  if (sec < 60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  return `${Math.floor(sec / 86400)}d ago`
}

// #8: Human-readable glasses state for companion pane.
function glassesState(mode: string, activeBusy: boolean): { label: string; color: string } | null {
  switch (mode) {
    case 'recording-new': return { label: '● Recording (new session)', color: 'text-negative' }
    case 'recording-turn': return { label: '● Recording (follow-up)', color: 'text-negative' }
    case 'transcribing': return { label: '◐ Transcribing…', color: 'text-warning' }
    case 'picking-project': return { label: 'Picking project…', color: 'text-text' }
    case 'confirming-transcript': return { label: 'Confirming voice…', color: 'text-text' }
    case 'answering': return { label: 'Claude asked a question', color: 'text-warning' }
    default:
      if (activeBusy) return { label: '◐ Claude is working…', color: 'text-warning' }
      return null
  }
}

interface DiagnoseResult {
  url: string; ok: boolean; status?: number; bodySnippet?: string; error?: string; timeMs: number
}

function describeFetchError(err: unknown): string {
  if (err instanceof Error) {
    const name = err.name && err.name !== 'Error' ? `${err.name}: ` : ''
    return `${name}${err.message || String(err)}`
  }
  return String(err)
}

async function runDiagnose(backendUrl: string): Promise<DiagnoseResult> {
  const target = backendUrl.replace(/\/$/, '') + '/api/ping'
  const start = Date.now()
  try {
    const res = await fetch(target, { method: 'GET' })
    const body = await res.text().catch(() => '')
    return { url: target, ok: res.ok, status: res.status, bodySnippet: body.slice(0, 120), timeMs: Date.now() - start }
  } catch (err) {
    return { url: target, ok: false, error: describeFetchError(err), timeMs: Date.now() - start }
  }
}

export function Connect() {
  const state = useAppState()
  const [urlInput, setUrlInput] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [diagnose, setDiagnose] = useState<DiagnoseResult | null>(null)
  const [showSetup, setShowSetup] = useState(false)
  // #1: Delete confirmation on companion pane
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; title: string } | null>(null)

  useEffect(() => {
    void (async () => {
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
      const [savedUrl, savedTok] = await Promise.all([safeGet(LS_URL), safeGet(LS_TOK)])
      if (savedUrl) setUrlInput(savedUrl)
      if (savedTok) setTokenInput(savedTok)
      if (savedUrl && savedTok) {
        store.setCredentials(savedUrl, savedTok)
        await checkAndBoot(savedUrl, savedTok)
      } else {
        setShowSetup(true)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function checkAndBoot(url: string, token: string) {
    const result = await checkHealth(url, token)
    if (result.ok) {
      store.setConnection('ok')
      setDiagnose(null)
      setShowSetup(false)
      await bootstrap()
    } else {
      const reason = result.failedUrl
        ? `${result.reason} (url: ${result.failedUrl})`
        : (result.reason ?? 'health check failed')
      store.setConnection('error', reason)
      setShowSetup(true)
      const diag = await runDiagnose(url)
      setDiagnose(diag)
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
    setShowSetup(true)
  }

  async function onDiagnose() {
    const url = (urlInput || state.backendUrl || '').trim()
    if (!url) return
    setDiagnose(null)
    const r = await runDiagnose(url)
    setDiagnose(r)
  }

  async function onConfirmDelete() {
    if (!deleteConfirm) return
    try {
      await deleteSession(deleteConfirm.id)
      store.deleteSession(deleteConfirm.id)
    } catch (err) {
      console.error(err)
    }
    setDeleteConfirm(null)
  }

  const configured = Boolean(state.backendUrl && state.token)
  const connected = state.connection === 'ok'
  const activeBusy = state.activeTranscript.length > 0 &&
    state.activeTranscript[state.activeTranscript.length - 1]?.kind !== 'result'
  const gs = glassesState(state.mode, activeBusy)

  return (
    <div className="space-y-3">
      {/* ── Status bar ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <StatusDot connected={connected} />
          <span className="text-normal-subtitle">
            {connected ? 'connected' : configured ? 'disconnected' : 'not configured'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {configured && <Badge>{maskToken(state.token)}</Badge>}
          <Button variant="ghost" size="sm" onClick={() => setShowSetup(!showSetup)}>
            {showSetup ? 'hide' : 'setup'}
          </Button>
        </div>
      </div>

      {/* #8: Glasses state indicator */}
      {gs && (
        <div className={`rounded bg-surface px-3 py-1.5 ${gs.color} text-normal-subtitle`}>
          {gs.label}
        </div>
      )}

      {state.connectionError && (
        <div className="rounded bg-negative/10 px-3 py-2">
          <div className="text-normal-detail text-negative break-words">{state.connectionError}</div>
        </div>
      )}

      {showSetup && (
        <div className="space-y-2 rounded bg-surface p-3">
          <div className="space-y-1">
            <label className="text-normal-detail text-text-dim">Backend URL</label>
            <Input type="url" placeholder="https://abc.trycloudflare.com" value={urlInput} onChange={(e) => setUrlInput(e.target.value)} />
          </div>
          <div className="space-y-1">
            <label className="text-normal-detail text-text-dim">Bearer token</label>
            <Input type="password" placeholder="paste from terminal" value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={onSave} disabled={saving || !urlInput || !tokenInput}>
              {configured ? 'Reconnect' : 'Connect'}
            </Button>
            <Button variant="ghost" onClick={() => void onDiagnose()} disabled={!urlInput && !state.backendUrl}>Diagnose</Button>
            {configured && <Button variant="ghost" onClick={() => void onLogout()}>Logout</Button>}
          </div>
          {diagnose && (
            <div className="text-normal-detail space-y-1">
              <div className="text-text-dim break-words">GET {diagnose.url}</div>
              {diagnose.ok
                ? <div className="text-positive">OK {diagnose.status} · {diagnose.timeMs}ms</div>
                : <div className="text-negative break-words">FAIL {diagnose.error ?? `HTTP ${diagnose.status}`} · {diagnose.timeMs}ms</div>}
              {diagnose.bodySnippet && <div className="text-text-dim break-words font-mono text-xs">{diagnose.bodySnippet}</div>}
            </div>
          )}
        </div>
      )}

      <Divider />

      {/* ── Sessions ── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-normal-subtitle">Sessions</span>
          <span className="text-normal-detail text-text-dim">
            {state.sessions.length}{state.activeSessionId ? ' · 1 active' : ''}
          </span>
        </div>

        {state.sessions.length === 0 ? (
          <div className="rounded bg-surface px-3 py-4 text-center">
            <div className="text-normal-body text-text-dim">no sessions yet</div>
            <div className="text-normal-detail text-text-dim mt-1">
              put on glasses · tap <Kbd>[+]</Kbd> · speak
            </div>
          </div>
        ) : (
          <div className="space-y-1" style={{ maxHeight: '55vh', overflowY: 'auto' }}>
            {[...state.sessions]
              .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
              .map((s) => {
                const isActive = s.id === state.activeSessionId
                return (
                  <div
                    key={s.id}
                    className={
                      'flex items-center gap-2 rounded px-2 py-1.5 ' +
                      (isActive ? 'bg-positive/10 border border-positive/20' : 'bg-surface')
                    }
                  >
                    <div className={'w-1.5 h-1.5 rounded-full shrink-0 ' + (isActive ? 'bg-positive' : s.busy ? 'bg-warning' : 'bg-text-dim/30')} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-normal-body">{s.title}</div>
                      <div className="text-normal-detail text-text-dim">
                        {s.projectName} · {timeAgo(s.lastActiveAt)}
                        {s.busy ? ' · working…' : ''}
                      </div>
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setDeleteConfirm({ id: s.id, title: s.title })}>
                      ×
                    </Button>
                  </div>
                )
              })}
          </div>
        )}
      </div>

      {/* #1: Delete confirmation modal */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-6">
          <div className="rounded-lg bg-surface p-4 space-y-3 max-w-sm w-full shadow-lg">
            <div className="text-normal-title">Delete session?</div>
            <div className="text-normal-body text-text-dim">
              "{deleteConfirm.title}" will be permanently deleted. This cannot be undone.
            </div>
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
              <Button onClick={() => void onConfirmDelete()}>Delete</Button>
            </div>
          </div>
        </div>
      )}

      <Divider />

      {/* ── Gesture reference ── */}
      <div className="space-y-1">
        <div className="text-normal-detail text-text-dim font-semibold">Glasses controls</div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-normal-detail text-text-dim">
          <span><Kbd>swipe ↑↓</Kbd> scroll list</span>
          <span><Kbd>tap</Kbd> select / record</span>
          <span><Kbd>2tap</Kbd> delete / cancel</span>
          <span><Kbd>[+]</Kbd> new voice session</span>
          <span><Kbd>tap</Kbd> on active = follow-up</span>
          <span><Kbd>2tap</Kbd> on active = close+delete</span>
        </div>
      </div>
    </div>
  )
}
