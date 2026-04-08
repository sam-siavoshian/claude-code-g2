import type { GlassScreen } from 'even-toolkit/glass-screen-router'
import { line, separator } from 'even-toolkit/types'
import type { AppSnapshot, AppActions } from '../shared'

function elapsedLabel(startedAt: number | null): string {
  if (startedAt == null) return '0.0s'
  return ((Date.now() - startedAt) / 1000).toFixed(1) + 's'
}

export const recordingScreen: GlassScreen<AppSnapshot, AppActions> = {
  display(snapshot) {
    if (snapshot.mode === 'transcribing') {
      return {
        lines: [
          line('TRANSCRIBING', 'meta'),
          separator(),
          line(''),
          line('Listening to Whisper...'),
          line(''),
          line('(2-5 seconds)', 'meta'),
        ],
      }
    }
    const title = snapshot.mode === 'recording-new' ? 'NEW SESSION' : 'FOLLOW-UP TURN'
    return {
      lines: [
        line(title, 'meta'),
        separator(),
        line(''),
        line('Listening... ' + elapsedLabel(snapshot.recordStartedAt)),
        line(''),
        line('Tap to stop', 'meta'),
        line('Double-tap to cancel', 'meta'),
      ],
    }
  },

  action(action, nav, snapshot, ctx) {
    if (snapshot.mode === 'transcribing') return nav
    if (action.type === 'SELECT_HIGHLIGHTED') {
      if (snapshot.mode === 'recording-new') ctx.stopNewRecordingAndTranscribe()
      else if (snapshot.mode === 'recording-turn') ctx.stopTurnRecordingAndSend()
      return nav
    }
    if (action.type === 'GO_BACK') {
      ctx.cancelRecording()
      return { ...nav, highlightedIndex: 0 }
    }
    return nav
  },
}
