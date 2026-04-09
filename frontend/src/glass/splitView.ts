import type { SplitData, GlassNavState } from 'even-toolkit/types'
import { truncate } from 'even-toolkit/text-utils'
import type { AppSnapshot } from './shared'
import type { TranscriptEvent } from '../types'

// -----------------------------------------------------------------------------
// Split-view renderer for the 'main' screen.
//
// Layout (576x288):
//
//   ┌─────────────────────────────────────────────────────────────────┐  40px header
//   │  * CLAUDE CODE        <session title>           ◐ thinking      │
//   ├──────────┬──────────────────────────────────────────────────────┤
//   │ ▶ sess1  │ > make a hello.txt file                              │  248px panes
//   │ ● sess2  │ I'll create it for you.                              │
//   │   sess3  │ >> Write(hello.txt)                                  │
//   │   sess4  │ Done — hello.txt created.                            │
//   │ ─────    │                                                       │
//   │ + new    │ > tap to talk                                        │
//   └──────────┴──────────────────────────────────────────────────────┘
//      180px                          396px
//
// The toolkit clamps leftWidth to [180, 396]. We pin it at 180 (the
// narrowest possible) so the chat pane gets the most room.
// -----------------------------------------------------------------------------

const SIDEBAR_W = 180
const HEADER_H = 40

// Char-per-row estimates for the proportional G2 font. Conservative.
const SIDEBAR_COLS = 13
const RIGHT_COLS = 28

// Visible row counts for each pane (panes are 248px tall after the 40px header).
const SIDEBAR_ROWS = 13
const RIGHT_ROWS = 13
const HEADER_ROWS = 2

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
  items.push({ kind: 'new', label: '+ new' })
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
          else if (typeof cmd === 'string') suffix = '(' + truncate(cmd, 16) + ')'
          else if (typeof pat === 'string') suffix = '(' + truncate(pat, 16) + ')'
        }
        out.push(`>> ${ev.name}${suffix}`)
        break
      }
      case 'tool_result':
        if (ev.isError) out.push(...wrapText('! ' + (ev.content || 'tool error'), RIGHT_COLS))
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
  const brand = '* CLAUDE'
  const status = snapshot.activeBusy ? '◐ thinking' : (snapshot.activeSessionId ? '○ ready' : '* ready')
  const active = snapshot.sessions.find((s) => s.id === snapshot.activeSessionId)
  const title = active ? truncate(active.title, 28) : ''

  // Two-line header. First line: brand + status. Second line: active title.
  const padCount = Math.max(1, 40 - brand.length - status.length)
  const line1 = brand + ' '.repeat(padCount) + status
  const line2 = title || (snapshot.connection === 'ok' ? 'pick a session ▶' : 'connecting...')
  return line1 + '\n' + line2
}

function buildLeftPane(items: SidebarItem[], highlightedIndex: number): string {
  // Sliding window centered on the highlighted item.
  const visibleSlots = SIDEBAR_ROWS - 1 // reserve 1 row for the "+" line at the bottom
  const sessionItems = items.filter((i) => i.kind === 'session')
  const newItem = items.find((i) => i.kind === 'new')

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
    const marker = idx === highlightedIndex ? '▶' : (item.isActive ? '●' : ' ')
    rows.push(`${marker} ${truncate(item.label, SIDEBAR_COLS - 2)}`)
  }
  // Pad sidebar to fixed height so the "+" row always lands at the bottom.
  while (rows.length < visibleSlots) rows.push('')

  // Final "+" row, possibly highlighted.
  const newIdx = sessionItems.length
  const newMarker = newIdx === highlightedIndex ? '▶' : ' '
  const newLabel = newItem?.label ?? '+ new'
  rows.push(`${newMarker} ${newLabel}`)

  return rows.join('\n')
}

function buildRightPane(snapshot: AppSnapshot): string {
  if (!snapshot.activeSessionId) {
    // No active session — show a friendly placeholder pointing at the sidebar.
    return [
      '',
      '  * CLAUDE CODE G2',
      '',
      '  voice-driven coding',
      '  on your AR glasses',
      '',
      '  pick a session ◀',
      '  or tap + to start',
    ].join('\n')
  }

  const allLines = transcriptToLines(snapshot.transcript)
  // Reserve 2 rows for the bottom prompt + spacer.
  const visibleSlots = RIGHT_ROWS - 2
  const totalLines = allLines.length
  const offset = Math.min(snapshot.sessionScrollOffset, Math.max(0, totalLines - visibleSlots))
  const sliceStart = Math.max(0, totalLines - visibleSlots - offset)
  const visible = allLines.slice(sliceStart, sliceStart + visibleSlots)

  // Pad transcript to fixed height so the prompt is always at the bottom.
  while (visible.length < visibleSlots) visible.unshift('')

  const promptLine = snapshot.activeBusy ? '◐ working...' : '> tap to talk'
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

// Used by the action handler to bound the highlight.
export function sidebarItemCount(snapshot: AppSnapshot): number {
  return buildSidebarItems(snapshot).length
}
// Wait — note: HEADER_ROWS is currently unused but kept for future symmetry.
void HEADER_ROWS
