import * as fs from 'node:fs'
import * as path from 'node:path'

// Hard cap on persisted transcript length per session. Prevents monolithic
// sessions.json from growing unbounded (and the save cost becoming quadratic
// in turn count). The HUD truncates further on read.
const MAX_TRANSCRIPT_EVENTS = 500

export type TranscriptEvent =
  | { kind: 'user'; text: string; ts: number }
  | { kind: 'assistant_text'; text: string; ts: number }
  | { kind: 'tool_use'; toolUseId: string; name: string; input: unknown; ts: number }
  | { kind: 'tool_result'; toolUseId: string; content: string; isError: boolean; ts: number }
  | { kind: 'result'; subtype: string; isError: boolean; ts: number }
  | { kind: 'error'; message: string; ts: number }

export interface Session {
  id: string
  title: string
  projectName: string
  cwd: string
  createdAt: number
  lastActiveAt: number
  transcript: TranscriptEvent[]
}

export interface SessionSummary {
  id: string
  title: string
  projectName: string
  createdAt: number
  lastActiveAt: number
}

interface StoreFile {
  sessions: Session[]
}

function readFileSafe(p: string): StoreFile {
  if (!fs.existsSync(p)) return { sessions: [] }
  try {
    const raw = fs.readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw) as StoreFile
    if (!parsed || !Array.isArray(parsed.sessions)) return { sessions: [] }
    return parsed
  } catch (err) {
    console.error(`[store] failed to parse ${p}, starting empty:`, err)
    return { sessions: [] }
  }
}

export class SessionStore {
  private filePath: string
  private sessions = new Map<string, Session>()
  private saveTimer: ReturnType<typeof setTimeout> | null = null

  constructor(filePath: string) {
    this.filePath = filePath
    const data = readFileSafe(filePath)
    for (const s of data.sessions) {
      // Defensive: ensure transcript array exists
      if (!Array.isArray(s.transcript)) s.transcript = []
      this.sessions.set(s.id, s)
    }
  }

  list(): SessionSummary[] {
    const out: SessionSummary[] = []
    for (const s of this.sessions.values()) {
      out.push({
        id: s.id,
        title: s.title,
        projectName: s.projectName,
        createdAt: s.createdAt,
        lastActiveAt: s.lastActiveAt,
      })
    }
    out.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    return out
  }

  get(id: string): Session | null {
    return this.sessions.get(id) ?? null
  }

  upsert(session: Session): void {
    this.sessions.set(session.id, session)
    this.scheduleSave()
  }

  delete(id: string): boolean {
    const existed = this.sessions.delete(id)
    if (existed) this.scheduleSave()
    return existed
  }

  appendEvent(id: string, ev: TranscriptEvent): void {
    const s = this.sessions.get(id)
    if (!s) return
    s.transcript.push(ev)
    if (s.transcript.length > MAX_TRANSCRIPT_EVENTS) {
      // Keep the tail; older events are purely historical.
      s.transcript.splice(0, s.transcript.length - MAX_TRANSCRIPT_EVENTS)
    }
    s.lastActiveAt = ev.ts
    this.scheduleSave()
  }

  // Debounced atomic write (temp file + rename) so a crash mid-write can't
  // leave a truncated sessions.json on disk.
  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.saveNow()
    }, 500)
  }

  saveNow(): void {
    const data: StoreFile = { sessions: Array.from(this.sessions.values()) }
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true, mode: 0o700 })
    const tmp = this.filePath + '.tmp'
    try {
      fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
      fs.renameSync(tmp, this.filePath)
    } catch (err) {
      console.error('[store] save failed:', err)
    }
  }
}

/**
 * Tail the transcript for the HUD. We cap at N events because the glasses have
 * a tight text-container budget and rendering the entire history would be both
 * slow and useless.
 */
export function truncateTranscriptForGlasses(t: TranscriptEvent[], limit = 60): TranscriptEvent[] {
  if (t.length <= limit) return t
  return t.slice(t.length - limit)
}
