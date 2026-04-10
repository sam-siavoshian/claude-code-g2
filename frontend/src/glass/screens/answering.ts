import type { GlassScreen } from 'even-toolkit/glass-screen-router'
import { buildScrollableList } from 'even-toolkit/glass-display-builders'
import { moveHighlight } from 'even-toolkit/glass-nav'
import type { AppSnapshot, AppActions } from '../shared'
import { line } from '../theme'

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  if (maxLen <= 1) return text.slice(0, maxLen)
  return text.slice(0, maxLen - 1) + '…'
}

// AskUserQuestion answer picker. Claude asked a question — user picks from
// the listed options or records a voice answer.
//
// ┌──────────────────────────────────────────┐
// │ ◆ CLAUDE ASKS:                            │
// │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
// │  Which database should I use?             │
// │                                           │
// │  [> PostgreSQL]                            │
// │     MySQL                                 │
// │     SQLite                                │
// │     voice answer                          │
// │ ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │
// │ tap: select · 2tap: skip                  │
// └──────────────────────────────────────────┘

export const answeringScreen: GlassScreen<AppSnapshot, AppActions> = {
  display(snapshot, nav) {
    const q = snapshot.pendingQuestion
    if (!q) {
      return { lines: [line('◆ no question'), line('', 'meta')] }
    }

    // Build the option list. Add "voice answer" at the end and "skip" too.
    const items = [...q.options, '🎤 voice answer', '× skip']

    const lines = [
      line('◆ CLAUDE ASKS:'),
      line('━'.repeat(40), 'meta'),
      line(`  ${truncate(q.text, 42)}`),
      line(''),
    ]

    lines.push(...buildScrollableList({
      items,
      highlightedIndex: Math.min(nav.highlightedIndex, items.length - 1),
      maxVisible: 4,
      formatter: (item) => item,
    }))

    while (lines.length < 9) lines.push(line(''))
    lines.push(line('tap: select · 2tap: skip', 'meta'))
    return { lines }
  },

  action(action, nav, snapshot, ctx) {
    const q = snapshot.pendingQuestion
    if (!q) return nav

    const items = [...q.options, '🎤 voice answer', '× skip']
    const max = items.length - 1

    if (action.type === 'HIGHLIGHT_MOVE') {
      return { ...nav, highlightedIndex: moveHighlight(nav.highlightedIndex, action.direction, max) }
    }

    if (action.type === 'SELECT_HIGHLIGHTED') {
      const idx = Math.min(nav.highlightedIndex, max)
      const selected = items[idx]!

      if (selected === '× skip') {
        // Skip — just go back to main, Claude will continue with default.
        ctx.cancelRecording()
        return { ...nav, highlightedIndex: 0 }
      }

      if (selected === '🎤 voice answer') {
        // Start recording a freeform voice answer.
        ctx.startTurnRecording()
        return { ...nav, highlightedIndex: 0 }
      }

      // Send the selected option as the answer.
      ctx.answerQuestion(selected)
      return { ...nav, highlightedIndex: 0 }
    }

    if (action.type === 'GO_BACK') {
      // Skip the question.
      ctx.cancelRecording()
      return { ...nav, highlightedIndex: 0 }
    }

    return nav
  },
}
