import type { GlassScreen } from 'even-toolkit/glass-screen-router'
import { buildScrollableList } from 'even-toolkit/glass-display-builders'
import { moveHighlight } from 'even-toolkit/glass-nav'
import { glassHeader } from 'even-toolkit/types'
import { truncate } from 'even-toolkit/text-utils'
import type { AppSnapshot, AppActions } from '../shared'

const CANCEL_LABEL = '× Cancel'

function items(snapshot: AppSnapshot): string[] {
  return [...snapshot.projects, CANCEL_LABEL]
}

function headerText(snapshot: AppSnapshot): string {
  const t = (snapshot.pendingTranscript ?? '').trim()
  if (!t) return 'PICK PROJECT'
  return truncate(t, 32)
}

export const pickingScreen: GlassScreen<AppSnapshot, AppActions> = {
  display(snapshot, nav) {
    const list = items(snapshot)
    return {
      lines: [
        ...glassHeader(headerText(snapshot), 'Choose a project'),
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
