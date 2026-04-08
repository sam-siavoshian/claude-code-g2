import type { Response } from 'express'
import type { TranscriptEvent } from './sessions/store.ts'

// -----------------------------------------------------------------------------
// Server-Sent Events fan-out.
//
// Two channel types:
//   - per-session: "session:<id>"   — receives every transcript event for that id
//   - global:      "*"              — receives only coarse lifecycle events
//                                      (session_created, session_updated,
//                                       session_deleted) so the sidebar can
//                                       stay live without opening a stream per
//                                       session.
//
// The frontend opens one global EventSource plus one per-session EventSource
// for whichever session is in focus.
// -----------------------------------------------------------------------------

export type GlobalEvent =
  | { kind: 'session_created'; sessionId: string; title: string; projectName: string; ts: number }
  | { kind: 'session_updated'; sessionId: string; title: string; lastActiveAt: number; ts: number }
  | { kind: 'session_deleted'; sessionId: string; ts: number }

export type SseEvent =
  | { kind: 'transcript'; sessionId: string; event: TranscriptEvent }
  | { kind: 'global'; event: GlobalEvent }

type Subscriber = {
  res: Response
  channel: string
}

export class SseHub {
  private subs = new Set<Subscriber>()
  private heartbeatTimer: ReturnType<typeof setInterval>

  constructor() {
    // Keep idle connections alive through proxies (Cloudflare tunnel idle is
    // generally ~100s; 15s comment heartbeats are well inside that window).
    this.heartbeatTimer = setInterval(() => {
      for (const sub of this.subs) {
        try {
          sub.res.write(': ping\n\n')
        } catch {
          // the response is gone; it'll be cleaned up by the 'close' handler
        }
      }
    }, 15_000)
  }

  subscribe(channel: string, res: Response): () => void {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()
    res.write('retry: 3000\n\n')

    const sub: Subscriber = { res, channel }
    this.subs.add(sub)

    const cleanup = () => {
      this.subs.delete(sub)
    }
    res.on('close', cleanup)
    res.on('finish', cleanup)
    return cleanup
  }

  publishTranscript(sessionId: string, event: TranscriptEvent): void {
    const payload: SseEvent = { kind: 'transcript', sessionId, event }
    const data = `data: ${JSON.stringify(payload)}\n\n`
    for (const sub of this.subs) {
      if (sub.channel === `session:${sessionId}` || sub.channel === '*') {
        try {
          sub.res.write(data)
        } catch {
          /* cleanup handled by close handler */
        }
      }
    }
  }

  publishGlobal(ev: GlobalEvent): void {
    const payload: SseEvent = { kind: 'global', event: ev }
    const data = `data: ${JSON.stringify(payload)}\n\n`
    for (const sub of this.subs) {
      if (sub.channel === '*') {
        try {
          sub.res.write(data)
        } catch {
          /* noop */
        }
      }
    }
  }

  close(): void {
    clearInterval(this.heartbeatTimer)
    for (const sub of this.subs) {
      try {
        sub.res.end()
      } catch {
        /* noop */
      }
    }
    this.subs.clear()
  }
}
