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

function items(snapshot: AppSnapshot): string[] {
  return [...snapshot.projects, '× cancel']
}

export const pickingScreen: GlassScreen<AppSnapshot, AppActions> = {
  display(snapshot, nav) {
    const list = items(snapshot)
    const lines = []

    // Compact header: what Whisper heard + project count
    const heard = (snapshot.pendingTranscript ?? '').trim()
    lines.push(line(`PICK PROJECT  ${list.length - 1} dirs`, 'meta'))
    lines.push(line('━'.repeat(40), 'meta'))
    if (heard) {
      lines.push(line(`> ${truncate(heard, 38)}`))
    }

    lines.push(...buildScrollableList({
      items: list,
      highlightedIndex: Math.min(nav.highlightedIndex, list.length - 1),
      maxVisible: 5,
      formatter: (item) => item,
    }))

    // Fill to 10 lines, put action hint at bottom
    while (lines.length < 9) lines.push(line(''))
    lines.push(line('tap: select · 2tap: cancel', 'meta'))
    return { lines }
  },

  action(action, nav, snapshot, ctx) {
    const list = items(snapshot)
    const max = list.length - 1
    if (action.type === 'HIGHLIGHT_MOVE') {
      return { ...nav, highlightedIndex: moveHighlight(nav.highlightedIndex, action.direction, max) }
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      const idx = Math.min(nav.highlightedIndex, max)
      if (idx === max) {
        ctx.cancelRecording()
      } else {
        const name = snapshot.projects[idx]
        if (name) ctx.pickProject(name)
      }
      return { ...nav, highlightedIndex: 0 }
    }
    if (action.type === 'GO_BACK') {
      ctx.cancelRecording()
      return { ...nav, highlightedIndex: 0 }
    }
    return nav
  },
}
