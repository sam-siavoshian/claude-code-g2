import { useSyncExternalStore } from 'react'
import type {
  AppMode,
  BackendConfig,
  ConnectionStatus,
  SessionSummary,
  TranscriptEvent,
} from './types'
import type { ConfirmAction, PendingQuestion } from './glass/shared'

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
  sessionScrollOffset: number

  // Phase 2
  confirmAction: ConfirmAction | null
  lastActivityAt: number
  transcriptCache: Record<string, TranscriptEvent[]>

  // Phase 3
  confirmTranscriptFlow: 'new' | 'turn' | null
  pendingQuestion: PendingQuestion | null

  scrollingTranscript: boolean
  sidebarVisible: boolean
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

  confirmAction: null,
  lastActivityAt: Date.now(),
  transcriptCache: {},

  confirmTranscriptFlow: null,
  pendingQuestion: null,
  scrollingTranscript: false,
  sidebarVisible: false,
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

// Max number of session transcripts to cache for quick-switch.
const CACHE_MAX = 5

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
      mode: 'main',
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
    const rest = state.sessions.filter((x) => x.id !== s.id)
    set({ sessions: [s, ...rest] })
  },
  deleteSession(id: string): void {
    set({ sessions: state.sessions.filter((s) => s.id !== id) })
    if (state.activeSessionId === id) {
      set({ activeSessionId: null, activeTranscript: [] })
    }
    // Remove from cache
    if (state.transcriptCache[id]) {
      const { [id]: _, ...rest } = state.transcriptCache
      set({ transcriptCache: rest })
    }
  },
  openSession(id: string, transcript: TranscriptEvent[]): void {
    // Cache the transcript for quick-switch.
    const cache = { ...state.transcriptCache, [id]: transcript }
    // Evict oldest if over limit.
    const keys = Object.keys(cache)
    if (keys.length > CACHE_MAX) {
      delete cache[keys[0]!]
    }
    set({
      activeSessionId: id,
      activeTranscript: transcript,
      mode: 'main',
      sessionScrollOffset: 0,
      transcriptCache: cache,
      lastActivityAt: Date.now(),
    })
  },
  closeSession(): void {
    set({
      activeSessionId: null,
      activeTranscript: [],
      mode: 'main',
    })
  },
  pushTranscriptEvent(sessionId: string, ev: TranscriptEvent): void {
    if (sessionId !== state.activeSessionId) return
    const last = state.activeTranscript[state.activeTranscript.length - 1]
    if (last && isSameEvent(last, ev)) return
    const newTranscript = [...state.activeTranscript, ev]
    // Auto-scroll: if user is at the bottom (offset 0), stay there.
    // If user manually scrolled up (offset > 0), preserve their position.
    const update: Partial<AppState> = {
      activeTranscript: newTranscript,
      lastActivityAt: Date.now(),
    }
    if (state.sessionScrollOffset === 0) {
      update.sessionScrollOffset = 0
    }
    set(update)
    // Update cache too.
    if (state.transcriptCache[sessionId]) {
      set({ transcriptCache: { ...state.transcriptCache, [sessionId]: newTranscript } })
    }
  },

  enterMode(mode: AppMode): void {
    const next: Partial<AppState> = {
      mode,
      navIndex: 0,
      error: null,
      lastActivityAt: Date.now(),
    }
    if (isRecordingMode(mode)) {
      next.recordStartedAt = Date.now()
    } else if (mode !== 'transcribing') {
      next.recordStartedAt = null
    }
    set(next)
  },
  setNavIndex(i: number): void {
    set({ navIndex: Math.max(0, i), lastActivityAt: Date.now() })
  },
  setSessionScrollOffset(n: number): void {
    // Clamp to [0, transcript length] so the "▲ N newer" indicator
    // never grows past the actual number of scrollable lines.
    const maxOffset = Math.max(0, state.activeTranscript.length)
    set({ sessionScrollOffset: Math.max(0, Math.min(n, maxOffset)), lastActivityAt: Date.now() })
  },

  setPendingTranscript(text: string | null): void {
    set({ pendingTranscript: text })
  },

  setError(msg: string | null): void {
    set({ error: msg })
  },

  // Phase 2: Confirmation modal
  setConfirmAction(action: ConfirmAction | null): void {
    set({ confirmAction: action })
  },

  // Phase 3
  setConfirmTranscriptFlow(flow: 'new' | 'turn' | null): void {
    set({ confirmTranscriptFlow: flow })
  },
  setPendingQuestion(q: PendingQuestion | null): void {
    set({ pendingQuestion: q })
  },

  setScrollingTranscript(v: boolean): void {
    set({ scrollingTranscript: v })
  },

  setSidebarVisible(v: boolean): void {
    set({ sidebarVisible: v, lastActivityAt: Date.now() })
  },

  getCachedTranscript(sessionId: string): TranscriptEvent[] | null {
    return state.transcriptCache[sessionId] ?? null
  },
}

export function useAppState(): AppState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
