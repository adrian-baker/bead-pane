import { expect, test } from 'claude-code/testing'

import {
  barRuns,
  changedBy,
  countBubble,
  datedEntries,
  keepLineBreaks,
  idsIn,
  isWork,
  linkIds,
  parseComments,
  parseShown,
  summarised,
  trailLabels,
} from '../hooks/beads'
import { row } from './fake-bd'

const ref = (id: string, status = 'open') => ({ id, title: id, status })

test('IDs in code are left alone, in spans of any length and in fences', () => {
  const text = 'demo-a1b2 `demo-c3d4` ``x `demo-e5f6` y``\n```\ndemo-g7h8\n```\n~~~\ndemo-i9j0'
  expect(idsIn(text, 'demo')).toEqual(['demo-a1b2'])
  expect(linkIds(text, 'demo', id => `<${id}>`)).toBe(text.replace('demo-a1b2', '<demo-a1b2>'))
})

test('a prefix with regex characters matches only itself', () => {
  expect(idsIn('my.app-a1b2 myxapp-a1b2 app-a1b2', 'my.app')).toEqual(['my.app-a1b2'])
})

test('a bd command is read past its global flags, and quoted text is skipped', () => {
  expect(changedBy('bd -q close demo-a1b2 --reason="see demo-c3d4"', '', 'demo')).toEqual([
    { id: 'demo-a1b2', how: 'closed' },
  ])
  expect(changedBy('/opt/homebrew/bin/bd --actor me update demo-a1b2 --claim', '', 'demo')).toEqual(
    [{ id: 'demo-a1b2', how: 'claimed' }],
  )
  expect(changedBy('bd comments demo-a1b2', '', 'demo')).toEqual([])
  expect(changedBy('bd comments add demo-a1b2 -f note.md', '', 'demo')).toEqual([
    { id: 'demo-a1b2', how: 'commented' },
  ])
  expect(changedBy('bd show demo-a1b2 && echo bd', '', 'demo')).toEqual([])
})

test('bd show tells a bead it lacks from a bd that failed', () => {
  const found = parseShown(['demo-a1b2', 'demo-zzzz'], {
    exitCode: 0,
    stdout: JSON.stringify([row('demo-a1b2', { dependent_count: 3 })]),
    stderr: 'Issue demo-zzzz not found',
  })
  expect(found.lookups['demo-a1b2']?.kind).toBe('found')
  expect(found.lookups['demo-zzzz']).toEqual({ kind: 'missing' })
  expect(found.withChildren).toEqual(['demo-a1b2'])

  const none = parseShown(['demo-zzzz'], {
    exitCode: 1,
    stdout: JSON.stringify({ error: 'no issues found matching the provided IDs' }),
    stderr: '',
  })
  expect(none.lookups['demo-zzzz']).toEqual({ kind: 'missing' })

  const locked = parseShown(['demo-a1b2'], {
    exitCode: 1,
    stdout: '',
    stderr: 'database is locked',
  })
  expect(locked.lookups['demo-a1b2']).toEqual({ kind: 'failed', detail: 'database is locked' })
})

test('the bar gives each status at least one cell and fills its width', () => {
  const kids = [
    ...Array.from({ length: 16 }, (_, i) => ref(`demo-a.${i}`, 'closed')),
    ref('demo-a.16', 'in_progress'),
    ref('demo-a.17', 'in_progress'),
    ref('demo-a.18'),
  ]
  const runs = barRuns(kids, 20)
  expect(runs.map(([status]) => status)).toEqual(['closed', 'in_progress', 'open'])
  expect(runs.reduce((sum, [, n]) => sum + n, 0)).toBe(20)
  expect(runs.every(([, n]) => n >= 1)).toBe(true)
})

test('a summarised list shows the work left, or the first when all are closed', () => {
  const kids = [ref('demo-a.1', 'closed'), ref('demo-a.2'), ref('demo-a.3', 'in_progress')]
  expect(summarised(kids, 8).map(k => k.id)).toEqual(['demo-a.2', 'demo-a.3'])
  expect(
    summarised([ref('demo-a.1', 'closed'), ref('demo-a.2', 'closed')], 1).map(k => k.id),
  ).toEqual(['demo-a.1'])
})

test('the breadcrumb shortens each ID that nests in the one before', () => {
  expect(trailLabels(['demo-g5h6', 'demo-g5h6.5', 'demo-g5h6.5.1', 'demo-x1y2'])).toEqual([
    'demo-g5h6',
    '.5',
    '.1',
    'demo-x1y2',
  ])
})

test('viewing or linking a bead is not working on it', () => {
  expect(isWork('claimed')).toBe(true)
  expect(isWork('in title')).toBe(true)
  expect(isWork('viewed')).toBe(false)
  expect(isWork('mentioned')).toBe(false)
})

test('comments come oldest first, and a missing date sorts first', () => {
  const said = parseComments(
    JSON.stringify([
      { author: 'B', text: 'second', created_at: '2026-11-02T00:00:00Z' },
      { author: 'A', text: 'first', created_at: '2026-11-01T00:00:00Z' },
      { text: 'undated' },
    ]),
  )
  expect(said.map(c => c.text)).toEqual(['undated', 'first', 'second'])
  expect(said[0]?.author).toBe('')
})

test('the comment bubble widens with the count and holds it', () => {
  const one = countBubble(2)
  const three = countBubble(128)
  expect(three.width).toBeGreaterThan(one.width)
  expect(one.source).toContain('>2</text>')
  expect(three.source).toContain(`viewBox="0 0 ${three.width} ${three.height}"`)
})

test('dated entries need every line dated, and line breaks survive Markdown', () => {
  expect(datedEntries('2026-11-06: a\n2026-11-05 23:28Z: b')).toEqual([
    { when: '2026-11-06', text: 'a' },
    { when: '2026-11-05 23:28Z', text: 'b' },
  ])
  expect(datedEntries('2026-11-06: a\nplain line')).toBeNull()
  expect(datedEntries('2026-11-06: only one')).toBeNull()
  expect(keepLineBreaks('a\nb\n\nc')).toBe('a  \nb\n\nc')
})
