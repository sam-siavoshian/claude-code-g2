import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import * as readline from 'node:readline'
import type { TranscriptEvent } from './store.ts'

// Wraps `claude -p --input-format stream-json --output-format stream-json`.
// We use the CLI (not @anthropic-ai/claude-agent-sdk) because the SDK
// requires an ANTHROPIC_API_KEY, while the CLI bills against the user's
// Claude Max subscription via its existing login.
//
// Event shapes observed on claude CLI 2.1.94:
//   {type: "system", subtype: "init", session_id, tools, model, ...}
//   {type: "system", subtype: "hook_started"|"hook_response", ...}   ← ignored
//   {type: "assistant", message: {content: [{type: "text"|"tool_use", ...}]}, ...}
//   {type: "user",  message: {content: [{type: "tool_result", ...}]}, ...}
//   {type: "rate_limit_event", ...}                                   ← ignored
//   {type: "result", subtype, is_error, result, ...}
//
// Stdin accepts one JSON line per user turn:
//   {"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}

const DEFAULT_ALLOWED_TOOLS = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'Glob',
  'Grep',
  'WebSearch',
  'WebFetch',
]

const HUD_SYSTEM_PROMPT = [
  "You are running on the user's AR glasses HUD.",
  'The screen is 576x288 pixels, monochrome green, and fits roughly 10 short lines of text.',
  'Keep every assistant message SHORT: 1 to 3 sentences, no markdown headers, no bullet lists unless strictly necessary, no code blocks unless the user literally asked for code.',
  'Be decisive. Do not ask clarifying questions unless the request is truly ambiguous.',
  'When you complete an action, report what you did in one sentence.',
].join(' ')

export interface SpawnOptions {
  sessionId: string
  cwd: string
  claudeBinary: string
  model?: string // 'sonnet' | 'opus' | full id; defaults to sonnet
  resume?: boolean
}

export type ProcEventHandler = (ev: TranscriptEvent) => void

export class ClaudeCodeProc {
  private child: ChildProcessWithoutNullStreams | null = null
  private rl: readline.Interface | null = null
  public readonly sessionId: string
  private cwd: string
  private claudeBinary: string
  private model: string
  private onEvent: ProcEventHandler
  private resume: boolean
  // If the current run already emitted a `result` event, the subsequent
  // exit(0) is expected and we suppress the synthetic crash event.
  private sawResult = false

  constructor(opts: SpawnOptions, onEvent: ProcEventHandler) {
    this.sessionId = opts.sessionId
    this.cwd = opts.cwd
    this.claudeBinary = opts.claudeBinary
    this.model = opts.model ?? 'sonnet'
    this.resume = opts.resume ?? false
    this.onEvent = onEvent
  }

  start(): void {
    if (this.child) return
    const args = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--model', this.model,
      '--add-dir', this.cwd,
      '--permission-mode', 'acceptEdits',
      '--allowedTools', DEFAULT_ALLOWED_TOOLS.join(' '),
      '--append-system-prompt', HUD_SYSTEM_PROMPT,
      '--max-turns', '30',
      ...(this.resume ? ['--resume', this.sessionId] : ['--session-id', this.sessionId]),
    ]

    const env: NodeJS.ProcessEnv = {
      ...process.env, // let the CLI see its own auth files via HOME
    }

    this.child = spawn(this.claudeBinary, args, {
      cwd: this.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.rl = readline.createInterface({ input: this.child.stdout })
    this.rl.on('line', (line) => this.handleLine(line))

    this.child.stderr.on('data', (chunk) => {
      // The CLI sometimes prints warnings / update hints on stderr. Log but
      // do not propagate as a transcript event unless we know it's fatal.
      const text = chunk.toString()
      if (text.trim()) console.warn(`[claude:${this.sessionId.slice(0, 8)}] ${text.trim()}`)
    })

    this.child.on('error', (err) => {
      console.error(`[claude:${this.sessionId.slice(0, 8)}] spawn error:`, err)
      this.emitError(`Claude CLI spawn error: ${err.message}`)
    })

    this.child.on('exit', (code, signal) => {
      console.warn(`[claude:${this.sessionId.slice(0, 8)}] exited code=${code} signal=${signal}`)
      // Only emit a synthetic terminal event if the CLI exited abnormally AND
      // hadn't already produced a real `result` block for the current turn.
      if (!this.sawResult && code !== 0) {
        this.onEvent({
          kind: 'result',
          subtype: 'crashed',
          isError: true,
          ts: Date.now(),
        })
      }
      this.child = null
      this.rl?.close()
      this.rl = null
    })
  }

  // Send a user turn. Lazily starts the process if it hasn't been started yet.
  send(text: string): void {
    if (!this.child) {
      this.sawResult = false
      this.start()
    } else {
      this.sawResult = false
    }
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text }],
      },
    }) + '\n'
    try {
      this.child!.stdin.write(line)
    } catch (err) {
      console.error(`[claude:${this.sessionId.slice(0, 8)}] stdin write failed:`, err)
      this.emitError('Failed to send prompt to Claude CLI')
    }
  }

  kill(): void {
    if (!this.child) return
    try {
      this.child.kill('SIGTERM')
      const pid = this.child.pid
      setTimeout(() => {
        if (this.child && this.child.pid === pid) {
          try {
            this.child.kill('SIGKILL')
          } catch {
            /* noop */
          }
        }
      }, 2000)
    } catch {
      /* noop */
    }
  }

  // ---------------------------------------------------------------------------
  // Protocol parsing
  // ---------------------------------------------------------------------------

  private handleLine(line: string): void {
    const trimmed = line.trim()
    if (!trimmed) return
    // Trust-boundary parser: every field access below is defensively
    // checked, so `any` here avoids 30 narrowing guards for no benefit.
    let msg: any
    try {
      msg = JSON.parse(trimmed)
    } catch {
      // CLI sometimes emits non-JSON status lines. Safe to ignore.
      return
    }
    if (!msg || typeof msg !== 'object') return

    switch (msg.type) {
      case 'system':
        // We ignore system events except init (which we log for debugging).
        // Hooks and session metadata are noise for the glasses UI.
        if (msg.subtype === 'init') {
          // noop
        }
        return

      case 'assistant': {
        const content = msg.message?.content
        if (!Array.isArray(content)) return
        const ts = Date.now()
        for (const block of content) {
          if (!block || typeof block !== 'object') continue
          if (block.type === 'text' && typeof block.text === 'string' && block.text.length > 0) {
            this.onEvent({ kind: 'assistant_text', text: block.text, ts })
          } else if (block.type === 'tool_use' && typeof block.id === 'string') {
            this.onEvent({
              kind: 'tool_use',
              toolUseId: block.id,
              name: typeof block.name === 'string' ? block.name : 'unknown',
              input: block.input ?? null,
              ts,
            })
          }
          // thinking / other block types are intentionally ignored for the HUD
        }
        return
      }

      case 'user': {
        // The CLI echoes tool_result blocks back to us via a user message.
        const content = msg.message?.content
        if (!Array.isArray(content)) return
        const ts = Date.now()
        for (const block of content) {
          if (!block || typeof block !== 'object') continue
          if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
            this.onEvent({
              kind: 'tool_result',
              toolUseId: block.tool_use_id,
              content: stringifyToolResultContent(block.content),
              isError: Boolean(block.is_error),
              ts,
            })
          }
        }
        return
      }

      case 'result': {
        this.sawResult = true
        this.onEvent({
          kind: 'result',
          subtype: typeof msg.subtype === 'string' ? msg.subtype : 'success',
          isError: Boolean(msg.is_error),
          ts: Date.now(),
        })
        return
      }

      case 'rate_limit_event':
        // Ignored; we could surface this to the HUD later as a status badge.
        return

      default:
        return
    }
  }

  private emitError(message: string): void {
    this.onEvent({ kind: 'error', message, ts: Date.now() })
  }
}

// Tool results may be a string OR an array of content blocks; flatten to text.
function stringifyToolResultContent(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    const parts: string[] = []
    for (const b of content) {
      if (b && typeof b === 'object' && 'type' in b) {
        const block = b as { type: string; text?: string }
        if (block.type === 'text' && typeof block.text === 'string') {
          parts.push(block.text)
        }
      }
    }
    return parts.join('\n')
  }
  if (content == null) return ''
  try {
    return JSON.stringify(content)
  } catch {
    return String(content)
  }
}
