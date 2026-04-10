import type { GlassScreen } from 'even-toolkit/glass-screen-router'
import type { AppSnapshot, AppActions } from '../shared'
import { line } from '../theme'

function elapsedSec(startedAt: number | null): string {
  if (startedAt == null) return '0s'
  return Math.round((Date.now() - startedAt) / 1000) + 's'
}

function spinDots(): string {
  const frames = ['·  ', '·· ', '···', ' ··', '  ·', '   ']
  return frames[Math.floor(Date.now() / 250) % frames.length]!
}

// Minimal recording screen. Every line earns its pixels.
//
// RECORDING:    ● REC 4s · new session
//               speak now
//               tap: stop · 2tap: cancel
//
// TRANSCRIBING: ◐ WHISPER ··· 6s
//               transcribing…
//               2tap: cancel

export const recordingScreen: GlassScreen<AppSnapshot, AppActions> = {
  display(snapshot) {
    const isTranscribing = snapshot.mode === 'transcribing'
    const isNew = snapshot.mode === 'recording-new'
    const elapsed = elapsedSec(snapshot.recordStartedAt)

    if (isTranscribing) {
      const elapsedNum = snapshot.recordStartedAt
        ? Math.round((Date.now() - snapshot.recordStartedAt) / 1000)
        : 0
      const msg = elapsedNum > 10 ? 'taking longer than usual…' : 'transcribing…'
      return {
        lines: [
          line(`◐ WHISPER ${spinDots()} ${elapsed}`),
          line(msg),
          line('2tap: cancel', 'meta'),
        ],
      }
    }

    const context = isNew ? 'new session' : 'follow-up'
    return {
      lines: [
        line(`● REC ${elapsed} · ${context}`),
        line('speak now'),
        line('tap: stop · 2tap: cancel', 'meta'),
      ],
    }
  },

  action(action, nav, snapshot, ctx) {
    if (action.type === 'GO_BACK') {
      ctx.cancelRecording()
      return { ...nav, highlightedIndex: 0 }
    }
    if (action.type === 'SELECT_HIGHLIGHTED') {
      if (snapshot.mode === 'transcribing') return nav
      if (snapshot.mode === 'recording-new') ctx.stopNewRecordingAndTranscribe()
      else if (snapshot.mode === 'recording-turn') ctx.stopTurnRecordingAndSend()
      return nav
    }
    return nav
  },
}
