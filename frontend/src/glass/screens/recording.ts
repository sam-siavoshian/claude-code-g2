import type { GlassScreen } from 'even-toolkit/glass-screen-router'
import type { AppSnapshot, AppActions } from '../shared'
import { brandedHeader, footer, line, padTo, DOT_ACTIVE, DOT_THINKING } from '../theme'

function elapsedLabel(startedAt: number | null): string {
  if (startedAt == null) return '0.0s'
  return ((Date.now() - startedAt) / 1000).toFixed(1) + 's'
}

// One screen for the entire voice flow: recording-new, recording-turn,
// AND transcribing. The mode field on the snapshot decides what's shown.
export const recordingScreen: GlassScreen<AppSnapshot, AppActions> = {
  display(snapshot) {
    const isTranscribing = snapshot.mode === 'transcribing'
    const isNew = snapshot.mode === 'recording-new'

    const titleLeft = isTranscribing ? '* TRANSCRIBE' : '* LISTEN'
    const titleRight = isTranscribing
      ? 'whisper...'
      : (isNew ? 'new session' : 'follow-up')
    const lines = [...brandedHeader(titleLeft, titleRight)]

    // Big centered status block. We render with leading spaces because the
    // HUD font is proportional and we can't truly center, but ~6 spaces of
    // pad gives a balanced look at common phrase lengths.
    lines.push(line(''))
    if (isTranscribing) {
      lines.push(line(`      ${DOT_THINKING}  hearing you...`))
    } else {
      lines.push(line(`      ${DOT_ACTIVE}  ${elapsedLabel(snapshot.recordStartedAt)}`))
    }
    lines.push(line(''))

    const padded = padTo(lines, 9)
    padded.push(footer(
      isTranscribing
        ? 'please wait...'
        : 'tap stop · 2tap cancel',
    ))
    return { lines: padded }
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
