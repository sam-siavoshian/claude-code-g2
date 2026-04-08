import type { GlassScreen } from 'even-toolkit/glass-screen-router'
import { buildChatDisplay, type ChatLine } from 'even-toolkit/glass-chat-display'
import { truncate } from 'even-toolkit/text-utils'
import type { AppSnapshot, AppActions } from '../shared'
import type { TranscriptEvent } from '../../types'

// Cache ChatLine arrays by the TranscriptEvent array identity. The store
// creates a new array on every push, so we cache-miss once per event and
// cache-hit for every subsequent render (4 Hz ticks, scroll, etc.).
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
      case 'tool_use':
        out.push({ type: 'tool', text: ev.name })
        break
      case 'tool_result': {
        if (ev.isError) {
          out.push({ type: 'error', text: (ev.content || 'tool error').slice(0, 80) })
        }
        // Success tool results are noisy on a 10-line HUD; the preceding
        // tool_use line already shows the call was made.
        break
      }
      case 'result':
        if (ev.isError) out.push({ type: 'error', text: 'turn failed' })
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
  return truncate(active?.title ?? 'Session', 24)
}

export const sessionScreen: GlassScreen<AppSnapshot, AppActions> = {
  display(snapshot) {
    const chatLines = toChatLines(snapshot.transcript)
    const actionBar = snapshot.activeBusy ? 'thinking...' : 'Tap to talk'
    return buildChatDisplay({
      title: headerTitle(snapshot),
      actionBar,
      chatLines,
      scrollOffset: snapshot.sessionScrollOffset,
    })
  },

  action(action, nav, snapshot, ctx) {
    if (action.type === 'HIGHLIGHT_MOVE') {
      ctx.scrollTranscript(action.direction === 'down' ? -1 : 1)
      return nav
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
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
