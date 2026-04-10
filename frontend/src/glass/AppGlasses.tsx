import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useGlasses } from 'even-toolkit/useGlasses'
import { appSplash } from './splash'
import { toDisplayData, onGlassAction } from './selectors'
import { toSplitView } from './splitView'
import { loadClaudeLogo } from './logo'
import type { AppSnapshot, AppActions } from './shared'
import { isRecordingMode, store, useAppState } from '../store'
import {
  bootstrap,
  createSession,
  deleteSession as apiDeleteSession,
  getSession,
  sendTurn,
  SseClient,
  transcribeAudio,
} from '../api'
import type { AppMode, SseEvent } from '../types'
import { startCapture, stopCapture } from '../audio'

function fallbackModeAfterRecording(): AppMode {
  return 'main'
}

const MODE_PATHS: Record<AppMode, string> = {
  unconfigured: '/g/main',
  main: '/g/main',
  'recording-new': '/g/recording-new',
  transcribing: '/g/transcribing',
  'picking-project': '/g/picking',
  'recording-turn': '/g/recording-turn',
  'confirming-transcript': '/g/confirming',
  answering: '/g/answering',
}

const PATH_TO_SCREEN: Record<string, string> = {
  '/g/main': 'main',
  '/g/recording-new': 'recording-new',
  '/g/transcribing': 'transcribing',
  '/g/picking': 'picking-project',
  '/g/recording-turn': 'recording-turn',
  '/g/confirming': 'confirming-transcript',
  '/g/answering': 'answering',
}

function pathToScreen(pathname: string): string {
  return PATH_TO_SCREEN[pathname] ?? 'main'
}

export function AppGlasses() {
  const state = useAppState()
  const navigate = useNavigate()

  useEffect(() => {
    const target = MODE_PATHS[state.mode]
    if (target && window.location.pathname !== target) {
      navigate(target, { replace: true })
    }
  }, [state.mode, navigate])

  const [, setTick] = useState(0)
  useEffect(() => {
    const needsTick =
      isRecordingMode(state.mode) ||
      state.mode === 'transcribing' ||
      state.mode === 'confirming-transcript' ||
      state.confirmAction !== null
    if (!needsTick) return
    const iv = setInterval(() => setTick((t) => (t + 1) & 0xff), 250)
    return () => clearInterval(iv)
  }, [state.mode, state.confirmAction])

  // Error toast auto-clear after 4 seconds.
  useEffect(() => {
    if (!state.error) return
    const t = setTimeout(() => store.setError(null), 4000)
    return () => clearTimeout(t)
  }, [state.error])

  // Idle dimming re-render trigger.
  useEffect(() => {
    if (state.mode !== 'main') return
    const t = setTimeout(() => setTick((t) => (t + 1) & 0xff), 31_000)
    return () => clearTimeout(t)
  }, [state.lastActivityAt, state.mode])

  // Global SSE stream.
  useEffect(() => {
    if (!state.backendUrl || !state.token) return
    const client = new SseClient('*', (ev: SseEvent) => {
      if (ev.kind === 'global') {
        const g = ev.event
        if (g.kind === 'session_created') {
          store.upsertSession({
            id: g.sessionId, title: g.title, projectName: g.projectName,
            createdAt: g.ts, lastActiveAt: g.ts,
          })
        } else if (g.kind === 'session_updated') {
          const existing = store.getState().sessions.find((s) => s.id === g.sessionId)
          if (existing) {
            store.upsertSession({
              ...existing, title: g.title, lastActiveAt: g.lastActiveAt,
              busy: g.busy ?? existing.busy,
            })
          }
        } else if (g.kind === 'session_deleted') {
          store.deleteSession(g.sessionId)
        }
      } else if (ev.kind === 'transcript') {
        const tevt = ev.event
        if (
          tevt.kind === 'question' ||
          (tevt.kind === 'tool_use' && tevt.name === 'AskUserQuestion')
        ) {
          if (tevt.kind === 'tool_use') {
            const inp = tevt.input as Record<string, unknown> | undefined
            const questionText = typeof inp?.question === 'string' ? inp.question : String(inp?.question ?? 'Claude has a question')
            const rawOpts = inp?.options
            const options = Array.isArray(rawOpts) ? rawOpts.map(String) : []
            store.setPendingQuestion({ toolUseId: tevt.toolUseId, text: questionText, options })
            store.enterMode('answering')
          } else if (tevt.kind === 'question') {
            store.setPendingQuestion({ toolUseId: tevt.toolUseId, text: tevt.questionText, options: tevt.options })
            store.enterMode('answering')
          }
        }
        store.pushTranscriptEvent(ev.sessionId, tevt)
      }
    })
    return () => client.close()
  }, [state.backendUrl, state.token])

  useEffect(() => {
    if (!state.backendUrl || !state.token) return
    void bootstrap()
  }, [state.backendUrl, state.token])

  const snapshot: AppSnapshot = {
    mode: state.mode,
    sessions: state.sessions,
    activeSessionId: state.activeSessionId,
    transcript: state.activeTranscript,
    activeBusy:
      state.activeTranscript.length > 0 &&
      state.activeTranscript[state.activeTranscript.length - 1]!.kind !== 'result',
    recordStartedAt: state.recordStartedAt,
    pendingTranscript: state.pendingTranscript,
    projects: state.projects,
    sessionScrollOffset: state.sessionScrollOffset,
    error: state.error,
    connection: state.connection,
    confirmAction: state.confirmAction,
    lastActivityAt: state.lastActivityAt,
    confirmTranscriptFlow: state.confirmTranscriptFlow,
    pendingQuestion: state.pendingQuestion,
    scrollingTranscript: state.scrollingTranscript,
    sidebarVisible: state.sidebarVisible,
  }
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const getSnapshot = useCallback(() => snapshotRef.current, [])

  async function beginRecording(mode: 'recording-new' | 'recording-turn') {
    store.enterMode(mode)
    try {
      await startCapture()
    } catch (err) {
      console.error('[glass] startCapture failed:', err)
      store.setError('Mic open failed')
      store.enterMode(fallbackModeAfterRecording())
    }
  }

  async function finishRecordingToText(): Promise<string | null> {
    const pcm = await stopCapture()
    if (!pcm || pcm.length === 0) {
      store.setError("Didn't catch that")
      return null
    }
    store.enterMode('transcribing')
    const text = await transcribeAudio(pcm)
    if (!text || text.length < 2) {
      store.setError("Didn't catch that")
      return null
    }
    return text
  }

  // Execute confirmed transcript — either create new session or send follow-up.
  async function executeTranscriptFlow(flow: 'new' | 'turn') {
    store.setConfirmTranscriptFlow(null)
    if (flow === 'new') {
      const text = store.getState().pendingTranscript
      if (!text) { store.enterMode('main'); return }
      // Use default project — no picker. If no default and >1 project, fall back to picker.
      const { defaultProjectName, projects } = store.getState()
      const projectName = defaultProjectName ?? projects[0]
      if (!projectName) {
        // Edge case: no projects configured at all
        store.setError('No project configured')
        store.enterMode('main')
        return
      }
      if (!defaultProjectName && projects.length > 1) {
        // Multiple projects, no default — show picker as fallback
        store.enterMode('picking-project')
        return
      }
      try {
        const summary = await createSession(projectName, text)
        store.upsertSession(summary)
        store.openSession(summary.id, [{ kind: 'user', text, ts: Date.now() }])
        store.setPendingTranscript(null)
        store.setSidebarVisible(false)
      } catch (err) {
        console.error('[glass] createSession failed:', err)
        store.setError('Create session failed')
        store.enterMode('main')
      }
    } else {
      const sid = store.getState().activeSessionId
      const text = store.getState().pendingTranscript
      if (!sid || !text) { store.enterMode('main'); return }
      try {
        await sendTurn(sid, text)
        store.setPendingTranscript(null)
        store.enterMode('main')
      } catch (err) {
        console.error('[glass] follow-up turn failed:', err)
        store.setError('Turn failed')
        store.enterMode('main')
      }
    }
  }

  const actions = useRef<AppActions>({
    startNewRecording() {
      void beginRecording('recording-new')
    },
    startTurnRecording() {
      void beginRecording('recording-turn')
    },
    cancelRecording() {
      void stopCapture().catch(() => {})
      store.setPendingTranscript(null)
      store.setConfirmTranscriptFlow(null)
      store.enterMode(fallbackModeAfterRecording())
    },
    async stopNewRecordingAndTranscribe() {
      try {
        const text = await finishRecordingToText()
        if (text == null) { store.enterMode('main'); return }
        store.setPendingTranscript(text)
        store.setConfirmTranscriptFlow('new')
        store.enterMode('confirming-transcript')
        // No auto-send timer. User must explicitly tap to confirm.
      } catch (err) {
        console.error('[glass] transcribe failed:', err)
        store.setError('Transcription failed')
        store.enterMode('main')
      }
    },
    async stopTurnRecordingAndSend() {
      const sid = store.getState().activeSessionId
      if (!sid) { store.enterMode('main'); return }
      try {
        const text = await finishRecordingToText()
        if (text == null) { store.enterMode('main'); return }
        store.setPendingTranscript(text)
        store.setConfirmTranscriptFlow('turn')
        store.enterMode('confirming-transcript')
      } catch (err) {
        console.error('[glass] follow-up turn failed:', err)
        store.setError('Turn failed')
        store.enterMode('main')
      }
    },
    async pickProject(projectName: string) {
      const prompt = store.getState().pendingTranscript
      if (!prompt) { store.enterMode('main'); return }
      try {
        const summary = await createSession(projectName, prompt)
        store.upsertSession(summary)
        store.openSession(summary.id, [{ kind: 'user', text: prompt, ts: Date.now() }])
        store.setPendingTranscript(null)
      } catch (err) {
        console.error('[glass] createSession failed:', err)
        store.setError('Create session failed')
        store.enterMode('main')
      }
    },
    async deleteSessionById(id: string) {
      store.deleteSession(id)
      try { await apiDeleteSession(id) } catch (err) {
        console.error('[glass] deleteSession failed:', err)
        store.setError('Delete failed')
      }
    },
    async openSessionById(id: string) {
      const cached = store.getCachedTranscript(id)
      if (cached) store.openSession(id, cached)
      try {
        const session = await getSession(id)
        store.openSession(id, session.transcript)
        store.setSidebarVisible(false)
      } catch (err) {
        console.error('[glass] getSession failed:', err)
        store.setError('Load session failed')
      }
    },
    closeSession() {
      store.closeSession()
    },
    scrollTranscript(delta) {
      const cur = store.getState().sessionScrollOffset
      store.setSessionScrollOffset(cur + delta)
    },
    showSidebar() {
      store.setSidebarVisible(true)
    },
    hideSidebar() {
      store.setSidebarVisible(false)
    },

    requestDeleteConfirmation(sessionId: string, title: string) {
      store.setConfirmAction({ kind: 'delete', sessionId, title, expiresAt: Date.now() + 5000 })
    },
    confirmPendingAction() {
      const ca = store.getState().confirmAction
      if (!ca) return
      if (ca.kind === 'delete') {
        store.setConfirmAction(null)
        void actions.current.deleteSessionById(ca.sessionId)
      }
    },
    cancelPendingAction() {
      store.setConfirmAction(null)
    },

    confirmTranscript() {
      const flow = store.getState().confirmTranscriptFlow
      if (flow) void executeTranscriptFlow(flow)
    },
    cancelTranscript() {
      store.setPendingTranscript(null)
      store.setConfirmTranscriptFlow(null)
      store.enterMode('main')
    },

    async answerQuestion(answer: string) {
      const sid = store.getState().activeSessionId
      store.setPendingQuestion(null)
      store.enterMode('main')
      if (!sid) return
      try { await sendTurn(sid, answer) } catch (err) {
        console.error('[glass] answerQuestion failed:', err)
        store.setError('Answer failed')
      }
    },
  })

  const handleGlassAction = useCallback(
    (
      action: Parameters<typeof onGlassAction>[0],
      nav: Parameters<typeof onGlassAction>[1],
      snap: AppSnapshot,
    ) => onGlassAction(action, nav, snap, actions.current),
    [],
  )

  const deriveScreen = useCallback((pathname: string) => pathToScreen(pathname), [])

  // Dynamic page mode: full-screen text when a session is active (no sidebar
  // eating 31% of screen), split view only for session browser (no active session).
  // Load Claude logo PNG for the sidebar/home screen.
  const [logoTiles, setLogoTiles] = useState<
    { id: number; name: string; bytes: Uint8Array; x: number; y: number; w: number; h: number }[]
  >([])
  useEffect(() => {
    void loadClaudeLogo().then((bytes) => {
      if (bytes) {
        // Position: top-right corner, 80x80 (scaled down from original).
        setLogoTiles([{ id: 1, name: 'claude', bytes, x: 480, y: 0, w: 80, h: 80 }])
      }
    })
  }, [])

  const getPageMode = useCallback((screen: string) => {
    if (screen !== 'main') return 'text' as const
    const snap = snapshotRef.current
    // Home mode for sidebar (shows Claude logo image + text list).
    // Text mode for active session transcript (full-screen, no images).
    if (!snap.activeSessionId || snap.sidebarVisible) return 'home' as const
    return 'text' as const
  }, [])

  useGlasses({
    getSnapshot,
    toDisplayData,
    toSplit: toSplitView,
    onGlassAction: handleGlassAction,
    deriveScreen,
    appName: 'CLAUDE CODE G2',
    splash: appSplash,
    getPageMode,
    homeImageTiles: logoTiles.length > 0 ? logoTiles : undefined,
  })

  return null
}
