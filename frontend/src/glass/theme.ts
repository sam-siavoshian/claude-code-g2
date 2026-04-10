import { line, separator, type DisplayLine, glassHeader } from 'even-toolkit/types'
import { truncate } from 'even-toolkit/text-utils'

// HUD visual vocabulary — spacecraft instrument panel.
//
// Every character is deliberate. Zero decoration.
//   ●  active / recording
//   ◐  processing (whisper, thinking)
//   ○  idle
//   ▓░ VU meter blocks
//   │  assistant text prefix
//   >  user text prefix / cursor
//   >> tool call
//   !  error
//   ━  separator

export const DOT_ACTIVE = '●'
export const DOT_THINKING = '◐'
export const DOT_IDLE = '○'

// Compose a header with the Claude brand and an optional right-side status.
export function brandedHeader(title: string, status = ''): DisplayLine[] {
  const cappedTitle = truncate(title, 24)
  const cappedStatus = truncate(status, 16)
  return glassHeader(cappedTitle, cappedStatus)
}

// A 1-line divider.
export function rule(): DisplayLine {
  return line('━'.repeat(40), 'meta')
}

// Persistent footer hint, meta-styled.
export function footer(hint: string): DisplayLine {
  return line(truncate(hint, 40), 'meta')
}

// Pad body to a fixed number of lines so the footer lands on the same row.
export function padTo(lines: DisplayLine[], total: number): DisplayLine[] {
  const out = [...lines]
  while (out.length < total) out.push(line(''))
  return out.slice(0, total)
}

export { line, separator }
