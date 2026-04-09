import type { GlassScreen } from 'even-toolkit/glass-screen-router'
import { buildChatDisplay, type ChatLine } from 'even-toolkit/glass-chat-display'
import { truncate } from 'even-toolkit/text-utils'
import type { AppSnapshot, AppActions } from '../shared'
import type { TranscriptEvent } from '../../types'
import { footer, DOT_THINKING, DOT_IDLE } from '../theme'

// ChatLine cache keyed on the transcript array identity. The store creates
// a fresh array on every push, so we cache-miss once per event and cache-hit
// every render in between (4 Hz tick during recording, scroll, SSE, etc).
const chatLineCache = new WeakMap<TranscriptEvent[], ChatLine[]>()

function toChatLines(transcript: TranscriptEvent[]): ChatLine[] {
  const cached = chatLineCache.get(transcript)
  if (cached) return cached
  const out: ChatLine[] = []
  for (const ev of transcript) {
    switch (ev.kind) {
      case 'user':
        out.push({ type: 'prompt', text: ev.text })
        break
      case 'assistant_text':
        out.push({ type: 'text', text: ev.text })
        break
      case 'tool_use': {
        // Compact preview of the most useful tool args inline, like Claude
        // Code's terminal does: `Write(file.ts)`, `Bash(npm test)`.
        const inp = ev.input as Record<string, unknown> | null
        let suffix = ''
        if (inp && typeof inp === 'object') {
          const fp = inp.file_path ?? inp.path
          const cmd = inp.command
          const pat = inp.pattern
          if (typeof fp === 'string') suffix = '(' + fp.split('/').slice(-1)[0] + ')'
          else if (typeof cmd === 'string') suffix = '(' + truncate(cmd, 24) + ')'
          else if (typeof pat === 'string') suffix = '(' + truncate(pat, 24) + ')'
        }
        out.push({ type: 'tool', text: `${ev.name}${suffix}` })
        break
      }
      case 'tool_result':
        if (ev.isError) {
          out.push({ type: 'error', text: (ev.content || 'tool error').slice(0, 60) })
        }
        // Successful tool results are noisy on a 10-line HUD; the preceding
        // tool_use line already shows that the call was made.
        break
      case 'result':
        if (ev.isError) out.push({ type: 'error', text: 'turn failed' })
        // Don't render successful result events — the absence of a busy
        // indicator already tells the user the turn finished.
        break
      case 'error':
        out.push({ type: 'error', text: ev.message })
        break
    }
  }
  chatLineCache.set(transcript, out)
  return out
}

function headerTitle(snapshot: AppSnapshot): string {
  const active = snapshot.sessions.find((s) => s.id === snapshot.activeSessionId)
  return truncate(active?.title ?? 'session', 22)
}

export const sessionScreen: GlassScreen<AppSnapshot, AppActions> = {
  display(snapshot) {
    const chatLines = toChatLines(snapshot.transcript)
    const status = snapshot.activeBusy ? `${DOT_THINKING} thinking` : `${DOT_IDLE} ready`

    // contentSlots: 6 instead of the default 7 so we can append a persistent
    // input-prompt footer like a Claude Code terminal REPL line.
    const data = buildChatDisplay({
      title: headerTitle(snapshot),
      actionBar: status,
      chatLines,
      scrollOffset: snapshot.sessionScrollOffset,
      contentSlots: 6,
    })

    data.lines.push(footer(
      snapshot.activeBusy
        ? `${DOT_THINKING} working...`
        : '> tap to talk · 2tap back',
    ))
    return data
  },

  action(action, nav, snapshot, ctx) {
    if (action.type === 'HIGHLIGHT_MOVE') {
      // scrollOffset is measured from the bottom (0 = stick to latest), so
      // swiping UP shows older content (+1), swiping DOWN shows newer (-1).
      ctx.scrollTranscript(action.direction === 'up' ? 1 : -1)
      return nav
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      // Don't let the user start a new turn while Claude is still working —
      // it would race against the in-flight session.
      if (!snapshot.activeBusy) ctx.startTurnRecording()
      return nav
    }
    if (action.type === 'GO_BACK') {
      ctx.closeSession()
      return { ...nav, highlightedIndex: 0 }
    }
    return nav
  },
}
