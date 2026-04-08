import { randomUUID } from 'node:crypto'
import type { RuntimeConfig } from '../config.ts'
import type { SseHub } from '../events.ts'
import { ClaudeCodeProc } from './claudeProc.ts'
import { SessionStore, type Session, type SessionSummary, type TranscriptEvent } from './store.ts'

export interface CreateSessionOpts {
  projectName: string
  firstPrompt: string
  model?: string
}

export class SessionManager {
  private store: SessionStore
  private procs = new Map<string, ClaudeCodeProc>()

  constructor(
    private cfg: RuntimeConfig,
    private sse: SseHub,
  ) {
    this.store = new SessionStore(cfg.sessionsPath)
  }

  list(): SessionSummary[] {
    return this.store.list()
  }

  get(id: string): Session | null {
    return this.store.get(id)
  }

  delete(id: string): boolean {
    const proc = this.procs.get(id)
    if (proc) {
      proc.kill()
      this.procs.delete(id)
    }
    const ok = this.store.delete(id)
    if (ok) {
      this.sse.publishGlobal({
        kind: 'session_deleted',
        sessionId: id,
        ts: Date.now(),
      })
    }
    return ok
  }

  create(opts: CreateSessionOpts): Session {
    const project = this.cfg.projects.find((p) => p.name === opts.projectName)
    if (!project) {
      throw new Error(`Unknown project: ${opts.projectName}`)
    }

    const now = Date.now()
    const id = randomUUID()
    const title = deriveTitle(opts.firstPrompt)
    const session: Session = {
      id,
      title,
      projectName: project.name,
      cwd: project.path,
      createdAt: now,
      lastActiveAt: now,
      transcript: [
        { kind: 'user', text: opts.firstPrompt, ts: now },
      ],
    }
    this.store.upsert(session)

    this.sse.publishGlobal({
      kind: 'session_created',
      sessionId: id,
      title,
      projectName: project.name,
      ts: now,
    })

    // Spawn the CLI now and send the first prompt. We hand the SseHub both
    // this user turn AND every event the CLI produces so the frontend sees a
    // complete transcript.
    this.sse.publishTranscript(id, session.transcript[0]!)
    const proc = this.ensureProc(session, { model: opts.model, resume: false })
    proc.send(opts.firstPrompt)

    return session
  }

  /**
   * Send a follow-up turn on an existing session. Lazy-spawn if needed.
   */
  send(id: string, text: string): void {
    const session = this.store.get(id)
    if (!session) throw new Error(`Unknown session: ${id}`)

    const ts = Date.now()
    const userEv: TranscriptEvent = { kind: 'user', text, ts }
    this.store.appendEvent(id, userEv)
    this.sse.publishTranscript(id, userEv)
    this.emitSidebarUpdate(session)

    // If the proc was reaped after the previous turn's result, spawn a fresh
    // one with --resume so the CLI picks up the same session id and context.
    const needsResume = !this.procs.has(id)
    const proc = this.ensureProc(session, { resume: needsResume })
    proc.send(text)
  }

  private ensureProc(
    session: Session,
    opts: { model?: string; resume?: boolean } = {},
  ): ClaudeCodeProc {
    let proc = this.procs.get(session.id)
    if (proc) return proc
    proc = new ClaudeCodeProc(
      {
        sessionId: session.id,
        cwd: session.cwd,
        claudeBinary: this.cfg.claudeBinary,
        model: opts.model,
        resume: opts.resume,
      },
      (ev) => this.handleProcEvent(session.id, ev),
    )
    this.procs.set(session.id, proc)
    proc.start()
    return proc
  }

  private handleProcEvent(sessionId: string, ev: TranscriptEvent): void {
    this.store.appendEvent(sessionId, ev)
    this.sse.publishTranscript(sessionId, ev)
    const session = this.store.get(sessionId)
    if (session) this.emitSidebarUpdate(session)

    // After a turn completes, drop our reference. The ClaudeCodeProc already
    // closed its stdin (see claudeProc.send), so the CLI exits on its own
    // with code 0 — no explicit kill needed. The next turn will lazily
    // spawn a fresh proc with --resume.
    if (ev.kind === 'result') {
      this.procs.delete(sessionId)
    }
  }

  private emitSidebarUpdate(session: Session): void {
    this.sse.publishGlobal({
      kind: 'session_updated',
      sessionId: session.id,
      title: session.title,
      lastActiveAt: session.lastActiveAt,
      ts: Date.now(),
    })
  }

  shutdown(): void {
    for (const proc of this.procs.values()) proc.kill()
    this.procs.clear()
    this.store.saveNow()
  }
}

function deriveTitle(firstPrompt: string): string {
  const clean = firstPrompt.replace(/\s+/g, ' ').trim()
  if (clean.length === 0) return 'New session'
  if (clean.length <= 40) return clean
  return clean.slice(0, 37) + '...'
}
