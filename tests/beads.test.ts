import { expect, test } from 'claude-code/testing'

import {
  barRuns,
  changedBy,
  countBubble,
  datedEntries,
  fileLinks,
  keepLineBreaks,
  linkGitHub,
  noteWhen,
  parseGitHubRepo,
  refLabel,
  relinkFiles,
  refUrl,
  idsIn,
  isWork,
  linkIds,
  parseComments,
  parseDependents,
  parseShown,
  summarised,
  underParents,
} from '../hooks/beads'
import { row } from './fake-bd'

const ref = (id: string, status = 'open') => ({ id, title: id, status })

test('IDs in code are left alone, but for a span that holds one alone', () => {
  const text =
    'demo-a1b2 `demo-c3d4` `bd show demo-k1k2` ``x `demo-e5f6` y``\n```\ndemo-g7h8\n```\n~~~\ndemo-i9j0'
  expect(idsIn(text, 'demo')).toEqual(['demo-a1b2', 'demo-c3d4'])
  expect(linkIds(text, 'demo', id => `<${id}>`)).toBe(
    text.replace('demo-a1b2', '<demo-a1b2>').replace('`demo-c3d4`', '<demo-c3d4>'),
  )
  // An ID bd didn't find keeps its backticks.
  expect(linkIds('`demo-c3d4`', 'demo', () => null)).toBe('`demo-c3d4`')
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
  expect(changedBy('bd dep list demo-a1b2 --direction=up', '', 'demo')).toEqual([])
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
  expect(found.withDependents).toEqual(['demo-a1b2'])

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

test('a GitHub remote gives the repository, in either form', () => {
  expect(parseGitHubRepo('https://github.com/acme/widgets.git')).toBe('acme/widgets')
  expect(parseGitHubRepo('git@github.com:acme/widgets.git')).toBe('acme/widgets')
  expect(parseGitHubRepo('https://gitlab.com/acme/widgets.git')).toBeNull()
})

test('PR and issue numbers link to the repository, outside code and links', () => {
  const linked = linkGitHub(
    'PR 4503 fixes #4501 and gh-12. `#99` stays, as does [#7](https://x.test) and a#5.',
    'acme/widgets',
  )
  expect(linked).toBe(
    '[PR 4503](https://github.com/acme/widgets/pull/4503) fixes ' +
      '[#4501](https://github.com/acme/widgets/issues/4501) and ' +
      '[gh-12](https://github.com/acme/widgets/issues/12). `#99` stays, as does [#7](https://x.test) and a#5.',
  )
})

test('a bare pull request or issue URL reads as its shorthand', () => {
  expect(
    linkGitHub(
      'Draft PR https://github.com/acme/widgets/pull/2769, see ' +
        'https://github.com/acme/widgets/issues/12#issuecomment-1. Also ' +
        'https://github.com/other/thing/pull/5/files and [x](https://github.com/acme/widgets/pull/9).',
      'acme/widgets',
    ),
  ).toBe(
    'Draft PR [#2769](https://github.com/acme/widgets/pull/2769), see ' +
      '[#12](https://github.com/acme/widgets/issues/12#issuecomment-1). Also ' +
      '[other/thing#5](https://github.com/other/thing/pull/5/files) and [x](https://github.com/acme/widgets/pull/9).',
  )
})

test('an external ref reads as a PR or an issue and links where it can', () => {
  expect(refLabel('https://github.com/acme/widgets/pull/4610')).toBe('PR 4610')
  expect(refLabel('gh-2510')).toBe('#2510')
  expect(refLabel('jira-ABC-1')).toBe('jira-ABC-1')
  expect(refUrl('gh-2510', 'acme/widgets')).toBe('https://github.com/acme/widgets/issues/2510')
  expect(refUrl('gh-2510', null)).toBeNull()
  expect(refUrl('jira-ABC-1', 'acme/widgets')).toBeNull()
})

test('rows group under a shared parent, in the order each group first appears', () => {
  const epic = ref('demo-e')
  const parents: Record<string, typeof epic> = { 'demo-e.1': epic, 'demo-e.2': epic }
  const groups = underParents(
    [ref('demo-e.2'), ref('demo-x'), ref('demo-y'), ref('demo-e.1')],
    id => parents[id] ?? null,
  )
  expect(groups.map(g => [g.parent?.id ?? null, g.rows.map(r => r.id)])).toEqual([
    ['demo-e', ['demo-e.2', 'demo-e.1']],
    [null, ['demo-x', 'demo-y']],
  ])
})

test('file links are found outside code and rewritten by where the file is', () => {
  const text =
    'See [the approach](docs/approach.md#plan), [the code](src/a.ts), [GitHub](https://x.test) ' +
    'and `[not this](docs/b.md)`.'
  expect(fileLinks(text)).toEqual(['docs/approach.md', 'src/a.ts'])
  const where: Record<string, string | null> = {
    'docs/approach.md': 'https://gh.test/approach.md',
    'src/a.ts': null,
  }
  expect(relinkFiles(text, path => where[path])).toBe(
    'See [the approach](https://gh.test/approach.md), the code, [GitHub](https://x.test) ' +
      'and `[not this](docs/b.md)`.',
  )
})

test('a note with a time reads as time ago, a date alone as the date', () => {
  const now = Date.parse('2026-11-06T04:28:00Z')
  expect(noteWhen('2026-11-05 23:28Z', now)).toBe('5h ago')
  expect(noteWhen('2026-11-06', now)).toBe(
    new Date(2026, 10, 6).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }),
  )
})

test("a bead's dependents split into its children and the beads it blocks", () => {
  const deps = parseDependents(
    JSON.stringify([
      { ...row('demo-a.10'), dependency_type: 'parent-child' },
      { ...row('demo-a.9'), dependency_type: 'parent-child' },
      { ...row('demo-b'), dependency_type: 'blocks' },
      { ...row('demo-c'), dependency_type: 'tracks' },
    ]),
  )
  expect(deps.children.map(r => r.id)).toEqual(['demo-a.9', 'demo-a.10'])
  expect(deps.blocks.map(r => r.id)).toEqual(['demo-b'])
})
