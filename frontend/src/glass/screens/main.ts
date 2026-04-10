import type { GlassScreen } from 'even-toolkit/glass-screen-router'
import { line, separator } from 'even-toolkit/types'
import { moveHighlight } from 'even-toolkit/glass-nav'
import type { AppSnapshot, AppActions } from '../shared'
import { buildSidebarItems } from '../splitView'
import type { TranscriptEvent } from '../../types'

// Full width on 576px display. LVGL proportional font at 22px with 12px
// padding each side = 552px usable. Average char ~12-13px = ~44 chars.
const FULL_COLS = 44

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  if (maxLen <= 1) return text.slice(0, maxLen)
  return text.slice(0, maxLen - 1) + '…'
}

function basename(raw: unknown): string {
  if (typeof raw !== 'string') return '?'
  return raw.split('/').pop() ?? raw
}

function wrapText(text: string, width: number, prefix = ''): string[] {
  const words = text.replace(/\s+/g, ' ').trim().split(' ')
  if (words.length === 0 || (words.length === 1 && words[0] === '')) return ['']
  const indent = ' '.repeat(prefix.length)
  const out: string[] = []
  let cur = ''
  let isFirst = true
  for (const w of words) {
    const pfx = isFirst ? prefix : indent
    const room = width - pfx.length
    if (cur.length === 0) {
      cur = w.length <= room ? w : w.slice(0, room)
      continue
    }
    if (cur.length + 1 + w.length <= room) {
      cur += ' ' + w
    } else {
      out.push(pfx + cur)
      isFirst = false
      cur = w.length <= width - indent.length ? w : w.slice(0, width - indent.length)
    }
  }
  if (cur) out.push((isFirst ? prefix : indent) + cur)
  return out
}

function humanToolProgress(name: string, input: unknown): string {
  const inp = input as Record<string, unknown> | null
  switch (name) {
    case 'Read': return `Reading ${basename(inp?.file_path ?? inp?.path)}…`
    case 'Write': return `Writing ${basename(inp?.file_path)}…`
    case 'Edit': return `Editing ${basename(inp?.file_path)}…`
    case 'Bash': return `Running: ${truncate(String(inp?.command ?? '…'), 30)}`
    case 'Grep': return `Searching ${truncate(String(inp?.pattern ?? ''), 28)}…`
    case 'Glob': return `Finding ${truncate(String(inp?.pattern ?? ''), 28)}…`
    default: return `Running ${name}…`
  }
}

function transcriptToLines(transcript: TranscriptEvent[]): string[] {
  const out: string[] = []
  for (const ev of transcript) {
    switch (ev.kind) {
      case 'user':
        out.push(...wrapText(ev.text, FULL_COLS, '> '))
        break
      case 'assistant_text':
        out.push(...wrapText(ev.text, FULL_COLS, '│ '))
        break
      case 'tool_use': {
        const inp = ev.input as Record<string, unknown> | null
        let suffix = ''
        if (inp && typeof inp === 'object') {
          const fp = inp.file_path ?? inp.path
          const cmd = inp.command
          const pat = inp.pattern
          if (typeof fp === 'string') suffix = '(' + basename(fp) + ')'
          else if (typeof cmd === 'string') suffix = '(' + truncate(cmd, 28) + ')'
          else if (typeof pat === 'string') suffix = '(' + truncate(pat, 28) + ')'
        }
        out.push(`>> ${ev.name}${suffix}`)
        break
      }
      case 'tool_result':
        if (ev.isError) {
          out.push(...wrapText('! ' + (ev.content || 'error'), FULL_COLS))
        } else if (ev.content) {
          const firstLine = ev.content.split('\n').find((l) => l.trim().length > 0)
          if (firstLine) out.push(`  ${truncate(firstLine.trim(), FULL_COLS - 2)}`)
        }
        break
      case 'result':
        if (ev.isError) out.push('! turn failed')
        break
      case 'error':
        out.push(...wrapText('! ' + ev.message, FULL_COLS))
        break
    }
  }
  return out
}

// Full-screen sidebar overlay: session list fills the whole display.
function renderSidebar(snapshot: AppSnapshot, nav: { highlightedIndex: number }): { lines: ReturnType<typeof line>[] } {
  const items = buildSidebarItems(snapshot)
  const lines = [
    line(`◆ ${snapshot.sessions.length} session${snapshot.sessions.length === 1 ? '' : 's'}`, 'meta'),
    separator(),
  ]

  const max = items.length - 1
  const highlighted = Math.min(nav.highlightedIndex, max)

  for (let i = 0; i < items.length; i++) {
    const item = items[i]!
    if (item.kind === 'new') {
      lines.push(line(i === highlighted ? '[+ new session]' : ' + new session'))
      continue
    }
    const dot = item.isActive ? '●' : (item.busy ? '◐' : '○')
    const label = truncate(item.label, 38)
    if (i === highlighted) {
      lines.push(line(`[${dot} ${label}]`))
    } else {
      lines.push(line(` ${dot} ${label}`))
    }
  }

  // Pad to 9 lines, action hint at bottom
  while (lines.length < 9) lines.push(line(''))
  lines.push(line('tap: open · 2tap: delete/back', 'meta'))

  return { lines: lines.slice(0, 10) }
}

// Delete confirmation takes over the display.
function renderDeleteConfirm(snapshot: AppSnapshot): { lines: ReturnType<typeof line>[] } | null {
  const ca = snapshot.confirmAction
  if (!ca || Date.now() >= ca.expiresAt) return null
  const remaining = Math.ceil((ca.expiresAt - Date.now()) / 1000)
  return {
    lines: [
      line(`Delete "${truncate(ca.title, 34)}"?`),
      separator(),
      line('This cannot be undone.'),
      line(''),
      line('tap: DELETE · 2tap: cancel', 'meta'),
      line(`auto-cancel ${remaining}s…`, 'meta'),
    ],
  }
}

// Scroll bar: 7-char bar showing position in transcript.
// Uses ░ for track and ▓ for thumb. Shows direction arrows at edges.
// Examples:
//   At bottom (newest):  ░░░░░▓▓   (thumb at right/bottom)
//   At top (oldest):     ▓▓░░░░░   (thumb at left/top)
//   Middle:              ░░▓▓░░░
//   No scroll needed:    (empty string)
function scrollBar(totalLines: number, visibleLines: number, offset: number): string {
  if (totalLines <= visibleLines) return ''
  const barLen = 7
  const maxOffset = totalLines - visibleLines
  const clampedOffset = Math.min(offset, maxOffset)
  // offset=0 means viewing newest (bottom). Bar reads left=top, right=bottom.
  // So offset=0 → thumb at right end, offset=max → thumb at left end.
  const ratio = maxOffset > 0 ? clampedOffset / maxOffset : 0
  const thumbSize = Math.max(1, Math.round((visibleLines / totalLines) * barLen))
  // ratio=0 (bottom/newest) → thumbStart near right. ratio=1 (top/oldest) → thumbStart=0.
  const thumbStart = Math.round((1 - ratio) * (barLen - thumbSize))
  let bar = ''
  for (let i = 0; i < barLen; i++) {
    if (i >= thumbStart && i < thumbStart + thumbSize) bar += '▓'
    else bar += '░'
  }
  // Direction arrows: ▲ if can scroll up (older), ▼ if can scroll down (newer)
  const canUp = clampedOffset < maxOffset
  const canDown = clampedOffset > 0
  const arrows = (canUp ? '▲' : ' ') + (canDown ? '▼' : ' ')
  return `${arrows} ${bar}`
}

// Full-screen transcript renderer — 576px wide, ~38 chars/line, 7 content lines.
function renderTranscript(snapshot: AppSnapshot): { lines: ReturnType<typeof line>[] } {
  const active = snapshot.sessions.find((s) => s.id === snapshot.activeSessionId)
  const lines = []

  // Transcript body lines (computed first so we can build the scroll bar)
  const allLines = transcriptToLines(snapshot.transcript)
  const VISIBLE = 7
  const totalLines = allLines.length
  const maxOffset = Math.max(0, totalLines - VISIBLE)
  const offset = Math.min(snapshot.sessionScrollOffset, maxOffset)
  const startLine = Math.max(0, totalLines - VISIBLE - offset)
  const visible = allLines.slice(startLine, startLine + VISIBLE)

  // Scroll bar for the header
  const bar = scrollBar(totalLines, VISIBLE, offset)

  // Header: session title + status + scroll bar
  // When busy: ◐ spinning indicator + tool progress
  // When done: ✓ DONE prominently in header — unmissable signal to talk again
  if (snapshot.error) {
    lines.push(line(`◆ ! ${truncate(snapshot.error, 40)}`))
  } else if (active && snapshot.activeBusy) {
    const lastTool = [...snapshot.transcript].reverse().find((e) => e.kind === 'tool_use')
    const status = lastTool && lastTool.kind === 'tool_use'
      ? humanToolProgress(lastTool.name, lastTool.input)
      : 'thinking…'
    lines.push(line(`◐ ${truncate(active.title, 16)} · ${truncate(status, 16)} ${bar}`))
  } else if (active) {
    // Check if Claude just finished (last event is a 'result')
    const lastEvent = snapshot.transcript[snapshot.transcript.length - 1]
    const justFinished = lastEvent?.kind === 'result' && !lastEvent.isError
    const prefix = justFinished ? '✓ DONE' : '◆'
    const titleLen = bar ? (justFinished ? 24 : 30) : (justFinished ? 34 : 40)
    lines.push(line(`${prefix} ${truncate(active.title, titleLen)} ${bar}`))
  } else {
    lines.push(line('◆ CLAUDE CODE'))
  }
  lines.push(separator())

  for (const l of visible) lines.push(line(l))

  // Pad to 9, action hint at line 10
  while (lines.length < 9) lines.push(line(''))

  // Bottom hint: unmistakable state signal.
  // BUSY:  "◐ claude is working…" — don't interrupt
  // DONE:  "✓ tap to talk" — your turn, go ahead
  // IDLE:  "tap to talk · 2tap: menu" — ready
  let hint: string
  if (snapshot.activeBusy) {
    hint = '◐ claude is working… · 2tap: menu'
  } else {
    const lastEvent = snapshot.transcript[snapshot.transcript.length - 1]
    const justFinished = lastEvent?.kind === 'result' && !lastEvent.isError
    hint = justFinished
      ? '✓ tap to talk · 2tap: menu'
      : 'tap to talk · 2tap: menu'
  }
  lines.push(line(hint, 'meta'))

  return { lines: lines.slice(0, 10) }
}

export const mainScreen: GlassScreen<AppSnapshot, AppActions> = {
  display(snapshot, nav) {
    // Delete confirmation modal overrides everything.
    const deleteModal = renderDeleteConfirm(snapshot)
    if (deleteModal) return deleteModal

    // Sidebar overlay mode.
    if (snapshot.sidebarVisible || !snapshot.activeSessionId) {
      return renderSidebar(snapshot, nav)
    }

    // Full-screen transcript.
    return renderTranscript(snapshot)
  },

  action(action, nav, snapshot, ctx) {
    // Delete confirmation intercepts all actions.
    if (snapshot.confirmAction && Date.now() < snapshot.confirmAction.expiresAt) {
      if (action.type === 'SELECT_HIGHLIGHTED') { ctx.confirmPendingAction(); return nav }
      if (action.type === 'GO_BACK') { ctx.cancelPendingAction(); return nav }
      return nav
    }

    // SIDEBAR MODE: browsing sessions
    if (snapshot.sidebarVisible || !snapshot.activeSessionId) {
      const items = buildSidebarItems(snapshot)
      const max = items.length - 1
      if (max < 0) return nav

      if (action.type === 'HIGHLIGHT_MOVE') {
        return { ...nav, highlightedIndex: moveHighlight(nav.highlightedIndex, action.direction, max) }
      }

      if (action.type === 'SELECT_HIGHLIGHTED') {
        const idx = Math.min(nav.highlightedIndex, max)
        const item = items[idx]
        if (!item) return nav
        if (item.kind === 'new') {
          ctx.startNewRecording()
        } else if (item.id) {
          ctx.openSessionById(item.id)
        }
        return nav
      }

      if (action.type === 'GO_BACK') {
        const idx = Math.min(nav.highlightedIndex, max)
        const item = items[idx]
        // 2tap on session = delete
        if (item && item.kind === 'session' && item.id) {
          if (item.isActive) ctx.closeSession()
          ctx.requestDeleteConfirmation(item.id, item.label)
          return nav
        }
        // 2tap on [+ new] or empty = go back to transcript
        if (snapshot.activeSessionId) {
          ctx.hideSidebar()
        }
        return nav
      }
      return nav
    }

    // TRANSCRIPT MODE: viewing active session
    if (action.type === 'HIGHLIGHT_MOVE') {
      // Swipe up/down = scroll transcript, 5 lines per swipe
      const delta = action.direction === 'down' ? 5 : -5
      ctx.scrollTranscript(delta)
      return nav
    }

    if (action.type === 'SELECT_HIGHLIGHTED') {
      // Tap = start follow-up recording (only if Claude isn't busy)
      if (!snapshot.activeBusy) ctx.startTurnRecording()
      return nav
    }

    if (action.type === 'GO_BACK') {
      // 2tap while scrolled up = jump to bottom
      if (snapshot.sessionScrollOffset > 0) {
        ctx.scrollTranscript(-snapshot.sessionScrollOffset)
        return nav
      }
      // 2tap at bottom = open sidebar overlay
      ctx.showSidebar()
      return nav
    }

    return nav
  },
}
