import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'

import { fakeBd, row } from './fake-bd'

const NOW = Date.parse('2026-11-06T00:00:00Z')

const message = (text: string) =>
  ({
    plugin: 'bead-pane',
    component: 'AssistantMessage',
    requestId: 'm1',
    surface: 'desktop',
    props: { text, isFirstOfReply: true },
  }) as const

const PANE = {
  plugin: 'bead-pane',
  component: 'Pane',
  requestId: 'bead',
  surface: 'desktop',
  props: {
    title: 'Beads',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

// Lets the lookups each draw starts run, and the draws they cause.
const settle = async (clock: MockClock) => {
  for (let i = 0; i < 4; i++) await clock.settle()
}

// The text of a found Markdown, or undefined.
const textOf = (el: { props?: unknown } | undefined): unknown =>
  (el?.props as { text?: unknown } | undefined)?.text

// The breadcrumb as one line: each link's markdown and each grey part's text.
// A separator drawn as an SVG reads as its alt; a zero-width spacer as nothing.
type Drawn = { type?: string; props?: { text?: unknown; alt?: unknown }; children?: unknown }
const flat = (n: unknown): string[] => {
  if (typeof n === 'string') return [n]
  if (Array.isArray(n)) return n.flatMap(flat)
  const d = n as Drawn
  if (d?.type === 'Markdown') return [String(d.props?.text)]
  if (d?.type === 'Svg') return [String(d.props?.alt)]
  if (d?.type === 'Text')
    return [
      flat(d.children)
        .join('')
        .replace(/\u200b/g, ''),
    ]
  return flat(d?.children ?? [])
}
const trailOf = async (pane: { find: (q: { key: string }) => Promise<unknown> }) =>
  flat((await pane.find({ key: 'trail' })) as Drawn)
    .filter(part => part !== '')
    .join(' ')

const keysOf = (children: unknown): unknown[] =>
  Array.isArray(children)
    ? children.map((r: { key?: unknown; props?: { key?: unknown } }) => r.key ?? r.props?.key)
    : []

test('a bead ID becomes a link that opens the bead in the pane', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on(
    'process.run',
    fakeBd({
      beads: {
        'demo-a1b2c': row('demo-a1b2c', {
          title: 'Tidy the importer',
          description: 'Follow-up to demo-d3e4f.',
          notes: 'Check the fixtures first.',
          close_reason: 'Not shown while open.',
          priority: 3,
          dependent_count: 2,
          dependencies: [
            { ...row('demo-d3e4f', { status: 'closed' }), dependency_type: 'blocks' },
            { ...row('demo-p0000', { title: 'The epic' }), dependency_type: 'parent-child' },
          ],
        }),
        'demo-g5h6.4': row('demo-g5h6.4'),
        'demo-d3e4f': row('demo-d3e4f', { status: 'closed' }),
      },
      children: {
        'demo-a1b2c': [
          row('demo-a1b2c.10', { title: 'Tenth', issue_type: 'bug' }),
          row('demo-a1b2c.9', { title: 'Ninth', status: 'closed' }),
        ],
      },
      blocks: { 'demo-a1b2c': [row('demo-x9y8', { title: 'Waits on it' })] },
    }),
  )
  // The engine's own drawing of a message: its text as Markdown.
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const msg = message(
    'See demo-a1b2c and `demo-g5h6.4`. In code, `bd show demo-a1b2c` and\n\n```\nbd close demo-g5h6.4\n```\n\nstay as written, as does demo-nope.',
  )
  const ui = await $.ui.mount(msg)
  await settle(clock)
  // The reply is drawn as Claude Code draws it, and the beads it names, the
  // one in code alone included, are a row of links under it.
  expect(textOf(await ui.find({ type: 'Markdown' }))).toBe(msg.props.text)
  // One line each, in the order named: the status glyph, the grey ID and the
  // title as the link.
  expect(keysOf((await ui.find({ key: 'msg-m1-beads' }))?.children)).toEqual([
    'msg-m1-demo-a1b2c',
    'msg-m1-demo-g5h6.4',
  ])
  expect(textOf(await ui.find({ key: 'msg-m1-demo-a1b2c-link' }))).toBe(
    '[Tidy the importer](https://beads.invalid/demo-a1b2c)',
  )
  await ui.press({
    key: 'msg-m1-demo-a1b2c-link',
    link: { href: 'https://beads.invalid/demo-a1b2c' },
  })

  const pane = await $.ui.mount(PANE)
  await settle(clock)
  const text = async (key: string) => textOf(await pane.find({ key }))
  expect(await text('desc')).toBe('Follow-up to [demo‑d3e4f](https://beads.invalid/demo-d3e4f).')
  expect(await text('text-Notes')).toBe('Check the fixtures first.')
  expect(await trailOf(pane)).toBe(
    '### [▤](https://beads.invalid/~home) › [The epic](https://beads.invalid/demo-p0000) › demo-a1b2c',
  )
  // The children mix a bug and a task, so each row has its type's icon,
  // after the title's own.
  const alts = (await pane.findAll({ type: 'Svg' })).map(s => (s.props as { alt?: string }).alt)
  expect(alts.filter(a => a === 'bug' || a === 'task')).toEqual(['task', 'task', 'bug'])
  // In ID order whatever their status, `.9` before `.10`, each by its own `.n`.
  expect(keysOf((await pane.find({ key: 'kids' }))?.children)).toEqual([
    'kids-demo-a1b2c.9',
    'kids-demo-a1b2c.10',
  ])
  expect(await text('kids-demo-a1b2c.9-title')).toBe('[Ninth](https://beads.invalid/demo-a1b2c.9)')
  expect(await pane.find({ type: 'Text', text: /^\.10$/ })).toBeTruthy()
  // Every child, blocker and bead it blocks shows its priority, closed ones too.
  expect(await pane.findAll({ type: 'Text', text: /^P2$/ })).toHaveLength(4)
  expect(await pane.find({ key: 'text-resolution' })).toBeFalsy()
  expect(await pane.find({ type: 'Text', text: /P3/ })).toBeTruthy()
  // Its one blocker is closed, so it's listed under a grey heading.
  expect(await pane.find({ type: 'Text', text: 'WAS BLOCKED BY' })).toBeTruthy()
  expect(await pane.find({ key: 'blocker-list-demo-d3e4f' })).toBeTruthy()
  // What waits on it, under an amber heading while any of it is open.
  expect(await pane.find({ type: 'Text', text: 'BLOCKS' })).toBeTruthy()
  expect(await text('blocks-list-demo-x9y8-title')).toBe(
    '[Waits on it](https://beads.invalid/demo-x9y8)',
  )

  // A link in the description moves the pane, and the breadcrumb leads back up.
  await clock.advance(1000)
  await pane.press({ key: 'desc', link: { href: 'https://beads.invalid/demo-d3e4f' } })
  await settle(clock)
  expect(await trailOf(pane)).toBe('### [▤](https://beads.invalid/~home) › demo-d3e4f')
  // The reply's links are in the list as mentioned. Opening a bead adds nothing.
  await pane.press({ key: 'crumb-home', link: { href: 'https://beads.invalid/~home' } })
  await settle(clock)
  // demo-a1b2c sits under its parent's title; demo-g5h6.4 has none here.
  // Its parent is a row of its own, with its title as a link.
  expect(textOf(await pane.find({ key: 'mentioned-demo-p0000-title' }))).toBe(
    '[The epic](https://beads.invalid/demo-p0000)',
  )
  expect(await pane.find({ key: 'mentioned-demo-a1b2c' })).toBeTruthy()
  expect(await pane.find({ key: 'mentioned-demo-g5h6.4' })).toBeTruthy()
  // The parent's line runs on under its ID, should its title wrap, to its
  // one child's elbow, whose arm runs on to the child's ID. Every row shows
  // its type, though all three are tasks.
  const drawn = (await pane.findAll({ type: 'Svg' })).map(s => (s.props as { alt?: string }).alt)
  expect(drawn).toEqual(['│', 'task', '└', '─', 'task', 'task'])
  expect(await pane.find({ key: 'worked-section' })).toBeFalsy()
  expect(await pane.find({ type: 'Text', text: /^mentioned$/ })).toBeFalsy()

  // Back to the bead from the conversation, and up to a parent bd doesn't know.
  await ui.press({
    key: 'msg-m1-demo-a1b2c-link',
    link: { href: 'https://beads.invalid/demo-a1b2c' },
  })
  await pane.press({ key: 'crumb-demo-p0000', link: { href: 'https://beads.invalid/demo-p0000' } })
  await settle(clock)
  expect(
    await pane.find({ type: 'Text', text: /demo-p0000 is not a bead in this project/ }),
  ).toBeTruthy()
  await pane.unmount()
  await ui.unmount()
})

test('a long list of children is summarised until opened', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kids = Array.from({ length: 20 }, (_, i) =>
    row(`demo-epic1.${i + 1}`, {
      status: i < 15 ? 'closed' : i < 17 ? 'in_progress' : 'open',
    }),
  )
  on(
    'process.run',
    fakeBd({
      beads: { 'demo-epic1': row('demo-epic1', { issue_type: 'epic', dependent_count: 20 }) },
      children: { 'demo-epic1': kids },
    }),
  )
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // The engine's own drawing of a message: its text as Markdown.
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })

  const ui = await $.ui.mount(message('See demo-epic1.'))
  await settle(clock)
  await ui.press({
    key: 'msg-m1-demo-epic1-link',
    link: { href: 'https://beads.invalid/demo-epic1' },
  })
  await ui.unmount()

  const pane = await $.ui.mount(PANE)
  await settle(clock)
  const rows = async () => keysOf((await pane.find({ key: 'kids' }))?.children).length
  // Summarised, the list shows the work left: the five still open.
  expect(keysOf((await pane.find({ key: 'kids' }))?.children)).toEqual(
    [16, 17, 18, 19, 20].map(n => `kids-demo-epic1.${n}`),
  )
  // No heading: the bar and the chips, closed included, head the list.
  expect(await pane.find({ type: 'Text', text: /CHILDREN/ })).toBeFalsy()
  // Each status is a link that filters to it, closed included.
  const chip = async (st: string) => textOf(await pane.find({ key: `count-${st}` }))
  const pressChip = (st: string) =>
    pane.press({ key: `count-${st}`, link: { href: `https://beads.invalid/~only:${st}` } })
  expect(await chip('closed')).toContain('15 closed')
  expect(await chip('open')).toContain('3 open')
  expect(await chip('in_progress')).toContain('2 in progress')
  // The bar is 20 cells: 15 closed, 2 in progress, 3 open.
  const bar = (await pane.findAll({ type: 'Svg' }))
    .map(s => String((s.props as { source?: unknown }).source))
    .find(src => src.includes('preserveAspectRatio'))
  expect(bar).toContain('width="750"')
  expect(bar).toContain('width="150"')
  expect(textOf(await pane.find({ key: 'all' }))).toContain('Show all 20')
  // A status count narrows the list to that status, and pressing it again clears it.
  await pressChip('open')
  expect(keysOf((await pane.find({ key: 'kids' }))?.children)).toHaveLength(3)
  // The others dim, so the row keeps its widths.
  const dimOf = async (st: string) =>
    (await pane.find({ key: `count-${st}` }))?.props as { dimColor?: boolean } | undefined
  expect((await dimOf('closed'))?.dimColor).toBe(true)
  expect((await dimOf('open'))?.dimColor).toBe(false)
  expect(await pane.find({ key: 'all' })).toBeFalsy()
  await pressChip('open')
  expect(textOf(await pane.find({ key: 'all' }))).toContain('Show all 20')
  await pane.press({ key: 'all', link: { href: 'https://beads.invalid/~all' } })
  expect(await rows()).toBe(20)
  expect(textOf(await pane.find({ key: 'all' }))).toContain('Show fewer')
  await pane.unmount()
})

test("the pane's list holds the beads this session's bd commands changed, kept current", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { BEADS_ACTOR: 'claude-test/1' })
  const beads: Record<string, Record<string, unknown>> = {
    'demo-new1': row('demo-new1', { title: 'Made here' }),
    'demo-clm1': row('demo-clm1', { title: 'Claimed here', status: 'in_progress' }),
    'demo-old1': row('demo-old1', { title: 'Claimed before', status: 'in_progress' }),
  }
  const ran: (readonly string[])[] = []
  on(
    'process.run',
    fakeBd({ beads, ran, assigned: [{ id: 'demo-old1', updated_at: '2026-11-01T00:00:00Z' }] }),
  )
  on('ui.open', () => ({ value: { isPlaced: true } }))
  // The engine's Bash: `bd create` prints the new ID, the rest print nothing.
  on('tool.call', (_, e) => ({
    result: {
      stdout:
        'command' in e && String(e.command).includes('create') ? 'Created issue: demo-new1' : '',
      stderr: '',
      interrupted: false,
    },
  }))

  await $.tool.call({
    tool: 'Bash',
    command: 'bd create --title="Made here, see demo-xxx1" --parent=demo-epic1',
  })
  await $.tool.call({
    tool: 'Bash',
    command: 'bd -q update demo-clm1 --claim && bd show demo-shw1',
  })
  await $.tool.call({ tool: 'Bash', command: 'git status' })

  const pane = await $.ui.mount(PANE)
  await settle(clock)
  // `bd show` changes nothing, the quoted title isn't searched, and the
  // parent of a create isn't touched.
  for (const ref of ['demo-clm1', 'demo-new1', 'demo-old1']) {
    expect(await pane.find({ key: `worked-${ref}` })).toBeTruthy()
  }
  for (const ref of ['demo-shw1', 'demo-xxx1', 'demo-epic1']) {
    expect(await pane.find({ key: `worked-${ref}` })).toBeFalsy()
  }
  expect(await pane.find({ type: 'Text', text: /^claimed$/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /^created$/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /^assigned$/ })).toBeTruthy()
  // The commands' beads came from one `bd show`, and no bead was asked twice.
  const asked = ran.filter(argv => argv[1] === 'show').flatMap(argv => argv.slice(2, -1))
  expect(asked).toEqual([...new Set(asked)])
  expect(ran.filter(argv => argv[1] === 'show')[0]).toEqual([
    'bd',
    'show',
    'demo-new1',
    'demo-clm1',
    '--json',
  ])
  expect(ran.find(argv => argv[1] === 'list')).toContain('open,in_progress,blocked,deferred')

  // A close the session runs shows in the list without a reload.
  beads['demo-clm1'] = row('demo-clm1', { title: 'Claimed here', status: 'closed' })
  await $.tool.call({ tool: 'Bash', command: 'bd close demo-clm1 --reason="Done"' })
  await settle(clock)
  expect(await pane.find({ type: 'Text', text: /^closed$/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /^●$/ })).toBeTruthy()
  await pane.unmount()
})

test(
  'IDs use the prefix bd reports for the project, linked in the reply when set inline',
  { options: { reply_links: 'inline' } },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    on('process.run', fakeBd({ prefix: 'my-app', beads: { 'my-app-x1y2': row('my-app-x1y2') } }))
    // The engine's own drawing of a message: its text as Markdown.
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Markdown } = $.ui.resolve(e)
      return <Markdown text={e.props.text} />
    })

    const ui = await $.ui.mount(message('See my-app-x1y2, not demo-a1b2c or app-x1y2.'))
    await settle(clock)
    expect(textOf(await ui.find({ type: 'Markdown' }))).toBe(
      'See [my-app-x1y2](https://beads.invalid/my-app-x1y2), not demo-a1b2c or app-x1y2.',
    )
    await ui.unmount()
  },
)

test("the pane says when bd can't run", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  // No process.run hook: the call rejects, as it does when bd can't start.
  const pane = await $.ui.mount(PANE)
  await settle(clock)
  expect(await pane.find({ type: 'Text', text: /^Couldn't run bd: ./ })).toBeTruthy()
  expect(
    await pane.find({ type: 'Text', text: /\/plugin configure bead-pane@bead-pane/ }),
  ).toBeTruthy()
  await pane.unmount()
})

test('the pane says when there is no beads database', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('process.run', () => ({
    value: {
      exitCode: 1,
      stdout: '',
      stderr: 'Error: no beads database found',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  const pane = await $.ui.mount(PANE)
  await settle(clock)
  expect(
    await pane.find({ type: 'Text', text: /no beads database from this session's folder/ }),
  ).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /^Error: no beads database found$/ })).toBeTruthy()
  await pane.unmount()
})

test('a bead bd fails to read says so, and asks again when pressed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  let isLocked = true
  const healthy = fakeBd({
    beads: { 'demo-a1b2c': row('demo-a1b2c', { title: 'Tidy the importer' }) },
  })
  on('process.run', (_, e) =>
    isLocked && e.argv[1] === 'show'
      ? {
          value: {
            exitCode: 1,
            stdout: '',
            stderr: 'database is locked',
            isStdoutTruncated: false,
            isStderrTruncated: false,
          },
        }
      : healthy(_, e),
  )
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '', interrupted: false } }))

  const pane = await $.ui.mount(PANE)
  await $.tool.call({ tool: 'Bash', command: 'bd update demo-a1b2c --claim' })
  await settle(clock)
  await pane.press({
    key: 'worked-demo-a1b2c-title',
    link: { href: 'https://beads.invalid/demo-a1b2c' },
  })
  await settle(clock)
  expect(
    await pane.find({ type: 'Text', text: /Couldn't read demo-a1b2c: database is locked/ }),
  ).toBeTruthy()

  isLocked = false
  await pane.press({ key: 'retry', link: { href: 'https://beads.invalid/demo-a1b2c' } })
  await settle(clock)
  expect(await pane.find({ type: 'Text', text: /^Tidy the importer$/ })).toBeTruthy()
  await pane.unmount()
})

test("a bead the session's title names is in the pane's list", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on('process.run', fakeBd({ beads: { 'demo-t1t2': row('demo-t1t2', { title: 'The work' }) } }))
  on('classic.SessionStart', () => ({}))

  await $.classic.SessionStart({ source: 'resume', session_title: 'demo-t1t2 event page pass' })
  const pane = await $.ui.mount(PANE)
  await settle(clock)
  expect(await pane.find({ key: 'worked-demo-t1t2' })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /^in title$/ })).toBeTruthy()
  await pane.unmount()
})

const DOLT = '/beads/.dolt-data'
const JOURNAL_PATH = `${DOLT}/demo/.dolt/noms/${'v'.repeat(32)}`

// The kit waits about a second on each act while the stand-in for tail is
// running, so this test needs longer than the default 5 seconds.
test(
  "a write to the project's Dolt journal refreshes the bead in the pane",
  { timeoutMs: 30_000 },
  async ($, on) => {
    const clock = mock.clock(on, { now: NOW })
    const beads: Record<string, Record<string, unknown>> = {
      'demo-a1b2c': row('demo-a1b2c', { title: 'Tidy the importer' }),
    }
    const ran: (readonly string[])[] = []
    on('process.run', fakeBd({ beads, ran, databasePath: DOLT }))
    on('fs.exists', (_, e) => ({ value: e.path === DOLT || e.path === JOURNAL_PATH }))
    on('fs.list', () => ({
      value: [{ name: 'demo', kind: 'dir' as const, size: 0, mtimeMs: NOW, isLink: false }],
    }))
    let tailed: readonly string[] = []
    // `tail -F` reports one write a second after it starts, then exits.
    on('process.spawn', async function* (_, e) {
      tailed = e.argv
      await clock.sleep(1000)
      yield { stream: 'stdout' as const, text: 'chunk' }
      return { value: { code: 0, signal: null } }
    })
    on('ui.open', () => ({ value: { isPlaced: true } }))
    on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
      const { Markdown } = $.ui.resolve(e)
      return <Markdown text={e.props.text} />
    })

    const ui = await $.ui.mount(message('See demo-a1b2c.'))
    await settle(clock)
    await ui.press({
      key: 'msg-m1-demo-a1b2c-link',
      link: { href: 'https://beads.invalid/demo-a1b2c' },
    })
    const pane = await $.ui.mount(PANE)
    await settle(clock)
    expect(tailed).toEqual(['tail', '-c', '0', '-F', JOURNAL_PATH])
    expect(await pane.find({ type: 'Text', text: /Open/ })).toBeTruthy()

    // Another session closes it, and the journal reports the write.
    beads['demo-a1b2c'] = row('demo-a1b2c', { title: 'Tidy the importer', status: 'closed' })
    await clock.advance(1000)
    await clock.advance(500)
    await settle(clock)
    expect(await pane.find({ type: 'Text', text: /Closed/ })).toBeTruthy()
    // The refresh asked about the pane's bead alone, without a poll.
    expect(ran.slice(-1)).toEqual([['bd', 'show', 'demo-a1b2c', '--json']])
    await pane.unmount()
    await ui.unmount()
  },
)

test('without a journal the pane polls while open, and stops once closed', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const beads: Record<string, Record<string, unknown>> = { 'demo-a1b2c': row('demo-a1b2c') }
  const ran: (readonly string[])[] = []
  on('process.run', fakeBd({ beads, ran }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })

  const ui = await $.ui.mount(message('See demo-a1b2c.'))
  await settle(clock)
  await ui.press({
    key: 'msg-m1-demo-a1b2c-link',
    link: { href: 'https://beads.invalid/demo-a1b2c' },
  })
  const pane = await $.ui.mount(PANE)
  await settle(clock)

  beads['demo-a1b2c'] = row('demo-a1b2c', { status: 'in_progress' })
  await clock.advance(5000)
  await settle(clock)
  expect(await pane.find({ type: 'Text', text: /In progress/ })).toBeTruthy()

  await pane.unmount()
  await ui.unmount()
  const shows = () => ran.filter(argv => argv[1] === 'show').length
  // One more poll finds the pane closed; after that, none.
  await clock.advance(10_000)
  await settle(clock)
  const after = shows()
  await clock.advance(60_000)
  await settle(clock)
  expect(shows()).toBe(after)
})

test('/beads runs mid-turn and opens the pane without a transcript line', async ($, on) => {
  let registered: Record<string, unknown> = {}
  on('session.start', () => ({ cwd: '/work' }))
  on('command.register', (_, e) => {
    registered = { ...e }
    return { value: { command: e.name } }
  })
  let opened = ''
  on('ui.open', (_, e) => {
    opened = e.id
    return { value: { isPlaced: true } }
  })
  on('process.run', fakeBd({}))

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  expect(registered).toMatchObject({ name: 'beads', immediate: true })
  const typed = {
    command: 'beads',
    args: '',
    origin: { kind: 'composer' as const },
    presentation: { isFullscreen: false, columns: 100 },
  }
  expect(await $.command.run(typed)).toEqual({})
  expect(opened).toBe('bead')
})

test("the pane shows a bead's labels, external ref, spec and comments", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const ran: (readonly string[])[] = []
  on(
    'process.run',
    fakeBd({
      ran,
      beads: {
        'demo-a1b2c': row('demo-a1b2c', {
          status: 'closed',
          closed_at: '2026-11-05T22:00:00Z',
          labels: ['papercut', 'ci'],
          external_ref: 'gh-2510',
          spec_id: 'specs/importer.md',
          comment_count: 2,
          comments_omitted: true,
        }),
      },
      comments: {
        'demo-a1b2c': [
          {
            id: 2,
            author: 'Sam',
            text: 'Fixed by demo-d3e4f.',
            created_at: '2026-11-05T23:00:00Z',
          },
          { id: 1, author: 'Ana', text: 'Seen again today.', created_at: '2026-11-05T12:00:00Z' },
        ],
      },
    }),
  )
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })

  const ui = await $.ui.mount(message('See demo-a1b2c.'))
  await settle(clock)
  await ui.press({
    key: 'msg-m1-demo-a1b2c-link',
    link: { href: 'https://beads.invalid/demo-a1b2c' },
  })
  const pane = await $.ui.mount(PANE)
  await settle(clock)
  expect(
    await pane.find({
      type: 'Text',
      text: 'Closed 2h ago · created 6d ago · gh-2510 · papercut · ci',
    }),
  ).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: 'specs/importer.md' })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: 'COMMENTS' })).toBeTruthy()
  // Its icon is grey like the other sections', and the count follows the heading.
  const drawn = await pane.findAll({ type: 'Svg' })
  const alts = drawn.map(el => (el.props as { alt?: string } | undefined)?.alt)
  expect(alts).toContain('Comments')
  expect(await pane.find({ type: 'Text', text: '2' })).toBeTruthy()
  // Oldest first, IDs linked.
  expect(textOf(await pane.find({ key: 'comment-0-text' }))).toBe('Seen again today.')
  expect(textOf(await pane.find({ key: 'comment-1-text' }))).toBe(
    'Fixed by [demo‑d3e4f](https://beads.invalid/demo-d3e4f).',
  )
  expect(await pane.find({ type: 'Text', text: /^Sam · 1h ago$/ })).toBeTruthy()
  // Comments come only for the bead shown, in one call.
  expect(ran.filter(argv => argv[1] === 'comments')).toEqual([
    ['bd', 'comments', 'demo-a1b2c', '--json'],
  ])
  await pane.unmount()
  await ui.unmount()
})

test('moving to a bead not yet looked up keeps the last one until it loads', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on(
    'process.run',
    fakeBd({
      beads: {
        'demo-a1b2c': row('demo-a1b2c', { description: 'See demo-zz11.' }),
        'demo-zz11': row('demo-zz11'),
      },
    }),
  )
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })

  const ui = await $.ui.mount(message('See demo-a1b2c.'))
  await settle(clock)
  await ui.press({
    key: 'msg-m1-demo-a1b2c-link',
    link: { href: 'https://beads.invalid/demo-a1b2c' },
  })
  const pane = await $.ui.mount(PANE)
  await settle(clock)

  await pane.press({ key: 'desc', link: { href: 'https://beads.invalid/demo-zz11' } })
  // A quick lookup just swaps the bead in: until it's back, the pane shows the
  // bead it had, with no "opening…" and no "Loading…".
  expect(await trailOf(pane)).toBe('### [▤](https://beads.invalid/~home) › demo-a1b2c')
  expect(await pane.find({ type: 'Text', text: /Loading/ })).toBeFalsy()
  await settle(clock)
  expect(await trailOf(pane)).toBe('### [▤](https://beads.invalid/~home) › demo-zz11')
  await pane.unmount()
  await ui.unmount()
})

test('a slow lookup names the bead being opened after a moment', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const healthy = fakeBd({
    beads: {
      'demo-a1b2c': row('demo-a1b2c', { description: 'See demo-zz11.' }),
      'demo-zz11': row('demo-zz11'),
    },
  })
  // bd answers about demo-zz11 two seconds late.
  on('process.run', async (_, e) => {
    if (e.argv.includes('demo-zz11')) await clock.sleep(2000)
    return healthy(_, e)
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })

  const ui = await $.ui.mount(message('See demo-a1b2c.'))
  await settle(clock)
  await ui.press({
    key: 'msg-m1-demo-a1b2c-link',
    link: { href: 'https://beads.invalid/demo-a1b2c' },
  })
  const pane = await $.ui.mount(PANE)
  await settle(clock)
  await pane.press({ key: 'desc', link: { href: 'https://beads.invalid/demo-zz11' } })
  await clock.advance(300)
  expect(await trailOf(pane)).toBe('### [▤](https://beads.invalid/~home) › demo-zz11 · opening…')
  await clock.advance(2000)
  await settle(clock)
  expect(await trailOf(pane)).toBe('### [▤](https://beads.invalid/~home) › demo-zz11')
  await pane.unmount()
  await ui.unmount()
})

test('a list all of one status offers no filter', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const kids = Array.from({ length: 14 }, (_, i) => row(`demo-epic2.${i + 1}`, { status: 'open' }))
  on(
    'process.run',
    fakeBd({
      beads: { 'demo-epic2': row('demo-epic2', { issue_type: 'epic', dependent_count: 14 }) },
      children: { 'demo-epic2': kids },
    }),
  )
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
  const ui = await $.ui.mount(message('See demo-epic2.'))
  await settle(clock)
  await ui.press({
    key: 'msg-m1-demo-epic2-link',
    link: { href: 'https://beads.invalid/demo-epic2' },
  })
  const pane = await $.ui.mount(PANE)
  await settle(clock)
  expect(await pane.find({ key: 'count-open' })).toBeFalsy()
  expect(await pane.find({ type: 'Text', text: '0 of 14 closed' })).toBeTruthy()
  expect(keysOf((await pane.find({ key: 'kids' }))?.children)).toHaveLength(8)
  await pane.unmount()
  await ui.unmount()
})

test('a deferred bead says when it comes back', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on(
    'process.run',
    fakeBd({
      beads: {
        'demo-later': row('demo-later', {
          status: 'deferred',
          defer_until: '2026-11-08T11:00:00Z',
        }),
      },
    }),
  )
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
  const ui = await $.ui.mount(message('See demo-later.'))
  await settle(clock)
  await ui.press({
    key: 'msg-m1-demo-later-link',
    link: { href: 'https://beads.invalid/demo-later' },
  })
  const pane = await $.ui.mount(PANE)
  await settle(clock)
  expect(await pane.find({ type: 'Text', text: /Deferred until \S+ \S+/ })).toBeTruthy()
  await pane.unmount()
  await ui.unmount()
})

test('a resumed session links the beads an earlier one found before bd answers', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const stored = new Map<string, unknown>([
    [
      'project:/work/demo',
      { setup: { kind: 'ready', prefix: 'demo', repo: null }, ids: ['demo-a1b2c'] },
    ],
  ])
  on('store.get', (_, e) => ({ value: stored.get(e.key) }))
  on('store.set', (_, e) => {
    stored.set(e.key, e.value)
    return { value: undefined }
  })
  // bd takes a second to answer anything.
  const healthy = fakeBd({ beads: { 'demo-a1b2c': row('demo-a1b2c') } })
  on('process.run', async (_, e) => {
    await clock.sleep(1000)
    return healthy(_, e)
  })
  on('session.cwd', () => ({ value: '/work/demo' }))
  on('session.start', () => ({ cwd: '/work/demo' }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })

  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work/demo' })
  // The first draw already has the link, so it's the last.
  const ui = await $.ui.mount(message('See demo-a1b2c.'))
  // Before bd answers, the remembered bead's line is its ID, linked.
  const linkRow = async () => textOf(await ui.find({ key: 'msg-m1-demo-a1b2c-link' }))
  expect(await linkRow()).toBe('[demo-a1b2c](https://beads.invalid/demo-a1b2c)')
  await clock.advance(2000)
  await settle(clock)
  expect(await linkRow()).toBe('[Title of demo-a1b2c](https://beads.invalid/demo-a1b2c)')
  await ui.unmount()
})

test('dated notes show each entry under its date', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on(
    'process.run',
    fakeBd({
      beads: {
        'demo-a1b2c': row('demo-a1b2c', {
          notes: '2026-11-06: Confirmed by token.\n2026-11-05 23:28Z: Mail arrived.',
          description: 'First line.\nSecond line.',
        }),
      },
    }),
  )
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
  const ui = await $.ui.mount(message('See demo-a1b2c.'))
  await settle(clock)
  await ui.press({
    key: 'msg-m1-demo-a1b2c-link',
    link: { href: 'https://beads.invalid/demo-a1b2c' },
  })
  const pane = await $.ui.mount(PANE)
  await settle(clock)
  // A timestamped entry reads as time ago, as other times in the pane do.
  expect(await pane.find({ type: 'Text', text: '32m ago' })).toBeTruthy()
  expect(textOf(await pane.find({ key: 'note-0-text' }))).toBe('Confirmed by token.')
  expect(textOf(await pane.find({ key: 'note-1-text' }))).toBe('Mail arrived.')
  // A single line break in other text stays a break.
  expect(textOf(await pane.find({ key: 'desc' }))).toBe('First line.  \nSecond line.')
  await pane.unmount()
  await ui.unmount()
})

test('PR and issue numbers in a bead link to its GitHub repository', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on(
    'process.run',
    fakeBd({
      remote: 'git@github.com:acme/widgets.git',
      beads: {
        'demo-a1b2c': row('demo-a1b2c', {
          description: 'PR 4503 fixes #4501.',
          external_ref: 'https://github.com/acme/widgets/pull/4610',
        }),
      },
    }),
  )
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
  const ui = await $.ui.mount(message('See demo-a1b2c.'))
  await settle(clock)
  await ui.press({
    key: 'msg-m1-demo-a1b2c-link',
    link: { href: 'https://beads.invalid/demo-a1b2c' },
  })
  const pane = await $.ui.mount(PANE)
  await settle(clock)
  expect(textOf(await pane.find({ key: 'desc' }))).toBe(
    '[PR 4503](https://github.com/acme/widgets/pull/4503) fixes [#4501](https://github.com/acme/widgets/issues/4501).',
  )
  expect(textOf(await pane.find({ key: 'ref' }))).toBe(
    '[PR 4610](https://github.com/acme/widgets/pull/4610)',
  )
  await pane.unmount()
  await ui.unmount()
})

test('moving up to a parent with comments waits for them, then switches once', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on(
    'process.run',
    fakeBd({
      beads: {
        'demo-epic3.1': row('demo-epic3.1', {
          dependencies: [
            { ...row('demo-epic3', { title: 'The epic' }), dependency_type: 'parent-child' },
          ],
        }),
        'demo-epic3': row('demo-epic3', { title: 'The epic', comment_count: 1 }),
      },
      comments: {
        'demo-epic3': [{ author: 'Ana', text: 'Note.', created_at: '2026-11-05T12:00:00Z' }],
      },
    }),
  )
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
  const ui = await $.ui.mount(message('See demo-epic3.1.'))
  await settle(clock)
  await ui.press({
    key: 'msg-m1-demo-epic3.1-link',
    link: { href: 'https://beads.invalid/demo-epic3.1' },
  })
  const pane = await $.ui.mount(PANE)
  await settle(clock)
  // The parent is cached as an ancestor, without its comments.
  await pane.press({ key: 'crumb-demo-epic3', link: { href: 'https://beads.invalid/demo-epic3' } })
  // Until they're in, the pane still shows the child.
  expect(await trailOf(pane)).toMatch(/› demo-epic3\.1$/)
  await settle(clock)
  expect(await trailOf(pane)).toBe('### [▤](https://beads.invalid/~home) › demo-epic3')
  expect(await pane.find({ type: 'Text', text: 'COMMENTS' })).toBeTruthy()
  await pane.unmount()
  await ui.unmount()
})

test("a link to a file that isn't here goes to its copy on a pushed branch", async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  const sha = 'a'.repeat(40)
  on(
    'process.run',
    fakeBd({
      remote: 'https://github.com/acme/widgets.git',
      pushedCommits: { 'docs/design.md': sha },
      beads: {
        'demo-a1b2c': row('demo-a1b2c', {
          description:
            'The [design](docs/design.md), the [code](src/a.ts) and the [lost](docs/gone.md).',
        }),
      },
    }),
  )
  // The engine resolves a relative path from the session's folder.
  on('fs.exists', (_, e) => ({ value: e.path.endsWith('/src/a.ts') || e.path === 'src/a.ts' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
  const ui = await $.ui.mount(message('See demo-a1b2c.'))
  await settle(clock)
  await ui.press({
    key: 'msg-m1-demo-a1b2c-link',
    link: { href: 'https://beads.invalid/demo-a1b2c' },
  })
  const pane = await $.ui.mount(PANE)
  await settle(clock)
  expect(textOf(await pane.find({ key: 'desc' }))).toBe(
    `The [design](https://github.com/acme/widgets/blob/${sha}/docs/design.md), ` +
      'the [code](src/a.ts) and the lost.',
  )
  await pane.unmount()
  await ui.unmount()
})

test('a click from the list waits on the list, never on a bead shown before it', async ($, on) => {
  const clock = mock.clock(on, { now: NOW })
  on(
    'process.run',
    fakeBd({
      beads: {
        'demo-aaa1': row('demo-aaa1', { title: 'First' }),
        'demo-bbb2': row('demo-bbb2', { title: 'Second', comment_count: 1 }),
      },
      comments: {
        'demo-bbb2': [{ author: 'Ana', text: 'Note.', created_at: '2026-11-05T12:00:00Z' }],
      },
    }),
  )
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
  const ui = await $.ui.mount(message('See demo-aaa1 and demo-bbb2.'))
  await settle(clock)
  await ui.press({
    key: 'msg-m1-demo-aaa1-link',
    link: { href: 'https://beads.invalid/demo-aaa1' },
  })
  const pane = await $.ui.mount(PANE)
  await settle(clock)
  await pane.press({ key: 'crumb-home', link: { href: 'https://beads.invalid/~home' } })
  await settle(clock)

  // demo-bbb2's comments aren't in yet: the pane keeps the list, not demo-aaa1.
  await pane.press({
    key: 'mentioned-demo-bbb2-title',
    link: { href: 'https://beads.invalid/demo-bbb2' },
  })
  expect(await pane.find({ key: 'mentioned-section' })).toBeTruthy()
  expect(await pane.find({ key: 'trail' })).toBeFalsy()
  await settle(clock)
  expect(await trailOf(pane)).toBe('### [▤](https://beads.invalid/~home) › demo-bbb2')
  await pane.unmount()
  await ui.unmount()
})
