import { useEffect, useState } from 'react'
import { Card, Button, Input, StatusDot } from 'even-toolkit/web'
import { storageGet, storageSet, storageRemove } from 'even-toolkit/storage'
import { store, useAppState } from '../store'
import { bootstrap, checkHealth, deleteSession } from '../api'

// Storage keys go through even-toolkit/storage so we work both in a plain
// browser (localStorage) and inside the glasses WebView (bridge storage).
const LS_URL = 'cc-g2.backendUrl'
const LS_TOK = 'cc-g2.token'

export function Connect() {
  const state = useAppState()
  const [urlInput, setUrlInput] = useState('')
  const [tokenInput, setTokenInput] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      // Query-string handoff: ./dev.sh puts ?backend=<tunnel>&token=<bearer>
      // into the QR code so a single scan pre-fills both fields.
      const params = new URLSearchParams(window.location.search)
      const qsUrl = params.get('backend')
      const qsTok = params.get('token')
      if (qsUrl && qsTok) {
        setUrlInput(qsUrl)
        setTokenInput(qsTok)
        await Promise.all([storageSet(LS_URL, qsUrl), storageSet(LS_TOK, qsTok)])
        store.setCredentials(qsUrl, qsTok)
        window.history.replaceState({}, '', window.location.pathname)
        await checkAndBoot(qsUrl, qsTok)
        return
      }
      const [savedUrl, savedTok] = await Promise.all([
        storageGet<string>(LS_URL, ''),
        storageGet<string>(LS_TOK, ''),
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
    const ok = await checkHealth(url, token)
    if (ok) {
      store.setConnection('ok')
      await bootstrap()
    } else {
      store.setConnection('error', 'health check failed')
    }
  }

  async function onSave() {
    const url = urlInput.trim().replace(/\/$/, '')
    const token = tokenInput.trim()
    if (!url || !token) return
    setSaving(true)
    try {
      await Promise.all([storageSet(LS_URL, url), storageSet(LS_TOK, token)])
      store.setCredentials(url, token)
      await checkAndBoot(url, token)
    } finally {
      setSaving(false)
    }
  }

  async function onLogout() {
    await Promise.all([storageRemove(LS_URL), storageRemove(LS_TOK)])
    store.clearCredentials()
    setUrlInput('')
    setTokenInput('')
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
        <div className="flex gap-2">
          <Button onClick={onSave} disabled={saving || !urlInput || !tokenInput}>
            {configured ? 'Reconnect' : 'Connect'}
          </Button>
          {configured ? (
            <Button variant="ghost" onClick={() => void onLogout()}>Logout</Button>
          ) : null}
        </div>
        {state.connectionError ? (
          <p className="text-normal-detail text-negative">{state.connectionError}</p>
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
        </ul>
      </Card>
    </div>
  )
}
