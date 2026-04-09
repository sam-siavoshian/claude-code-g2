import type { SplitData, GlassNavState } from 'even-toolkit/types'
import type { AppSnapshot } from './shared'
import type { TranscriptEvent } from '../types'

// truncate() in even-toolkit/text-utils appends '~' which looks like part of
// the word in a proportional font. Roll our own with a real ellipsis.
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  if (maxLen <= 1) return text.slice(0, maxLen)
  return text.slice(0, maxLen - 1) + '…'
}

// -----------------------------------------------------------------------------
// Split-view renderer for the 'main' screen.
//
// IMPORTANT: the G2 LVGL font is PROPORTIONAL, so we can't right-align with
// spaces or pad columns to fixed widths. Every alignment trick that worked on
// my fixed-width unit tests came out broken on real hardware. This file
// deliberately uses no padding tricks — just one short line of text per row,
// with markers that read clearly in a proportional font.
//
// Layout (576x288):
//
//   ┌─────────┬───────────────────────────────────────┐  40px header
//   │ * CLAUDE                <session title> · ready │
//   ├─────────┼───────────────────────────────────────┤
//   │ > sess  │ > make a hello.txt file               │
//   │   sess  │ I'll do that.                         │  248px
//   │ * sess  │ >> Write(hello.txt)                   │  panes
//   │   sess  │ done.                                 │
//   │         │                                       │
//   │ [+] new │ > tap to talk                         │
//   └─────────┴───────────────────────────────────────┘
//      180px                  396px
//
// Markers:
//   "> "    cursor on this row (highlighted by user)
//   "* "    this row is the currently active session
//   "  "    nothing
//   "[+]"   the new-session button (last row)
// -----------------------------------------------------------------------------

const SIDEBAR_W = 180
const HEADER_H = 40
const SIDEBAR_LABEL_LEN = 11
const RIGHT_COLS = 28

export interface SidebarItem {
  kind: 'session' | 'new'
  id?: string
  label: string
  isActive?: boolean
}

export function buildSidebarItems(snapshot: AppSnapshot): SidebarItem[] {
  const items: SidebarItem[] = snapshot.sessions.map((s) => ({
    kind: 'session',
    id: s.id,
    label: s.title,
    isActive: s.id === snapshot.activeSessionId,
  }))
  items.push({ kind: 'new', label: 'new' })
  return items
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

function transcriptToLines(transcript: TranscriptEvent[]): string[] {
  const out: string[] = []
  for (const ev of transcript) {
    switch (ev.kind) {
      case 'user':
        out.push(...wrapText(ev.text, RIGHT_COLS, '> '))
        break
      case 'assistant_text':
        out.push(...wrapText(ev.text, RIGHT_COLS))
        break
      case 'tool_use': {
        const inp = ev.input as Record<string, unknown> | null
        let suffix = ''
        if (inp && typeof inp === 'object') {
          const fp = inp.file_path ?? inp.path
          const cmd = inp.command
          const pat = inp.pattern
          if (typeof fp === 'string') suffix = '(' + (fp.split('/').pop() ?? fp) + ')'
          else if (typeof cmd === 'string') suffix = '(' + truncate(cmd, 14) + ')'
          else if (typeof pat === 'string') suffix = '(' + truncate(pat, 14) + ')'
        }
        out.push(`>> ${ev.name}${suffix}`)
        break
      }
      case 'tool_result':
        if (ev.isError) out.push(...wrapText('! ' + (ev.content || 'error'), RIGHT_COLS))
        break
      case 'result':
        if (ev.isError) out.push('! turn failed')
        break
      case 'error':
        out.push(...wrapText('! ' + ev.message, RIGHT_COLS))
        break
    }
  }
  return out
}

function buildHeader(snapshot: AppSnapshot): string {
  // Two short lines. No right-alignment, no padding.
  // Line 1: brand. Line 2: active session title or "ready".
  const brand = '* CLAUDE CODE'
  const status = snapshot.activeBusy ? 'thinking...' : 'ready'
  const active = snapshot.sessions.find((s) => s.id === snapshot.activeSessionId)
  if (active) {
    return `${brand}\n${truncate(active.title, 26)} · ${status}`
  }
  return `${brand}\n${status}`
}

function buildLeftPane(items: SidebarItem[], highlightedIndex: number): string {
  const sessionItems = items.filter((i) => i.kind === 'session')

  // Sliding window centered on the highlighted item, capped at 8 visible.
  const VISIBLE = 8
  const visibleSlots = Math.min(VISIBLE, sessionItems.length)
  const start = Math.max(
    0,
    Math.min(
      Math.max(0, sessionItems.length - visibleSlots),
      highlightedIndex - Math.floor(visibleSlots / 2),
    ),
  )
  const slice = sessionItems.slice(start, start + visibleSlots)

  const rows: string[] = []
  for (let i = 0; i < slice.length; i++) {
    const idx = start + i
    const item = slice[i]!
    const isHighlighted = idx === highlightedIndex
    const isActive = !!item.isActive
    // Two-char marker that reads clearly in a proportional font:
    //   "> " cursor here
    //   "* " active session
    //   "  " neither
    //   ">*" cursor on the active session
    let marker = '  '
    if (isHighlighted && isActive) marker = '>*'
    else if (isHighlighted) marker = '> '
    else if (isActive) marker = '* '
    rows.push(`${marker}${truncate(item.label, SIDEBAR_LABEL_LEN)}`)
  }

  // The new-session button. Brackets make it unmistakable as a button.
  // Empty line above it for breathing room.
  rows.push('')
  const newIdx = sessionItems.length
  const newRow = newIdx === highlightedIndex ? '>[+] new' : ' [+] new'
  rows.push(newRow)

  return rows.join('\n')
}

function buildRightPane(snapshot: AppSnapshot): string {
  if (!snapshot.activeSessionId) {
    // Minimal empty state. No marketing copy.
    return '* CLAUDE CODE\n\ntap [+] in the\nsidebar to start.'
  }

  const allLines = transcriptToLines(snapshot.transcript)
  // Show the most recent ~10 lines without padding (let LVGL handle vertical
  // alignment in the proportional font).
  const VISIBLE = 10
  const visible = allLines.slice(Math.max(0, allLines.length - VISIBLE))
  const promptLine = snapshot.activeBusy ? '... thinking' : '> tap to talk'
  return visible.join('\n') + '\n\n' + promptLine
}

export function toSplitView(snapshot: AppSnapshot, nav: GlassNavState): SplitData {
  const items = buildSidebarItems(snapshot)
  const highlighted = Math.max(0, Math.min(items.length - 1, nav.highlightedIndex))
  return {
    header: buildHeader(snapshot),
    left: buildLeftPane(items, highlighted),
    right: buildRightPane(snapshot),
    layout: {
      leftWidth: SIDEBAR_W,
      headerHeight: HEADER_H,
    },
  }
}

export function sidebarItemCount(snapshot: AppSnapshot): number {
  return buildSidebarItems(snapshot).length
}
