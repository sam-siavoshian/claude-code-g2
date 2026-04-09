import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import { useGlasses } from 'even-toolkit/useGlasses'
import { appSplash } from './splash'
import { toDisplayData, onGlassAction } from './selectors'
import { toSplitView } from './splitView'
import type { AppSnapshot, AppActions } from './shared'
import { isRecordingMode, store, useAppState } from '../store'
import {
  bootstrap,
  createSession,
  getSession,
  sendTurn,
  SseClient,
  transcribeAudio,
} from '../api'
import type { AppMode, SseEvent } from '../types'
import { startCapture, stopCapture } from '../audio'

// All recording flows return to the unified split view ('main') — the
// sidebar is always present in that view, so there's no separate "go back
// to the sidebar" mode anymore.
function fallbackModeAfterRecording(): AppMode {
  return 'main'
}

// Map each AppMode to a distinct pathname. useGlasses only re-evaluates the
// active screen when `location.pathname` changes, so we drive the "current
// screen" by navigating whenever the store mode changes.
const MODE_PATHS: Record<AppMode, string> = {
  unconfigured: '/g/main',
  main: '/g/main',
  'recording-new': '/g/recording-new',
  transcribing: '/g/transcribing',
  'picking-project': '/g/picking',
  'recording-turn': '/g/recording-turn',
}

function pathToScreen(pathname: string): string {
  for (const [mode, path] of Object.entries(MODE_PATHS)) {
    if (path === pathname) return mode
  }
  return 'main'
}

export function AppGlasses() {
  const state = useAppState()
  const navigate = useNavigate()

  // Drive react-router from the store mode. useGlasses watches
  // location.pathname — navigating here is how our screen router learns
  // that the mode changed.
  useEffect(() => {
    const target = MODE_PATHS[state.mode]
    if (target && window.location.pathname !== target) {
      navigate(target, { replace: true })
    }
  }, [state.mode, navigate])

  // Force a re-render at 4 Hz while recording so the elapsed-seconds label
  // keeps ticking. The tick is NOT part of the snapshot — it only exists to
  // drive React renders; the recording screen reads Date.now() directly.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isRecordingMode(state.mode)) return
    const iv = setInterval(() => setTick((t) => (t + 1) & 0xff), 250)
    return () => clearInterval(iv)
  }, [state.mode])

  // Single global SSE stream. The backend's publishTranscript already fans
  // every transcript event to subscribers of the '*' channel too, so one
  // connection covers BOTH sidebar-level events (session_created/updated/
  // deleted) AND per-session transcript events.
  //
  // This deliberately replaces the earlier per-session SseClient. The
  // per-session subscription used to open *after* openSession() ran, which
  // meant Claude's assistant_text could fire between the POST response and
  // the EventSource handshake completing — and be lost forever since SSE
  // has no replay. The global stream is open from the moment credentials
  // land, long before any session is created, so nothing gets missed.
  useEffect(() => {
    if (!state.backendUrl || !state.token) return
    const client = new SseClient('*', (ev: SseEvent) => {
      if (ev.kind === 'global') {
        const g = ev.event
        if (g.kind === 'session_created') {
          store.upsertSession({
            id: g.sessionId,
            title: g.title,
            projectName: g.projectName,
            createdAt: g.ts,
            lastActiveAt: g.ts,
          })
        } else if (g.kind === 'session_updated') {
          const existing = store.getState().sessions.find((s) => s.id === g.sessionId)
          if (existing) {
            store.upsertSession({
              ...existing,
              title: g.title,
              lastActiveAt: g.lastActiveAt,
            })
          }
        } else if (g.kind === 'session_deleted') {
          store.deleteSession(g.sessionId)
        }
      } else if (ev.kind === 'transcript') {
        store.pushTranscriptEvent(ev.sessionId, ev.event)
      }
    })
    return () => client.close()
  }, [state.backendUrl, state.token])

  useEffect(() => {
    if (!state.backendUrl || !state.token) return
    void bootstrap()
  }, [state.backendUrl, state.token])

  // Build the snapshot inline each render. `state` is a fresh object on every
  // store update, so memoization would hit zero times anyway.
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
  }
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const getSnapshot = useCallback(() => snapshotRef.current, [])

  // Recording helpers shared by new-session and follow-up-turn flows.
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

  const actions = useRef<AppActions>({
    startNewRecording() {
      void beginRecording('recording-new')
    },
    startTurnRecording() {
      void beginRecording('recording-turn')
    },
    cancelRecording() {
      void stopCapture().catch(() => {})
      store.enterMode(fallbackModeAfterRecording())
    },
    async stopNewRecordingAndTranscribe() {
      try {
        const text = await finishRecordingToText()
        if (text == null) {
          store.enterMode('main')
          return
        }
        store.setPendingTranscript(text)
        store.enterMode('picking-project')
      } catch (err) {
        console.error('[glass] transcribe failed:', err)
        store.setError('Transcription failed')
        store.enterMode('main')
      }
    },
    async stopTurnRecordingAndSend() {
      const sid = store.getState().activeSessionId
      if (!sid) {
        store.enterMode('main')
        return
      }
      try {
        const text = await finishRecordingToText()
        if (text == null) {
          store.enterMode('main')
          return
        }
        await sendTurn(sid, text)
        store.enterMode('main')
      } catch (err) {
        console.error('[glass] follow-up turn failed:', err)
        store.setError('Turn failed')
        store.enterMode('main')
      }
    },
    async pickProject(projectName: string) {
      const prompt = store.getState().pendingTranscript
      if (!prompt) {
        store.enterMode('main')
        return
      }
      try {
        const summary = await createSession(projectName, prompt)
        store.upsertSession(summary)
        store.openSession(summary.id, [
          { kind: 'user', text: prompt, ts: Date.now() },
        ])
        store.setPendingTranscript(null)
      } catch (err) {
        console.error('[glass] createSession failed:', err)
        store.setError('Create session failed')
        store.enterMode('main')
      }
    },
    async openSessionById(id: string) {
      try {
        const session = await getSession(id)
        store.openSession(id, session.transcript)
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
  })

  const handleGlassAction = useCallback(
    (
      action: Parameters<typeof onGlassAction>[0],
      nav: Parameters<typeof onGlassAction>[1],
      snap: AppSnapshot,
    ) => onGlassAction(action, nav, snap, actions.current),
    [],
  )

  // Map the react-router pathname back to a screen key. Called by useGlasses
  // whenever location.pathname changes.
  const deriveScreen = useCallback((pathname: string) => {
    return pathToScreen(pathname)
  }, [])

  useGlasses({
    getSnapshot,
    toDisplayData,
    toSplit: toSplitView,
    onGlassAction: handleGlassAction,
    deriveScreen,
    appName: 'CLAUDE CODE G2',
    splash: appSplash,
    // 'main' renders as a split layout (sidebar + chat). The recording /
    // transcribing / picking screens take over the full screen in text mode
    // for maximum focus.
    getPageMode: (screen) => (screen === 'main' ? 'split' : 'text'),
  })

  return null
}
