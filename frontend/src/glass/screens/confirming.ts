import type { GlassScreen } from 'even-toolkit/glass-screen-router'
import type { AppSnapshot, AppActions } from '../shared'
import { line } from '../theme'

// Voice confirmation — no auto-send. User is in control.
//
//   ◆ HEARD (new session):
//   "fix the pong test so it passes on CI"
//   tap: send · 2tap: cancel

export const confirmingScreen: GlassScreen<AppSnapshot, AppActions> = {
  display(snapshot) {
    const text = (snapshot.pendingTranscript ?? '').trim()
    const flow = snapshot.confirmTranscriptFlow
    const flowLabel = flow === 'new' ? 'new session' : 'follow-up'

    // Word-wrap to full width (~38 chars) with quote marks.
    const wrapped: string[] = []
    const words = text.split(/\s+/)
    let cur = ''
    for (const w of words) {
      if (cur.length + 1 + w.length > 36) {
        wrapped.push(cur)
        cur = w
      } else {
        cur = cur ? cur + ' ' + w : w
      }
    }
    if (cur) wrapped.push(cur)
    if (wrapped.length > 0) wrapped[0] = '"' + wrapped[0]
    const lastIdx = wrapped.length - 1
    if (lastIdx >= 0) wrapped[lastIdx] = wrapped[lastIdx]! + '"'

    const lines = [
      line(`◆ HEARD (${flowLabel}):`),
    ]
    // Show up to 7 lines of transcribed text — user sees exactly what will be sent
    for (const l of wrapped.slice(0, 7)) lines.push(line(l))

    while (lines.length < 9) lines.push(line(''))
    lines.push(line('tap: send · 2tap: cancel', 'meta'))
    return { lines }
  },

  action(action, nav, _snapshot, ctx) {
    if (action.type === 'SELECT_HIGHLIGHTED') {
      ctx.confirmTranscript()
      return nav
    }
    if (action.type === 'GO_BACK') {
      ctx.cancelTranscript()
      return nav
    }
    return nav
  },
}
