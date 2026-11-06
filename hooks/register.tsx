import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunResult, Register, RenderChildren } from 'claude-code'

import type { Lookup, Ref, Setup } from '../types'
import {
  ago,
  barRuns,
  changedBy,
  idsIn,
  linkIds,
  countByStatus,
  parseAssigned,
  parseChildren,
  parsePrefix,
  parseShown,
  summarised,
  trailLabels,
} from './beads'

// Links the mod draws point here, a host that can't resolve, and a press on
// one is answered by the mod. `~home` and `~all` are the pane's own verbs.
const BASE = 'https://beads.invalid/'
const PANE = 'bead'
const TIMEOUT_MS = 10000
const CONFIGURE = '/plugin configure bead-pane@bead-pane'

// null: not asked yet this session.
const setup = atom({ plugin: 'bead-pane', key: 'setup' } as const, null, {
  shape: 'setup-1',
})
// Change the tag when Lookup's or Bead's fields change.
const beads = atom(
  { plugin: 'bead-pane', key: 'beads' } as const,
  {},
  {
    shape: 'beads-7',
  },
)
// The bead the pane shows; null for the session's list.
const selected = atom({ plugin: 'bead-pane', key: 'selected' } as const, null, {
  shape: 'selected-1',
})

// The bead whose long list of children the person has opened in full, if any.
// Moving to another bead leaves it, so each long list starts summarised.
const expanded = atom({ plugin: 'bead-pane', key: 'expanded' } as const, null, {
  shape: 'expanded-1',
})

// The beads this session has touched, by ID: what it last did to each and when.
const touched = atom(
  { plugin: 'bead-pane', key: 'touched' } as const,
  {},
  {
    shape: 'touched-2',
  },
)

// One glyph per status, from empty to full as work moves on, drawn in the
// status colour. The header and every list use the same glyph. Closed's green
// is drawn dim everywhere, so open and in-progress beads stand out.
const GLYPH: Record<string, string> = {
  open: '○',
  in_progress: '◐',
  blocked: '⊘',
  closed: '●',
  deferred: '◌',
}

const STATUS: Record<string, { label: string; color: string }> = {
  open: { label: 'Open', color: 'suggestion' },
  in_progress: { label: 'In progress', color: 'warning' },
  blocked: { label: 'Blocked', color: 'error' },
  closed: { label: 'Closed', color: 'success' },
  deferred: { label: 'Deferred', color: 'subtle' },
}
const statusOf = (status: string) =>
  STATUS[status] ?? {
    label: status.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase()),
    color: 'subtle',
  }
const priorityColor = (p: number) => (p <= 1 ? 'error' : p === 2 ? 'warning' : 'subtle')

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err))

// For work nothing awaits, such as a timer's or a press's, whose failure
// would otherwise go unseen.
function logFailure($: EngineInterface, what: string, err: unknown): void {
  $.ui.log(`bead-pane: ${what} failed: ${messageOf(err)}`, { to: 'debug' })
}

type Ran = { kind: 'ran'; result: ProcessRunResult } | { kind: 'failed'; detail: string }

// Runs bd. `failed` when it can't start or doesn't answer in time.
async function runBd($: EngineInterface, bd: string, args: readonly string[]): Promise<Ran> {
  try {
    return { kind: 'ran', result: await $.process.run([bd, ...args], { timeoutMs: TIMEOUT_MS }) }
  } catch (err) {
    return { kind: 'failed', detail: messageOf(err) }
  }
}

// The project's ID prefix, asked of bd once per load. A reload, such as the
// one after the person sets the bd path, asks again, and so does `/beads`
// while the answer is a problem.
let asking: Promise<Setup> | null = null
function setupOf($: EngineInterface, bd: string): Promise<Setup> {
  asking ??= (async () => {
    const ran = await runBd($, bd, ['config', 'get', 'issue_prefix'])
    const found: Setup =
      ran.kind === 'failed'
        ? { kind: 'no-bd', bd, detail: ran.detail }
        : ran.result.exitCode === 0 && parsePrefix(ran.result.stdout) !== null
          ? { kind: 'ready', prefix: ran.result.stdout.trim() }
          : { kind: 'no-database', detail: (ran.result.stderr || ran.result.stdout).trim() }
    await update($, setup, () => found)
    return found
  })()
  return asking
}

// From a draw: asks after it, so the draw doesn't wait on bd.
function ensureSetup($: EngineInterface, bd: string): void {
  if (asking) return
  $.clock.after(0, () => {
    setupOf($, bd).catch(err => logFailure($, 'asking bd for the prefix', err))
  })
}

// Bead IDs asked about this load. Answers stay in `beads` across a reload,
// so a draw asks only about an ID it has no answer for. A bd command that
// changes a bead, or opening the bead in the pane, asks again.
const asked = new Set<string>()
let pending: string[] = []

// Looks beads up after the current draw. Every ID asked before the lookup
// starts goes in one `bd show`.
function ensure($: EngineInterface, bd: string, ids: readonly string[]): void {
  const fresh = ids.filter(id => !asked.has(id))
  if (fresh.length === 0) return
  for (const id of fresh) asked.add(id)
  const isScheduled = pending.length > 0
  pending = [...pending, ...fresh]
  if (isScheduled) return
  $.clock.after(0, () => {
    lookUp($, bd).catch(err => logFailure($, 'looking beads up', err))
  })
}

function refresh($: EngineInterface, bd: string, ids: readonly string[]): void {
  for (const id of ids) asked.delete(id)
  ensure($, bd, ids)
}

// One `bd show` for the pending IDs, then `bd children` for each bead that can
// have children, one at a time. Writing the atom redraws what reads it.
async function lookUp($: EngineInterface, bd: string): Promise<void> {
  const ids = pending
  pending = []
  const shown = await runBd($, bd, ['show', ...ids, '--json'])
  const { lookups, withChildren } =
    shown.kind === 'ran'
      ? parseShown(ids, shown.result)
      : {
          lookups: Object.fromEntries(
            ids.map((id): [string, Lookup] => [id, { kind: 'failed', detail: shown.detail }]),
          ),
          withChildren: [],
        }
  for (const id of withChildren) {
    const entry = lookups[id]
    if (entry?.kind !== 'found') continue
    const kids = await runBd($, bd, ['children', id, '--json'])
    lookups[id] =
      kids.kind === 'ran' && kids.result.exitCode === 0
        ? { kind: 'found', bead: { ...entry.bead, children: parseChildren(kids.result.stdout) } }
        : {
            kind: 'failed',
            detail:
              kids.kind === 'failed'
                ? kids.detail
                : kids.result.stderr.trim() || 'bd children failed',
          }
  }
  await update($, beads, all => ({ ...all, ...lookups }))
}

// Adds the open beads the beads actor holds, once per load: a bead this
// session claimed before a reload, or in a turn whose command the mod missed.
let isActorAsked = false
function askActor($: EngineInterface, bd: string): void {
  if (isActorAsked) return
  isActorAsked = true
  $.clock.after(0, () => {
    addAssigned($, bd).catch(err => logFailure($, "listing the actor's beads", err))
  })
}

async function addAssigned($: EngineInterface, bd: string): Promise<void> {
  const actor = await $.env.get('BEADS_ACTOR')
  if (!actor) return
  const ran = await runBd($, bd, [
    'list',
    '--assignee',
    actor,
    '--status',
    'open,in_progress,blocked,deferred',
    '--json',
  ])
  if (ran.kind !== 'ran' || ran.result.exitCode !== 0) return
  const assigned = parseAssigned(ran.result.stdout)
  await update($, touched, all => ({
    ...Object.fromEntries(assigned.map(r => [r.id, { how: 'assigned' as const, atMs: r.atMs }])),
    ...all,
  }))
}

// Adds the beads the session's title names, unless a command touched them.
async function addTitled($: EngineInterface, bd: string, title: string): Promise<void> {
  const found = await setupOf($, bd)
  if (found.kind !== 'ready') return
  const ids = idsIn(title, found.prefix)
  if (ids.length === 0) return
  const atMs = await $.clock.now()
  await update($, touched, all => ({
    ...Object.fromEntries(ids.map(id => [id, { how: 'in title' as const, atMs }])),
    ...all,
  }))
}

// Opens the pane on one bead, or on the session's list for null.
async function openPane($: EngineInterface, id: string | null): Promise<void> {
  await update($, selected, () => id)
  await $.ui.open({ id: PANE, title: 'Beads' })
}

export const register: Register = (on, options) => {
  const bd =
    typeof options.bd_path === 'string' && options.bd_path.trim() !== ''
      ? options.bd_path.trim()
      : 'bd'

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'beads',
      description: 'Show the beads this session has claimed or worked on',
    })
    return next(e)
  })

  // The title as the session starts or resumes. A rename later in the
  // session shows at its next start: reading it on each prompt would add
  // work to every prompt. The lookup runs after the event.
  on('classic.SessionStart', async ($, e, next) => {
    const title = e.session_title
    if (title)
      $.clock.after(0, () => {
        addTitled($, bd, title).catch(err => logFailure($, "reading the session's title", err))
      })
    return next(e)
  })

  on('command.run', { command: 'beads' }, async $ => {
    if ((await read($, setup))?.kind !== 'ready') asking = null
    refresh($, bd, Object.keys(await read($, touched)))
    await openPane($, null)
    return { text: 'Opened the beads pane.' }
  })

  // Records each bead a shell command changed, the main loop's or a
  // subagent's, and asks again about the beads it named and their parents,
  // whose children it may have changed.
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const ran = await next(e)
    if (!/\bbd\s/.test(e.command)) return ran
    const found = await setupOf($, bd)
    if (found.kind !== 'ready') return ran
    const out = ran.result && !ran.isError ? ran.result.stdout : ''
    const changed = changedBy(e.command, out, found.prefix)
    if (changed.length === 0) return ran
    const atMs = await $.clock.now()
    await update($, touched, all => ({
      ...all,
      ...Object.fromEntries(changed.map(c => [c.id, { how: c.how, atMs }])),
    }))
    // A named bead the mod hasn't asked about yet waits until a draw needs it.
    const known = await read($, beads)
    const named = [
      ...changed.map(c => c.id),
      ...idsIn(e.command, found.prefix).filter(id => id in known),
    ]
    const parents = named.flatMap(id => {
      const entry = known[id]
      return entry?.kind === 'found' && entry.bead.parent ? [entry.bead.parent.id] : []
    })
    refresh($, bd, [...new Set([...named, ...parents])])
    return ran
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // The terminal marks a summary row only when it draws the row itself.
    if (e.props.isSummary) return next(e)
    const found = await read($, setup)
    if (found?.kind !== 'ready') {
      ensureSetup($, bd)
      return next(e)
    }
    const ids = idsIn(e.props.text, found.prefix)
    if (ids.length === 0) return next(e)

    const known = await read($, beads)
    ensure(
      $,
      bd,
      ids.filter(id => !(id in known)),
    )

    // Only a bead the lookup found becomes a link; the rest stays text.
    const links = ids.filter(id => known[id]?.kind === 'found')
    if (links.length === 0) return next(e)

    const { Markdown } = $.ui.resolve(e)
    const text = linkIds(e.props.text, found.prefix, id =>
      known[id]?.kind === 'found' ? `[${id}](${BASE}${id})` : null,
    )

    return (
      <Markdown
        key={`msg-${e.requestId}`}
        text={text}
        pressableLinks={links.map(id => `${BASE}${id}`)}
        onLinkPress={link => {
          openPane($, link.href.slice(BASE.length)).catch(err =>
            logFailure($, 'opening a bead', err),
          )
        }}
      />
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const found = await read($, setup)
    if (found?.kind !== 'ready') {
      ensureSetup($, bd)
      return (
        <Box flexDirection="column" gap="xs">
          {found === null && <Text color="subtle">Looking for the beads database…</Text>}
          {found?.kind === 'no-bd' && (
            <Text>
              Couldn't run {found.bd}: {found.detail}
            </Text>
          )}
          {found?.kind === 'no-bd' && (
            <Text color="subtle">
              If bd isn't on the PATH Claude Code starts with, set its full path with {CONFIGURE}.
            </Text>
          )}
          {found?.kind === 'no-database' && (
            <Text>bd found no beads database from this session's folder.</Text>
          )}
          {found?.kind === 'no-database' && found.detail !== '' && (
            <Text color="subtle">{found.detail}</Text>
          )}
          {found?.kind === 'no-database' && (
            <Text color="subtle">After creating one, run /beads to look again.</Text>
          )}
        </Box>
      )
    }
    const prefix = found.prefix
    const id = await read($, selected)
    const all = await read($, beads)

    const nowMs = await $.clock.now()
    const isExpanded = (await read($, expanded)) === id
    // Every link in the pane is Markdown, so one handler serves them all.
    const press = async (href: string) => {
      const target = href.slice(BASE.length)
      if (target === '~all') return update($, expanded, v => (v === id ? null : id))
      if (target === '~home') return update($, selected, () => null)
      refresh($, bd, [target])
      return update($, selected, () => target)
    }
    const md = (key: string, text: string) => {
      const links = [...text.matchAll(/\]\(([^)\s]+)\)/g)].flatMap(m =>
        m[1]?.startsWith(BASE) ? [m[1]] : [],
      )
      return (
        <Markdown
          key={key}
          text={text}
          pressableLinks={links}
          onLinkPress={link => {
            press(link.href).catch(err => logFailure($, 'following a link in the pane', err))
          }}
        />
      )
    }
    const link = (to: string, label = to) => `[${label}](${BASE}${to})`
    // An ID in prose keeps its hyphen from breaking the line (`demo-` /
    // `g5h6`): the label gets a non-breaking hyphen, the link keeps the real ID.
    const linkify = (text: string) =>
      linkIds(text, prefix, ref => link(ref, ref.replace(/-/g, '‑')))

    // A section: a small upper-case heading over its content.
    const section = (key: string, heading: string, body: RenderChildren, color = 'subtle') => (
      <Box key={key} flexDirection="column" gap="xs">
        <Text size="caption" weight="semibold" color={color}>
          {heading.toUpperCase()}
        </Text>
        {body}
      </Box>
    )
    // A list of beads, one row each: the ID in a grey column, the status glyph,
    // and the title as the link. A closed bead's title isn't dimmed, because
    // dim link blue on a dark background is hard to read. Children show only
    // their own `.n`, since the parent's ID is in the breadcrumb.
    const list = (key: string, refs: Ref[], parentId = '', notes: Record<string, string> = {}) => {
      const shortOf = (r: Ref) =>
        parentId && r.id.startsWith(`${parentId}.`) ? r.id.slice(parentId.length) : r.id
      // The ID column is as wide as the longest ID in this list and no wider:
      // `.1`–`.7` take two cells, a list that reaches `.178` takes four.
      const idWidth = Math.max(...refs.map(r => shortOf(r).length))
      return (
        <Box key={key} flexDirection="column">
          {refs.map(r => (
            <Box key={`${key}-${r.id}`} gap="xs" alignItems="flex-start">
              <Box width={idWidth} flexShrink={0}>
                <Text color="subtle">{shortOf(r)}</Text>
              </Box>
              <Text color={statusOf(r.status).color} dimColor={r.status === 'closed'}>
                {GLYPH[r.status] ?? '○'}
              </Text>
              <Box flexGrow={1} flexShrink={1}>
                {md(`${key}-${r.id}-title`, link(r.id, r.title || r.id))}
              </Box>
              {notes[r.id] && (
                <Text size="footnote" color="subtle">
                  {notes[r.id]}
                </Text>
              )}
            </Box>
          ))}
        </Box>
      )
    }

    // Home: the beads this session has touched, most recent first, with what
    // it last did to each. The pane's title says what it is.
    if (id === null) {
      askActor($, bd)
      const seen = Object.entries(await read($, touched)).sort(([, a], [, b]) => b.atMs - a.atMs)
      ensure(
        $,
        bd,
        seen.flatMap(([ref]) => (ref in all ? [] : [ref])),
      )
      const rows: Ref[] = seen.flatMap(([ref]) => {
        const entry = all[ref]
        if (entry?.kind === 'missing') return []
        const bead = entry?.kind === 'found' ? entry.bead : null
        return [{ id: ref, title: bead?.title ?? '', status: bead?.status ?? '' }]
      })
      const notes = Object.fromEntries(seen.map(([ref, t]) => [ref, t.how]))
      return rows.length > 0 ? (
        list('session', rows, '', notes)
      ) : (
        <Text color="subtle">
          None yet. A bead this session claims, creates, changes or closes shows here.
        </Text>
      )
    }
    const entry = all[id]
    if (entry === undefined) return <Text color="subtle">Loading {id}…</Text>
    if (entry.kind === 'missing')
      return <Text color="subtle">{id} is not a bead in this project.</Text>
    if (entry.kind === 'failed') {
      return (
        <Box flexDirection="column" gap="xs">
          <Text>
            Couldn't read {id}: {entry.detail}
          </Text>
          {md('retry', link(id, 'Try again'))}
        </Box>
      )
    }
    const bead = entry.bead

    // The chain of beads above this one, outermost first, as far as it is known.
    const above: Ref[] = []
    for (let ref = bead.parent, depth = 0; ref && depth < 8; depth++) {
      above.unshift(ref)
      const up = all[ref.id]
      ref = up?.kind === 'found' ? up.bead.parent : null
    }
    ensure(
      $,
      bd,
      [...above, ...bead.blockedBy].flatMap(r => (r.id in all ? [] : [r.id])),
    )

    // The breadcrumb: "Recent", the pane's list, then each bead above, then
    // this one, unlinked.
    const chain = [...above.map(r => r.id), id]
    const trail = trailLabels(chain)
      .map((label, i) => (i === chain.length - 1 ? label : link(chain[i] ?? '', label)))
      .join(' › ')
    const crumbs = `${link('~home', 'Recent')} › ${trail}`

    const status = statusOf(bead.status)

    const openBlockers = bead.blockedBy.filter(b => b.status !== 'closed')
    const doneBlockers = bead.blockedBy.length - openBlockers.length

    const kids = bead.children
    const doneKids = kids.filter(k => k.status === 'closed')
    // A bar with a run of cells in each status's colour, done first, as the
    // context bar shows what fills the window.
    const runs = barRuns(kids, 20)
    // A long list is summarised: a count for each status left, then the work
    // left and a link to the rest. The heading counts the closed ones.
    const LONG = 12
    const FIRST = 8
    const isLong = kids.length > LONG
    const shown = isLong && !isExpanded ? summarised(kids, FIRST) : kids
    const counts = countByStatus(kids).filter(([st]) => st !== 'closed')
    const children = kids.length > 0 && (
      <Box key="children" flexDirection="column" gap="xs">
        <Box gap="sm" alignItems="center">
          <Text size="caption" weight="semibold" color="subtle">
            CHILDREN
          </Text>
          <Text size="caption" color="subtle">
            {doneKids.length}/{kids.length}
          </Text>
          <Text size="caption">
            {runs.map(([st, n]) => (
              <Text key={`bar-${st}`} color={statusOf(st).color} dimColor={st === 'closed'}>
                {'━'.repeat(n)}
              </Text>
            ))}
          </Text>
        </Box>
        {isLong && counts.length > 0 && (
          <Box gap="md" flexWrap="wrap">
            {counts.map(([st, n]) => (
              <Text key={`count-${st}`} size="footnote">
                <Text color={statusOf(st).color}>{GLYPH[st] ?? '○'} </Text>
                {n} {statusOf(st).label.toLowerCase()}
              </Text>
            ))}
          </Box>
        )}
        {list('kids', shown, id)}
        {isLong && md('all', link('~all', isExpanded ? 'Show fewer' : `Show all ${kids.length}`))}
      </Box>
    )

    const isEpic = bead.type === 'epic'

    return (
      <Box flexDirection="column" gap="lg">
        <Box flexDirection="column" gap="xs">
          {/* The breadcrumb row is always drawn, so the rest of the pane stays
              in place when it moves to another bead. It is the pane's only
              navigation: "Recent" leads to this session's beads, ancestors
              are links, and the conversation's links reopen anything else. */}
          <Box>{md('trail', crumbs)}</Box>
          <Text size="heading" weight="semibold">
            {bead.title}
          </Text>
          <Text size="footnote">
            <Text color={status.color} dimColor={bead.status === 'closed'}>
              {GLYPH[bead.status] ?? '○'}{' '}
            </Text>
            {status.label}
            {bead.priority !== null && <Text color="subtle">{'  ·  '}</Text>}
            {bead.priority !== null && (
              <Text color={priorityColor(bead.priority)}>P{bead.priority}</Text>
            )}
            {bead.type !== '' && <Text color="subtle">{'  ·  '}</Text>}
            {bead.type !== '' && bead.type.replace(/^./, c => c.toUpperCase())}
            <Text color="subtle">{'  ·  '}</Text>
            {bead.assignee ? bead.assignee : <Text color="subtle">Unassigned</Text>}
          </Text>
          <Text size="caption" color="subtle">
            Updated {ago(bead.updatedMs, nowMs)} · created {ago(bead.createdMs, nowMs)}
          </Text>
        </Box>
        {openBlockers.length > 0 &&
          section('blockers', 'Blocked by', list('blocker-list', openBlockers), 'error')}
        {openBlockers.length === 0 && doneBlockers > 0 && (
          <Text size="footnote" color="subtle">
            <Text color="success" dimColor>
              {GLYPH.closed}{' '}
            </Text>
            {doneBlockers === 1
              ? 'Its blocker is closed'
              : `All ${doneBlockers} blockers are closed`}
          </Text>
        )}
        {isEpic && children}
        {bead.description.trim() !== '' &&
          section('description', 'Description', md('desc', linkify(bead.description)))}
        {bead.status === 'closed' &&
          bead.closeReason.trim() !== '' &&
          section('resolution', 'Resolution', md('text-resolution', linkify(bead.closeReason)))}
        {bead.extras.map(x =>
          section(`extra-${x.label}`, x.label, md(`text-${x.label}`, linkify(x.text))),
        )}
        {!isEpic && children}
      </Box>
    )
  })
}
