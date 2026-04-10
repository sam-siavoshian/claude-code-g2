import type { SplitData, GlassNavState } from 'even-toolkit/types'
import type { AppSnapshot } from './shared'
import type { SidebarItem } from './shared'
import type { TranscriptEvent } from '../types'

export type { SidebarItem }

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text
  if (maxLen <= 1) return text.slice(0, maxLen)
  return text.slice(0, maxLen - 1) + '…'
}

function basename(raw: unknown): string {
  if (typeof raw !== 'string') return '?'
  return raw.split('/').pop() ?? raw
}

// Layout: 576x288, proportional LVGL green font.
// Every character matters. Zero empty rows.
//
//   ┌──────────────┬────────────────────────────────┐  40px header
//   │              │ ◆ fix pong · Reading test.ts…   │
//   ├──────────────┼────────────────────────────────┤
//   │ ● fix pong t │ > fix the pong test            │
//   │ ◐ write API  │ │ Looking at the test file     │  248px
//   │ [○ hello wor]│ >> Read(test.ts)               │
//   │              │   export function pong()       │
//   │              │ │ Found the bug.               │
//   │     [+ new]  │ tap: open · 2tap: delete       │
//   └──────────────┴────────────────────────────────┘
//       180px                  396px

const SIDEBAR_W = 180
const HEADER_H = 40
const SIDEBAR_LABEL_LEN = 13  // #2: wider labels — proportional font fits ~14 chars in 180px
const RIGHT_COLS = 28

export function buildSidebarItems(snapshot: AppSnapshot): SidebarItem[] {
  const items: SidebarItem[] = snapshot.sessions.map((s) => ({
    kind: 'session',
    id: s.id,
    label: s.title,
    isActive: s.id === snapshot.activeSessionId,
    busy: s.busy,
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

function humanToolProgress(name: string, input: unknown): string {
  const inp = input as Record<string, unknown> | null
  switch (name) {
    case 'Read': return `Reading ${basename(inp?.file_path ?? inp?.path)}…`
    case 'Write': return `Writing ${basename(inp?.file_path)}…`
    case 'Edit': return `Editing ${basename(inp?.file_path)}…`
    case 'Bash': return `Running: ${truncate(String(inp?.command ?? '…'), 18)}`
    case 'Grep': return `Searching ${truncate(String(inp?.pattern ?? ''), 14)}…`
    case 'Glob': return `Finding ${truncate(String(inp?.pattern ?? ''), 14)}…`
    case 'WebSearch': return 'Searching web…'
    case 'WebFetch': return 'Fetching URL…'
    default: return `Running ${name}…`
  }
}

function transcriptToLines(transcript: TranscriptEvent[]): string[] {
  const out: string[] = []
  for (const ev of transcript) {
    switch (ev.kind) {
      case 'user':
        out.push(...wrapText(ev.text, RIGHT_COLS, '> '))
        break
      case 'assistant_text':
        out.push(...wrapText(ev.text, RIGHT_COLS, '│ '))
        break
      case 'tool_use': {
        const inp = ev.input as Record<string, unknown> | null
        let suffix = ''
        if (inp && typeof inp === 'object') {
          const fp = inp.file_path ?? inp.path
          const cmd = inp.command
          const pat = inp.pattern
          if (typeof fp === 'string') suffix = '(' + basename(fp) + ')'
          else if (typeof cmd === 'string') suffix = '(' + truncate(cmd, 14) + ')'
          else if (typeof pat === 'string') suffix = '(' + truncate(pat, 14) + ')'
        }
        out.push(`>> ${ev.name}${suffix}`)
        break
      }
      case 'tool_result':
        if (ev.isError) {
          out.push(...wrapText('! ' + (ev.content || 'error'), RIGHT_COLS))
        } else if (ev.content) {
          const firstLine = ev.content.split('\n').find((l) => l.trim().length > 0)
          if (firstLine) {
            out.push(`  ${truncate(firstLine.trim(), RIGHT_COLS - 2)}`)
          }
        }
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

function thinkingStatus(snapshot: AppSnapshot): string {
  const lastTool = [...snapshot.transcript].reverse().find((e) => e.kind === 'tool_use')
  if (lastTool && lastTool.kind === 'tool_use') {
    return humanToolProgress(lastTool.name, lastTool.input)
  }
  const lastEvent = snapshot.transcript[snapshot.transcript.length - 1]
  if (lastEvent) {
    const elapsed = Math.round((Date.now() - lastEvent.ts) / 1000)
    if (elapsed > 15) return `thinking… ${elapsed}s`
  }
  return 'thinking…'
}

// #3: Scroll indicator moved to header — frees 1 transcript row.
// #6: Informative header — shows session count when idle, not just brand.
function buildHeader(snapshot: AppSnapshot): string {
  if (snapshot.error) return `◆ ! ${truncate(snapshot.error, 36)}`

  // #3: Scroll offset in header when scrolled up
  const scrollTag = snapshot.sessionScrollOffset > 0
    ? ` ▲${snapshot.sessionScrollOffset}`
    : ''

  const active = snapshot.sessions.find((s) => s.id === snapshot.activeSessionId)
  if (!active) {
    // #6: Show session count instead of brand when idle
    const n = snapshot.sessions.length
    if (n === 0) return '◆ no sessions · tap [+]'
    return `◆ ${n} session${n === 1 ? '' : 's'} · swipe to browse`
  }
  if (snapshot.activeBusy) {
    const status = thinkingStatus(snapshot)
    return `◆ ${truncate(active.title, 16)} · ${truncate(status, 16)}${scrollTag}`
  }
  return `◆ ${truncate(active.title, 34)}${scrollTag}`
}

function buildLeftPane(items: SidebarItem[], highlightedIndex: number): string {
  const sessionItems = items.filter((i) => i.kind === 'session')

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
    const dot = isActive ? '●' : (item.busy ? '◐' : '○')
    const label = truncate(item.label, SIDEBAR_LABEL_LEN)

    if (isHighlighted) {
      rows.push(`[${dot} ${label}]`)
    } else {
      rows.push(` ${dot} ${label}`)
    }
  }

  if (start > 0) rows[0] = '  ▲ more'
  if (start + visibleSlots < sessionItems.length) rows[rows.length - 1] = '  ▼ more'

  const newIdx = sessionItems.length
  if (newIdx === highlightedIndex) {
    rows.push('[+ new]')
  } else {
    rows.push(' + new')
  }

  return rows.join('\n')
}

function actionHint(snapshot: AppSnapshot, items: SidebarItem[], highlightedIndex: number): string {
  if (snapshot.confirmAction && Date.now() < snapshot.confirmAction.expiresAt) {
    return 'tap: DELETE · 2tap: cancel'
  }

  const item = items[Math.min(highlightedIndex, items.length - 1)]
  if (!item) return ''

  if (item.kind === 'new') return 'tap: new session (voice)'
  if (item.isActive) {
    return snapshot.activeBusy ? '2tap: close' : 'tap: talk · 2tap: close'
  }
  return 'tap: open · 2tap: delete'
}

function buildRightPane(snapshot: AppSnapshot, items: SidebarItem[], highlightedIndex: number): string {
  // #4: Empty state shows gesture cheat sheet instead of 1 wasted line.
  if (!snapshot.activeSessionId) {
    return [
      'swipe: browse sessions',
      'tap: open session',
      '2tap: delete session',
      '[+]: new voice session',
      '',
      'tap [+] to start',
    ].join('\n')
  }

  // #7: Compact delete modal — 5 lines, not 9.
  if (snapshot.confirmAction && Date.now() < snapshot.confirmAction.expiresAt) {
    const ca = snapshot.confirmAction
    const remaining = Math.ceil((ca.expiresAt - Date.now()) / 1000)
    return [
      `Delete "${truncate(ca.title, 24)}"?`,
      'This cannot be undone.',
      '',
      `tap: DELETE · 2tap: cancel`,
      `auto-cancel ${remaining}s…`,
    ].join('\n')
  }

  const allLines = transcriptToLines(snapshot.transcript)
  // #3: Full 10 rows for transcript — scroll indicator moved to header.
  const VISIBLE = 10
  const totalLines = allLines.length
  const maxOffset = Math.max(0, totalLines - VISIBLE)
  const offset = Math.min(snapshot.sessionScrollOffset, maxOffset)
  const startLine = Math.max(0, totalLines - VISIBLE - offset)
  const visible = allLines.slice(startLine, startLine + VISIBLE)

  // Last line is the action hint — replaces the last transcript line.
  const hint = actionHint(snapshot, items, highlightedIndex)
  if (visible.length >= VISIBLE) {
    visible[visible.length - 1] = hint
  } else {
    visible.push(hint)
  }

  return visible.join('\n')
}

export function toSplitView(snapshot: AppSnapshot, nav: GlassNavState): SplitData {
  if (
    snapshot.lastActivityAt &&
    Date.now() - snapshot.lastActivityAt > 30_000 &&
    !snapshot.activeBusy
  ) {
    return {
      header: '◆',
      left: '',
      right: 'tap to wake',
      layout: { leftWidth: SIDEBAR_W, headerHeight: HEADER_H },
    }
  }

  const items = buildSidebarItems(snapshot)
  const highlighted = Math.max(0, Math.min(items.length - 1, nav.highlightedIndex))
  return {
    header: buildHeader(snapshot),
    left: buildLeftPane(items, highlighted),
    right: buildRightPane(snapshot, items, highlighted),
    layout: {
      leftWidth: SIDEBAR_W,
      headerHeight: HEADER_H,
    },
  }
}

export function sidebarItemCount(snapshot: AppSnapshot): number {
  return buildSidebarItems(snapshot).length
}
