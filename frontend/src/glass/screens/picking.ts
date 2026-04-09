import type { GlassScreen } from 'even-toolkit/glass-screen-router'
import { buildScrollableList } from 'even-toolkit/glass-display-builders'
import { moveHighlight } from 'even-toolkit/glass-nav'
import { truncate } from 'even-toolkit/text-utils'
import type { AppSnapshot, AppActions } from '../shared'
import { brandedHeader, footer, padTo, line } from '../theme'

const CANCEL_LABEL = '× cancel'

function items(snapshot: AppSnapshot): string[] {
  return [...snapshot.projects, CANCEL_LABEL]
}

export const pickingScreen: GlassScreen<AppSnapshot, AppActions> = {
  display(snapshot, nav) {
    const list = items(snapshot)
    const lines = [...brandedHeader('* PICK PROJECT', `${snapshot.projects.length} dirs`)]

    // Show what Whisper heard so the user can sanity-check before committing.
    const heard = (snapshot.pendingTranscript ?? '').trim()
    if (heard) {
      lines.push(line(`> ${truncate(heard, 38)}`, 'meta'))
    }

    lines.push(...buildScrollableList({
      items: list,
      highlightedIndex: Math.min(nav.highlightedIndex, list.length - 1),
      maxVisible: 5,
      formatter: (item) => item,
    }))

    const padded = padTo(lines, 9)
    padded.push(footer('tap select · 2tap cancel'))
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
