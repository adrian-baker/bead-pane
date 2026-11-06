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
          row('demo-a1b2c.10', { title: 'Tenth' }),
          row('demo-a1b2c.9', { title: 'Ninth', status: 'closed' }),
        ],
      },
    }),
  )
  // The engine's own drawing of a message: its text as Markdown.
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Markdown } = $.ui.resolve(e)
    return <Markdown text={e.props.text} />
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const msg = message(
    'See demo-a1b2c and demo-g5h6.4. In code, `bd show demo-a1b2c` and\n\n```\nbd close demo-g5h6.4\n```\n\nstay as written, as does demo-nope.',
  )
  const ui = await $.ui.mount(msg)
  await settle(clock)
  expect(textOf(await ui.find({ type: 'Markdown' }))).toBe(
    'See [demo-a1b2c](https://beads.invalid/demo-a1b2c) and [demo-g5h6.4](https://beads.invalid/demo-g5h6.4). In code, `bd show demo-a1b2c` and\n\n```\nbd close demo-g5h6.4\n```\n\nstay as written, as does demo-nope.',
  )
  await ui.press({ key: 'msg-m1', link: { href: 'https://beads.invalid/demo-a1b2c' } })

  const pane = await $.ui.mount(PANE)
  await settle(clock)
  const text = async (key: string) => textOf(await pane.find({ key }))
  expect(await text('desc')).toBe('Follow-up to [demo‑d3e4f](https://beads.invalid/demo-d3e4f).')
  expect(await text('text-Notes')).toBe('Check the fixtures first.')
  expect(await text('trail')).toBe(
    '[Recent](https://beads.invalid/~home) › [demo-p0000](https://beads.invalid/demo-p0000) › demo-a1b2c',
  )
  // In ID order whatever their status, `.9` before `.10`, each by its own `.n`.
  expect(keysOf((await pane.find({ key: 'kids' }))?.children)).toEqual([
    'kids-demo-a1b2c.9',
    'kids-demo-a1b2c.10',
  ])
  expect(await text('kids-demo-a1b2c.9-title')).toBe('[Ninth](https://beads.invalid/demo-a1b2c.9)')
  expect(await pane.find({ type: 'Text', text: /^\.10$/ })).toBeTruthy()
  expect(await pane.find({ key: 'text-resolution' })).toBeFalsy()
  expect(await pane.find({ type: 'Text', text: /P3/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /Its blocker is closed/ })).toBeTruthy()

  // A link in the description moves the pane, and the breadcrumb leads back up.
  await pane.press({ key: 'desc', link: { href: 'https://beads.invalid/demo-d3e4f' } })
  await settle(clock)
  expect(await text('trail')).toBe('[Recent](https://beads.invalid/~home) › demo-d3e4f')
  await pane.press({ key: 'trail', link: { href: 'https://beads.invalid/~home' } })
  expect(await pane.find({ type: 'Text', text: /^None yet\./ })).toBeTruthy()

  // Back to the bead from the conversation, and up to a parent bd doesn't know.
  await ui.press({ key: 'msg-m1', link: { href: 'https://beads.invalid/demo-a1b2c' } })
  await pane.press({ key: 'trail', link: { href: 'https://beads.invalid/demo-p0000' } })
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
    row(`demo-epic1.${i + 1}`, { status: i < 15 ? 'closed' : 'open' }),
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
  await ui.press({ key: 'msg-m1', link: { href: 'https://beads.invalid/demo-epic1' } })
  await ui.unmount()

  const pane = await $.ui.mount(PANE)
  await settle(clock)
  const rows = async () => keysOf((await pane.find({ key: 'kids' }))?.children).length
  // Summarised, the list shows the work left: the five still open.
  expect(keysOf((await pane.find({ key: 'kids' }))?.children)).toEqual(
    [16, 17, 18, 19, 20].map(n => `kids-demo-epic1.${n}`),
  )
  expect(await pane.find({ type: 'Text', text: /^15\/20$/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /5 open/ })).toBeTruthy()
  // The bar is 20 cells: 15 closed, then 5 open.
  expect(await pane.find({ type: 'Text', text: /^━{15}$/ })).toBeTruthy()
  expect(await pane.find({ type: 'Text', text: /^━{5}$/ })).toBeTruthy()
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
  expect(keysOf((await pane.find({ key: 'session' }))?.children).sort()).toEqual([
    'session-demo-clm1',
    'session-demo-new1',
    'session-demo-old1',
  ])
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

test('IDs use the prefix bd reports for the project', async ($, on) => {
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
})

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
    key: 'session-demo-a1b2c-title',
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
  expect(keysOf((await pane.find({ key: 'session' }))?.children)).toEqual(['session-demo-t1t2'])
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
    await ui.press({ key: 'msg-m1', link: { href: 'https://beads.invalid/demo-a1b2c' } })
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
  await ui.press({ key: 'msg-m1', link: { href: 'https://beads.invalid/demo-a1b2c' } })
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
