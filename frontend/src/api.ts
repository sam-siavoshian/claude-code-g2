import type {
  BackendConfig,
  Session,
  SessionSummary,
  SseEvent,
} from './types'
import { store } from './store'

export class NotConfiguredError extends Error {
  constructor() {
    super('Backend URL and token are not configured yet')
    this.name = 'NotConfiguredError'
  }
}

function getCreds(): { url: string; token: string } {
  const { backendUrl, token } = store.getState()
  if (!backendUrl || !token) throw new NotConfiguredError()
  return { url: backendUrl, token }
}

async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { url, token } = getCreds()
  const headers = new Headers(init.headers ?? {})
  headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !headers.has('Content-Type') && typeof init.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }
  return fetch(url + path, { ...init, headers })
}

export async function checkHealth(backendUrl: string, token: string): Promise<boolean> {
  // We hit /config (authed) rather than /health (unauthed) because we want
  // to verify BOTH the URL and the token in one call.
  const base = backendUrl.replace(/\/$/, '')
  try {
    const res = await fetch(base + '/api/config', {
      headers: { Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

export async function getConfig(): Promise<BackendConfig> {
  const res = await authFetch('/api/config')
  if (!res.ok) throw new Error(`getConfig: ${res.status}`)
  return res.json()
}

export async function listSessions(): Promise<SessionSummary[]> {
  const res = await authFetch('/api/sessions')
  if (!res.ok) throw new Error(`listSessions: ${res.status}`)
  const body = await res.json() as { sessions: SessionSummary[] }
  return body.sessions
}

export async function getSession(id: string): Promise<Session> {
  const res = await authFetch(`/api/sessions/${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error(`getSession: ${res.status}`)
  const body = await res.json() as { session: Session }
  return body.session
}

export async function createSession(
  projectName: string,
  firstPrompt: string,
): Promise<SessionSummary> {
  const res = await authFetch('/api/sessions', {
    method: 'POST',
    body: JSON.stringify({ projectName, firstPrompt }),
  })
  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`createSession: ${res.status} ${err}`)
  }
  const body = await res.json() as { session: SessionSummary }
  return body.session
}

export async function sendTurn(sessionId: string, text: string): Promise<void> {
  const res = await authFetch(`/api/sessions/${encodeURIComponent(sessionId)}/turn`, {
    method: 'POST',
    body: JSON.stringify({ text }),
  })
  if (!res.ok) throw new Error(`sendTurn: ${res.status}`)
}

export async function deleteSession(id: string): Promise<void> {
  const res = await authFetch(`/api/sessions/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error(`deleteSession: ${res.status}`)
}

export async function transcribeAudio(pcm: Uint8Array): Promise<string> {
  const res = await authFetch('/api/transcribe', {
    method: 'POST',
    headers: { 'Content-Type': 'audio/pcm' },
    body: pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer,
  })
  if (!res.ok) throw new Error(`transcribe: ${res.status}`)
  const body = await res.json() as { text: string }
  return body.text
}

// Server-Sent Events — single reconnecting connection per channel.

export type SseHandler = (ev: SseEvent) => void

export class SseClient {
  private es: EventSource | null = null
  private closed = false
  constructor(
    private channelSessionId: string, // '*' for global or a real session id
    private onEvent: SseHandler,
  ) {
    this.open()
  }

  private open(): void {
    if (this.closed) return
    try {
      const { url, token } = getCreds()
      const qs = new URLSearchParams({
        sessionId: this.channelSessionId,
        token,
      })
      const es = new EventSource(`${url}/api/events?${qs.toString()}`)
      this.es = es
      es.onmessage = (msg) => {
        try {
          const parsed = JSON.parse(msg.data) as SseEvent
          this.onEvent(parsed)
        } catch (err) {
          console.warn('[sse] parse error', err)
        }
      }
      es.onerror = () => {
        // Let the browser auto-reconnect via the `retry:` hint from the server.
        // If the connection is permanently gone, we'll retry on a delay.
        if (this.closed) return
        console.warn('[sse] connection lost, will retry')
      }
    } catch (err) {
      console.warn('[sse] cannot open (not configured):', err)
    }
  }

  close(): void {
    this.closed = true
    this.es?.close()
    this.es = null
  }
}

export async function bootstrap(): Promise<void> {
  const { backendUrl, token } = store.getState()
  if (!backendUrl || !token) return
  try {
    const [cfg, sessions] = await Promise.all([getConfig(), listSessions()])
    store.setBackendConfig(cfg)
    store.setSessions(sessions)
    store.setConnection('ok')
  } catch (err) {
    console.error('[bootstrap] failed:', err)
    store.setConnection('error', (err as Error).message)
  }
}
