import type { AppMode, ConnectionStatus, SessionSummary, TranscriptEvent } from '../types'

export interface AppSnapshot {
  mode: AppMode
  sessions: SessionSummary[]
  activeSessionId: string | null
  transcript: TranscriptEvent[]
  activeBusy: boolean

  recordStartedAt: number | null
  pendingTranscript: string | null

  projects: string[]

  // Scroll offset from the bottom of the transcript. 0 = show latest.
  sessionScrollOffset: number
  error: string | null

  connection: ConnectionStatus
}

export interface AppActions {
  startNewRecording(): void
  cancelRecording(): void
  stopNewRecordingAndTranscribe(): void
  pickProject(projectName: string): void
  openSessionById(id: string): void
  closeSession(): void
  startTurnRecording(): void
  stopTurnRecordingAndSend(): void
  scrollTranscript(delta: 1 | -1): void
}
