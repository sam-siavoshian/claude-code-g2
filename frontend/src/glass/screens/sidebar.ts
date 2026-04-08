import type { GlassScreen } from 'even-toolkit/glass-screen-router'
import { buildScrollableList } from 'even-toolkit/glass-display-builders'
import { moveHighlight } from 'even-toolkit/glass-nav'
import { glassHeader } from 'even-toolkit/types'
import { truncate } from 'even-toolkit/text-utils'
import type { AppSnapshot, AppActions } from '../shared'

const NEW_SESSION_LABEL = '+ New session'

function items(snapshot: AppSnapshot): string[] {
  const names = snapshot.sessions.map((s) => truncate(s.title, 28))
  names.push(NEW_SESSION_LABEL)
  return names
}

export const sidebarScreen: GlassScreen<AppSnapshot, AppActions> = {
  display(snapshot, nav) {
    const list = items(snapshot)
    const countLine = snapshot.sessions.length === 0
      ? 'No sessions yet'
      : `${snapshot.sessions.length} session${snapshot.sessions.length === 1 ? '' : 's'}`
    return {
      lines: [
        ...glassHeader('CLAUDE CODE G2', countLine),
        ...buildScrollableList({
          items: list,
          highlightedIndex: Math.min(nav.highlightedIndex, list.length - 1),
          maxVisible: 6,
          formatter: (item) => item,
        }),
      ],
    }
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
