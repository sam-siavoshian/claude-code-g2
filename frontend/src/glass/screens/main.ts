import type { GlassScreen } from 'even-toolkit/glass-screen-router'
import { line } from 'even-toolkit/types'
import { moveHighlight } from 'even-toolkit/glass-nav'
import type { AppSnapshot, AppActions } from '../shared'
import { buildSidebarItems } from '../splitView'

// The 'main' screen is rendered in split mode (toSplit) by useGlasses, so
// display() never actually fires for it. We still need to satisfy the screen
// router interface — it returns a stub.
//
// All gesture handling for the split layout lives here. The toolkit puts an
// invisible isEventCapture=1 overlay container on top of the split layout,
// which forwards every gesture to this action handler.

export const mainScreen: GlassScreen<AppSnapshot, AppActions> = {
  display() {
    return { lines: [line('split mode (rendered via toSplit)')] }
  },

  action(action, nav, snapshot, ctx) {
    const items = buildSidebarItems(snapshot)
    const max = items.length - 1
    if (max < 0) return nav

    if (action.type === 'HIGHLIGHT_MOVE') {
      return {
        ...nav,
        highlightedIndex: moveHighlight(nav.highlightedIndex, action.direction, max),
      }
    }

    if (action.type === 'SELECT_HIGHLIGHTED') {
      const idx = Math.min(nav.highlightedIndex, max)
      const item = items[idx]
      if (!item) return nav
      if (item.kind === 'new') {
        ctx.startNewRecording()
      } else if (item.id) {
        if (item.id === snapshot.activeSessionId) {
          // Tapping the already-active session starts a follow-up turn.
          if (!snapshot.activeBusy) ctx.startTurnRecording()
        } else {
          // Tapping a different session opens it.
          ctx.openSessionById(item.id)
        }
      }
      return nav
    }

    if (action.type === 'GO_BACK') {
      // Double-tap closes the active session if there is one. The sidebar
      // stays visible either way — there's no "exit to sidebar" anymore
      // because the sidebar is always present in split mode.
      if (snapshot.activeSessionId) ctx.closeSession()
      return nav
    }

    return nav
  },
}
