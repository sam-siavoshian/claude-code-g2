// Shared app types. Keep in lock-step with backend/src/sessions/store.ts.

export type TranscriptEvent =
  | { kind: 'user'; text: string; ts: number }
  | { kind: 'assistant_text'; text: string; ts: number }
  | { kind: 'tool_use'; toolUseId: string; name: string; input: unknown; ts: number }
  | { kind: 'tool_result'; toolUseId: string; content: string; isError: boolean; ts: number }
  | { kind: 'result'; subtype: string; isError: boolean; ts: number }
  | { kind: 'error'; message: string; ts: number }
  | { kind: 'question'; toolUseId: string; questionText: string; options: string[]; ts: number }

export interface SessionSummary {
  id: string
  title: string
  projectName: string
  createdAt: number
  lastActiveAt: number
  busy?: boolean
}

export interface Session extends SessionSummary {
  cwd: string
  transcript: TranscriptEvent[]
}

export interface ProjectInfo {
  name: string
}

export interface BackendConfig {
  projects: ProjectInfo[]
  defaultProjectName: string
}

export type GlobalEvent =
  | { kind: 'session_created'; sessionId: string; title: string; projectName: string; ts: number }
  | { kind: 'session_updated'; sessionId: string; title: string; lastActiveAt: number; busy?: boolean; ts: number }
  | { kind: 'session_deleted'; sessionId: string; ts: number }

export type SseEvent =
  | { kind: 'transcript'; sessionId: string; event: TranscriptEvent }
  | { kind: 'global'; event: GlobalEvent }

export type AppMode =
  | 'unconfigured'
  | 'main'
  | 'recording-new'
  | 'transcribing'
  | 'picking-project'
  | 'recording-turn'
  | 'confirming-transcript'  // Phase 3: voice feedback confirmation
  | 'answering'              // Phase 3: AskUserQuestion answer picker

export type ConnectionStatus = 'unknown' | 'ok' | 'error'
