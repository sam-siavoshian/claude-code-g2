import { useSyncExternalStore } from 'react'
import type {
  AppMode,
  BackendConfig,
  ConnectionStatus,
  SessionSummary,
  TranscriptEvent,
} from './types'

export interface AppState {
  backendUrl: string | null
  token: string | null
  connection: ConnectionStatus
  connectionError: string | null

  projects: string[]
  defaultProjectName: string | null

  sessions: SessionSummary[]

  activeSessionId: string | null
  activeTranscript: TranscriptEvent[]

  mode: AppMode

  recordStartedAt: number | null
  pendingTranscript: string | null

  error: string | null

  navIndex: number
  // Scroll offset from the bottom (0 = stick to latest). Matches
  // buildChatDisplay's scroll semantics.
  sessionScrollOffset: number
}

const initialState: AppState = {
  backendUrl: null,
  token: null,
  connection: 'unknown',
  connectionError: null,

  projects: [],
  defaultProjectName: null,

  sessions: [],

  activeSessionId: null,
  activeTranscript: [],

  mode: 'unconfigured',

  recordStartedAt: null,
  pendingTranscript: null,

  error: null,

  navIndex: 0,
  sessionScrollOffset: 0,
}

let state: AppState = initialState
const listeners = new Set<() => void>()

function shallowEqual<T extends object>(a: T, partial: Partial<T>): boolean {
  for (const k in partial) {
    if (!Object.is(a[k], partial[k])) return false
  }
  return true
}

function set(partial: Partial<AppState>): void {
  if (shallowEqual(state, partial)) return
  state = { ...state, ...partial }
  for (const l of listeners) l()
}

const RECORDING_MODES: ReadonlySet<AppMode> = new Set(['recording-new', 'recording-turn'])

export function isRecordingMode(mode: AppMode): boolean {
  return RECORDING_MODES.has(mode)
}

function isSameEvent(a: TranscriptEvent, b: TranscriptEvent): boolean {
  if (a.kind !== b.kind || a.ts !== b.ts) return false
  if (a.kind === 'tool_use' && b.kind === 'tool_use') return a.toolUseId === b.toolUseId
  if (a.kind === 'tool_result' && b.kind === 'tool_result') return a.toolUseId === b.toolUseId
  if (a.kind === 'assistant_text' && b.kind === 'assistant_text') return a.text === b.text
  if (a.kind === 'user' && b.kind === 'user') return a.text === b.text
  return true
}

export const store = {
  getState(): AppState {
    return state
  },
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },

  setCredentials(backendUrl: string, token: string): void {
    set({
      backendUrl: backendUrl.replace(/\/$/, ''),
      token,
      mode: 'sidebar',
      connection: 'unknown',
      connectionError: null,
    })
  },
  clearCredentials(): void {
    set({
      backendUrl: null,
      token: null,
      connection: 'unknown',
      mode: 'unconfigured',
    })
  },
  setConnection(status: ConnectionStatus, err?: string | null): void {
    set({ connection: status, connectionError: err ?? null })
  },
  setBackendConfig(cfg: BackendConfig): void {
    set({
      projects: cfg.projects.map((p) => p.name),
      defaultProjectName: cfg.defaultProjectName,
    })
  },

  setSessions(sessions: SessionSummary[]): void {
    set({ sessions })
  },
  upsertSession(s: SessionSummary): void {
    // Most updates move the touched session to the top — avoid a full re-sort.
    const rest = state.sessions.filter((x) => x.id !== s.id)
    set({ sessions: [s, ...rest] })
  },
  deleteSession(id: string): void {
    set({ sessions: state.sessions.filter((s) => s.id !== id) })
    if (state.activeSessionId === id) {
      set({ activeSessionId: null, activeTranscript: [], mode: 'sidebar' })
    }
  },
  openSession(id: string, transcript: TranscriptEvent[]): void {
    set({
      activeSessionId: id,
      activeTranscript: transcript,
      mode: 'session',
      navIndex: 0,
      sessionScrollOffset: 0,
    })
  },
  closeSession(): void {
    set({
      activeSessionId: null,
      activeTranscript: [],
      mode: 'sidebar',
      navIndex: 0,
    })
  },
  pushTranscriptEvent(sessionId: string, ev: TranscriptEvent): void {
    if (sessionId !== state.activeSessionId) return
    // Cheap dedup: if the previous event has the same timestamp, kind and
    // (where relevant) id, treat it as a duplicate. This lets us mix live
    // SSE events with a defensive getSession fetch without risking repeats.
    const last = state.activeTranscript[state.activeTranscript.length - 1]
    if (last && isSameEvent(last, ev)) return
    set({
      activeTranscript: [...state.activeTranscript, ev],
      // Stick to the bottom on new events.
      sessionScrollOffset: 0,
    })
  },

  enterMode(mode: AppMode): void {
    const next: Partial<AppState> = {
      mode,
      navIndex: 0,
      error: null,
    }
    if (isRecordingMode(mode)) {
      next.recordStartedAt = Date.now()
    } else {
      next.recordStartedAt = null
    }
    set(next)
  },
  setNavIndex(i: number): void {
    set({ navIndex: Math.max(0, i) })
  },
  setSessionScrollOffset(n: number): void {
    set({ sessionScrollOffset: Math.max(0, n) })
  },

  setPendingTranscript(text: string | null): void {
    set({ pendingTranscript: text })
  },

  setError(msg: string | null): void {
    set({ error: msg })
  },
}

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
