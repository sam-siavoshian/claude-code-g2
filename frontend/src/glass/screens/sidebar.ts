import type { GlassScreen } from 'even-toolkit/glass-screen-router'
import { buildScrollableList } from 'even-toolkit/glass-display-builders'
import { moveHighlight } from 'even-toolkit/glass-nav'
import { truncate } from 'even-toolkit/text-utils'
import type { AppSnapshot, AppActions } from '../shared'
import { brandedHeader, footer, padTo, line, CLAUDE_BRAND } from '../theme'

const NEW_SESSION_LABEL = '+ New session'
const VISIBLE = 5

function items(snapshot: AppSnapshot): string[] {
  const names = snapshot.sessions.map((s) => truncate(s.title, 36))
  names.push(NEW_SESSION_LABEL)
  return names
}

export const sidebarScreen: GlassScreen<AppSnapshot, AppActions> = {
  display(snapshot, nav) {
    const list = items(snapshot)
    const status = snapshot.sessions.length === 0
      ? 'ready'
      : `${snapshot.sessions.length} sess`
    const lines = [...brandedHeader(CLAUDE_BRAND, status)]

    if (snapshot.sessions.length === 0) {
      lines.push(line(''))
      lines.push(line('  no sessions yet', 'meta'))
      lines.push(line('  tap to start your first', 'meta'))
      lines.push(line(''))
    } else {
      lines.push(...buildScrollableList({
        items: list,
        highlightedIndex: Math.min(nav.highlightedIndex, list.length - 1),
        maxVisible: VISIBLE,
        formatter: (item) => item,
      }))
    }

    // Pad to 9 lines so the footer always lands on row 10.
    const padded = padTo(lines, 9)
    padded.push(footer('tap select · swipe · 2tap exit'))
    return { lines: padded }
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
        ctx.startNewRecording()
      } else {
        const session = snapshot.sessions[idx]
        if (session) ctx.openSessionById(session.id)
      }
      return { ...nav, highlightedIndex: 0 }
    }
    return nav
  },
}
