import { line, separator, type DisplayLine, glassHeader } from 'even-toolkit/types'
import { truncate } from 'even-toolkit/text-utils'

// Claude Code terminal look translated to the 576x288 HUD.
//
// Visual vocabulary shared across every screen:
//   * CLAUDE CODE            persistent brand prefix in the header
//   >                        user prompt  (buildChatDisplay already does this)
//   >>                       tool call    (buildChatDisplay already does this)
//   ● / ◐ / ○                status indicators
//   ━━━                      solid separator
//
// Lines / slots budget on the G2 HUD:
//   10 total text lines
//    3 lines taken by glassHeader (title + separator + gap)
//    1 line reserved for a persistent footer
//    6 lines of scrollable content
//
// We keep headers and footers consistent across screens so mode transitions
// feel like different panels of the same app, not different apps.

export const CLAUDE_BRAND = '* CLAUDE CODE'
export const DOT_ACTIVE = '●'
export const DOT_THINKING = '◐'
export const DOT_IDLE = '○'

// Compose a header with the Claude brand and an optional right-side status.
export function brandedHeader(title: string, status = ''): DisplayLine[] {
  // glassHeader takes (title, actionBar). Cap both so they don't overflow.
  const cappedTitle = truncate(title, 24)
  const cappedStatus = truncate(status, 16)
  return glassHeader(cappedTitle, cappedStatus)
}

// A 1-line divider with bolder rule characters than the default separator.
export function rule(): DisplayLine {
  return line('━'.repeat(40), 'meta')
}

// Persistent footer hint, always meta-styled.
export function footer(hint: string): DisplayLine {
  return line(truncate(hint, 40), 'meta')
}

// Pad the body to a fixed number of lines so the footer always lands on the
// same visual row regardless of content length.
export function padTo(lines: DisplayLine[], total: number): DisplayLine[] {
  const out = [...lines]
  while (out.length < total) out.push(line(''))
  return out.slice(0, total)
}

export { line, separator }
