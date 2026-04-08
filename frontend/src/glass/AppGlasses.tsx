import { useCallback, useEffect, useRef, useState } from 'react'
import { useGlasses } from 'even-toolkit/useGlasses'
import { appSplash } from './splash'
import { toDisplayData, onGlassAction } from './selectors'
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

// The active session's presence determines where a cancel/finish lands.
function fallbackModeAfterRecording(): AppMode {
  return store.getState().activeSessionId ? 'session' : 'sidebar'
}

export function AppGlasses() {
  const state = useAppState()

  // Force a re-render at 4 Hz while recording so the elapsed-seconds label
  // keeps ticking. The tick is NOT part of the snapshot — it only exists to
  // drive React renders; the recording screen reads Date.now() directly.
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!isRecordingMode(state.mode)) return
    const iv = setInterval(() => setTick((t) => (t + 1) & 0xff), 250)
    return () => clearInterval(iv)
  }, [state.mode])

  // Global SSE: one stream for sidebar-level events.
  useEffect(() => {
    if (!state.backendUrl || !state.token) return
    const client = new SseClient('*', (ev: SseEvent) => {
      if (ev.kind !== 'global') return
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
    })
    return () => client.close()
  }, [state.backendUrl, state.token])

  // Per-session SSE: opened only while viewing a specific session.
  useEffect(() => {
    const id = state.activeSessionId
    if (!id || !state.backendUrl || !state.token) return
    const client = new SseClient(id, (ev: SseEvent) => {
      if (ev.kind === 'transcript' && ev.sessionId === id) {
        store.pushTranscriptEvent(id, ev.event)
      }
    })
    return () => client.close()
  }, [state.activeSessionId, state.backendUrl, state.token])

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
          store.enterMode('sidebar')
          return
        }
        store.setPendingTranscript(text)
        store.enterMode('picking-project')
      } catch (err) {
        console.error('[glass] transcribe failed:', err)
        store.setError('Transcription failed')
        store.enterMode('sidebar')
      }
    },
    async stopTurnRecordingAndSend() {
      const sid = store.getState().activeSessionId
      if (!sid) {
        store.enterMode('sidebar')
        return
      }
      try {
        const text = await finishRecordingToText()
        if (text == null) {
          store.enterMode('session')
          return
        }
        await sendTurn(sid, text)
        store.enterMode('session')
      } catch (err) {
        console.error('[glass] follow-up turn failed:', err)
        store.setError('Turn failed')
        store.enterMode('session')
      }
    },
    async pickProject(projectName: string) {
      const prompt = store.getState().pendingTranscript
      if (!prompt) {
        store.enterMode('sidebar')
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
        store.enterMode('sidebar')
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

  const deriveScreen = useCallback(() => {
    const mode = snapshotRef.current.mode
    return mode === 'unconfigured' ? 'sidebar' : mode
  }, [])

  useGlasses({
    getSnapshot,
    toDisplayData,
    onGlassAction: handleGlassAction,
    deriveScreen,
    appName: 'CLAUDE CODE G2',
    splash: appSplash,
    getPageMode: () => 'text',
  })

  return null
}
