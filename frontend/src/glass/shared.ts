import type { AppMode, ConnectionStatus, SessionSummary, TranscriptEvent } from '../types'

export interface ConfirmAction {
  kind: 'delete'
  sessionId: string
  title: string
  expiresAt: number
}

export interface PendingQuestion {
  toolUseId: string
  text: string
  options: string[]
}

export interface SidebarItem {
  kind: 'session' | 'new'
  id?: string
  label: string
  isActive?: boolean
  busy?: boolean
}

export interface AppSnapshot {
  mode: AppMode
  sessions: SessionSummary[]
  activeSessionId: string | null
  transcript: TranscriptEvent[]
  activeBusy: boolean

  recordStartedAt: number | null
  pendingTranscript: string | null

  projects: string[]

  sessionScrollOffset: number
  error: string | null

  connection: ConnectionStatus

  confirmAction: ConfirmAction | null
  lastActivityAt: number
  confirmTranscriptFlow: 'new' | 'turn' | null
  pendingQuestion: PendingQuestion | null

  scrollingTranscript: boolean

  // Sidebar overlay: true = show session list, false = full-screen transcript
  sidebarVisible: boolean
}

export interface AppActions {
  startNewRecording(): void
  cancelRecording(): void
  stopNewRecordingAndTranscribe(): void
  pickProject(projectName: string): void
  openSessionById(id: string): void
  deleteSessionById(id: string): void
  closeSession(): void
  startTurnRecording(): void
  stopTurnRecordingAndSend(): void
  scrollTranscript(delta: number): void
  showSidebar(): void
  hideSidebar(): void

  requestDeleteConfirmation(sessionId: string, title: string): void
  confirmPendingAction(): void
  cancelPendingAction(): void

  confirmTranscript(): void
  cancelTranscript(): void

  answerQuestion(answer: string): void
}
