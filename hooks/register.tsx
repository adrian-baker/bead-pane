import { atom, read, update } from 'claude-code'
import type { EngineInterface, ProcessRunResult, Register, RenderChildren } from 'claude-code'

import type { Lookup, Ref, Setup } from '../types'
import type { IconName } from './beads'
import {
  ago,
  barRuns,
  changedBy,
  countBubble,
  datedEntries,
  fileLinks,
  iconSvg,
  keepLineBreaks,
  linkGitHub,
  noteWhen,
  parseGitHubRepo,
  refLabel,
  refUrl,
  idsIn,
  isWork,
  linkIds,
  countByStatus,
  JOURNAL,
  parseAssigned,
  parseChildren,
  parseComments,
  parseDatabasePath,
  parsePrefix,
  parseShown,
  summarised,
  typeIcon,
  progressBar,
  underParents,
  relinkFiles,
} from './beads'

// Links the mod draws point here, a host that can't resolve, and a press on
// one is answered by the mod. `~home` and `~all` are the pane's own verbs.
const BASE = 'https://beads.invalid/'
const PANE = 'bead'
const TIMEOUT_MS = 10000
const CONFIGURE = '/plugin configure bead-pane@bead-pane'
// A tree branch, the height of one line of text: the vertical line runs
// through the row and turns into it, ending in a rounded elbow on the last.
const BRANCH_WIDTH = 14
// A body line's height on a desktop: taller, a child's row would sit
// further from the next than its parent does from it.
const BRANCH_HEIGHT = 21
// The cells of an ID column the branch takes, at about 8px a cell.
const BRANCH_CELLS = 2
const BRANCH_COLOUR = '#5a5a5a'
const branchSvg = (isLast: boolean): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BRANCH_WIDTH} ${BRANCH_HEIGHT}" ` +
  `fill="none" stroke="${BRANCH_COLOUR}" stroke-width="1.5" stroke-linecap="round">` +
  `<path d="${
    isLast
      ? `M6 0V${BRANCH_HEIGHT / 2 - 4}Q6 ${BRANCH_HEIGHT / 2} 10 ${BRANCH_HEIGHT / 2}H14`
      : `M6 0V${BRANCH_HEIGHT}M6 ${BRANCH_HEIGHT / 2}H14`
  }"/></svg>`

// The tree's line below a wrapped row's first line, longer than any row.
const STEM_HEIGHT = 400
const STEM_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${BRANCH_WIDTH} ${STEM_HEIGHT}" ` +
  `preserveAspectRatio="none" fill="none" stroke="${BRANCH_COLOUR}" stroke-width="1.5">` +
  `<path d="M6 ${BRANCH_HEIGHT}V${STEM_HEIGHT}" vector-effect="non-scaling-stroke"/></svg>`

// The branch's arm on to the child's ID, longer than any ID column. A
// desktop shrinks it to its box, so it stretches out of proportion and keeps
// its line's width, rather than thinning to a hairline.
const ARM_WIDTH = 400
const ARM_SVG =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${ARM_WIDTH} ${BRANCH_HEIGHT}" ` +
  `preserveAspectRatio="none" fill="none" stroke="${BRANCH_COLOUR}" stroke-width="1.5">` +
  `<path d="M0 ${BRANCH_HEIGHT / 2}H${ARM_WIDTH}" vector-effect="non-scaling-stroke"/></svg>`

// The breadcrumb's separator, in the grey of the theme's subtle text.
const CHEVRON_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 7 11" fill="none" stroke="#8b8b8b" ' +
  'stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 1.5L5.5 5.5L1.5 9.5"/></svg>'

const EXTRA_ICONS: Record<string, IconName> = {
  Notes: 'notes',
  Design: 'design',
  'Acceptance criteria': 'acceptance',
}
// null: not asked yet this session.
const setup = atom({ plugin: 'bead-pane', key: 'setup' } as const, null, {
  shape: 'setup-2',
})
// Change the tag when Lookup's or Bead's fields change.
const beads = atom(
  { plugin: 'bead-pane', key: 'beads' } as const,
  {},
  {
    shape: 'beads-8',
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
// Kept per bead, so moving to another one leaves its list unfiltered.
const only = atom({ plugin: 'bead-pane', key: 'only' } as const, null, { shape: 'only-1' })

// The beads this session has touched, by ID: what it last did to each and when.
const touched = atom(
  { plugin: 'bead-pane', key: 'touched' } as const,
  {},
  {
    shape: 'touched-2',
  },
)

const pulse = atom({ plugin: 'bead-pane', key: 'pulse' } as const, 0, { shape: 'pulse-1' })

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
    const prefix =
      ran.kind === 'ran' && ran.result.exitCode === 0 ? parsePrefix(ran.result.stdout) : null
    const found: Setup =
      ran.kind === 'failed'
        ? { kind: 'no-bd', bd, detail: ran.detail }
        : prefix !== null
          ? { kind: 'ready', prefix, repo: await repoOf($) }
          : { kind: 'no-database', detail: (ran.result.stderr || ran.result.stdout).trim() }
    await update($, setup, () => found)
    return found
  })()
  return asking
}

// The GitHub repository of the session's folder, for linking PR and issue
// numbers; null outside a git checkout or for a remote elsewhere.
async function repoOf($: EngineInterface): Promise<string | null> {
  try {
    const ran = await $.process.run(['git', 'remote', 'get-url', 'origin'], {
      timeoutMs: TIMEOUT_MS,
    })
    return ran.exitCode === 0 ? parseGitHubRepo(ran.stdout) : null
  } catch {
    // No git on this machine: the pane shows numbers without links.
    return null
  }
}

// From a draw: asks after it, so the draw doesn't wait on bd.
function ensureSetup($: EngineInterface, bd: string): void {
  if (asking) return
  $.clock.after(0, () => {
    setupOf($, bd).catch(err => logFailure($, 'asking bd for the prefix', err))
  })
}

// Whether each file a bead links to exists, by its path from the session's
// folder, and for one that doesn't, its copy on GitHub at the newest pushed
// commit that has it, or null when none does. Each asked once per load.
const fileExists = new Map<string, boolean>()
const fileElsewhere = new Map<string, string | null>()

// Finds a file missing from the session's folder on the branches pushed to
// origin, such as a design on an open pull request's branch, after the draw.
function findElsewhere($: EngineInterface, path: string, repo: string): void {
  fileElsewhere.set(path, null)
  $.clock.after(0, () => {
    lookElsewhere($, path, repo).catch(err => logFailure($, 'finding a linked file', err))
  })
}

async function lookElsewhere($: EngineInterface, path: string, repo: string): Promise<void> {
  const ran = await $.process.run(
    ['git', 'log', '--remotes=origin', '--diff-filter=AM', '--format=%H', '-1', '--', path],
    { timeoutMs: TIMEOUT_MS },
  )
  const sha = ran.exitCode === 0 ? ran.stdout.trim() : ''
  if (!/^[0-9a-f]{40}$/.test(sha)) return
  fileElsewhere.set(path, `https://github.com/${repo}/blob/${sha}/${path}`)
  await update($, pulse, n => n + 1)
}

// Beads whose comments the pane has asked for and not yet had back.
const commentsPending = new Set<string>()

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
  // The comments of the bead the pane shows, so a list of beads needs no more calls.
  const shownId = await read($, selected)
  const onPane = shownId === null ? undefined : lookups[shownId]
  if (shownId !== null && onPane?.kind === 'found' && onPane.bead.commentCount > 0) {
    const said = await runBd($, bd, ['comments', shownId, '--json'])
    lookups[shownId] =
      said.kind === 'ran' && said.result.exitCode === 0
        ? { kind: 'found', bead: { ...onPane.bead, comments: parseComments(said.result.stdout) } }
        : {
            kind: 'failed',
            detail:
              said.kind === 'failed'
                ? said.detail
                : said.result.stderr.trim() || 'bd comments failed',
          }
  }
  await update($, beads, all => ({ ...all, ...lookups }))
  for (const id of ids) commentsPending.delete(id)
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

// Keeping the pane current with writes made outside this session. Where the
// project's Dolt data is on this machine, `tail -F` on its journal reports
// each write as it lands, and costs nothing between writes. Elsewhere, such
// as a Dolt server on another machine, the mod asks bd every 5 seconds while
// the pane is open.
let isWatching = false
// Set once there's no journal to follow; `isPolling` while a poll is due.
let isPollMode = false
let isPolling = false
let isRefreshPending = false
// When the pane last drew, and when the mod last bumped `pulse`. The pane
// reads `pulse`, so an open pane draws after each bump. A pane that hasn't
// drawn since the last bump is closed, and a refresh then skips its lookup.
let lastDrawMs = 0
// What the pane last drew in full: a bead, null for the session's list, or
// undefined before its first draw.
let lastShown: string | null | undefined = undefined
// The bead the pane is waiting to draw, and since when. A lookup that takes
// longer than OPENING_MS shows "opening…"; a quicker one just swaps in.
let waiting: { id: string; sinceMs: number } | null = null
const OPENING_MS = 300

// Redraws the pane once the wait has run long enough to show "opening…".
function showOpeningLater($: EngineInterface): void {
  $.clock.after(OPENING_MS, () => {
    // A lookup that finished in time leaves nothing to redraw.
    if (waiting === null) return
    update($, pulse, n => n + 1).catch(err => logFailure($, 'redrawing the pane', err))
  })
}
let lastPulseMs = 0
const POLL_MS = 5000
// Writes within this much of each other share one lookup.
const SETTLE_MS = 500

function watchChanges($: EngineInterface, bd: string): void {
  if (isWatching) return
  isWatching = true
  $.clock.after(0, () => {
    follow($, bd).catch(err => logFailure($, 'watching for bead changes', err))
  })
}

// The journals of the databases in the project's Dolt folder. A server's
// folder holds one database per subfolder; an embedded one is the database.
async function journalsOf($: EngineInterface, bd: string): Promise<string[]> {
  const ran = await runBd($, bd, ['info', '--json'])
  const root =
    ran.kind === 'ran' && ran.result.exitCode === 0 ? parseDatabasePath(ran.result.stdout) : null
  if (!root || !(await $.fs.exists(root))) return []
  const dirs = (await $.fs.list(root)).filter(
    entry => entry.kind === 'dir' && !entry.name.startsWith('.'),
  )
  const found: string[] = []
  for (const dir of dirs) {
    const path = `${root}/${dir.name}/.dolt/noms/${JOURNAL}`
    if (await $.fs.exists(path)) found.push(path)
  }
  const own = `${root}/.dolt/noms/${JOURNAL}`
  return found.length > 0 ? found : (await $.fs.exists(own)) ? [own] : []
}

// Follows the journals until the module unloads, which stops `tail`. Polls
// when there's no journal, or when `tail` stops on its own.
async function follow($: EngineInterface, bd: string): Promise<void> {
  const journals = await journalsOf($, bd)
  if (journals.length > 0) {
    for await (const piece of $.process.spawn({ argv: ['tail', '-c', '0', '-F', ...journals] })) {
      if (piece.stream === 'stdout') onChange($, bd)
    }
  }
  isPollMode = true
  isPolling = true
  poll($, bd)
}

function onChange($: EngineInterface, bd: string): void {
  if (isRefreshPending) return
  isRefreshPending = true
  $.clock.after(SETTLE_MS, () => {
    isRefreshPending = false
    refreshShown($, bd).catch(err => logFailure($, 'refreshing the pane', err))
  })
}

function poll($: EngineInterface, bd: string): void {
  $.clock.after(POLL_MS, () => {
    if (lastDrawMs < lastPulseMs) {
      // Closed: the pane's next draw starts polling again.
      isPolling = false
      return
    }
    refreshShown($, bd)
      .catch(err => logFailure($, 'refreshing the pane', err))
      .finally(() => poll($, bd))
  })
}

// Looks up again what the pane shows: its bead, or the session's list.
async function refreshShown($: EngineInterface, bd: string): Promise<void> {
  if (lastDrawMs < lastPulseMs) return
  const id = await read($, selected)
  refresh($, bd, id === null ? Object.keys(await read($, touched)) : [id])
  lastPulseMs = await $.clock.now()
  await update($, pulse, n => n + 1)
}

// Opens the pane on one bead, or on the session's list for null.
async function openPane($: EngineInterface, id: string | null): Promise<void> {
  await update($, selected, () => id)
  await $.ui.open({ id: PANE, title: 'Beads' })
}

// Bead IDs a reply has linked this load, so each is added to the list once.
const mentioned = new Set<string>()

// From a draw: adds the beads a reply linked to the session's list, after the
// draw, unless the list already has them.
function markMentioned($: EngineInterface, ids: readonly string[]): void {
  const fresh = ids.filter(id => !mentioned.has(id))
  if (fresh.length === 0) return
  for (const id of fresh) mentioned.add(id)
  $.clock.after(0, () => {
    addMentioned($, fresh).catch(err => logFailure($, 'listing mentioned beads', err))
  })
}

async function addMentioned($: EngineInterface, ids: readonly string[]): Promise<void> {
  const atMs = await $.clock.now()
  await update($, touched, all => ({
    ...Object.fromEntries(ids.map(id => [id, { how: 'mentioned' as const, atMs }])),
    ...all,
  }))
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
      // Opening the pane changes nothing in the turn, so it needn't wait for one to end.
      immediate: true,
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
    return {}
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
    markMentioned($, links)

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
    const elements = $.ui.resolve(e)
    const { Box, Text, Markdown, Button } = elements
    // The terminal draws no SVG, so its headings go without an icon.
    const Svg = 'Svg' in elements ? elements.Svg : null
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
    const all = await read($, beads)
    const wanted = await read($, selected)
    // While the bead the pane moved to is looked up, or its comments are, it
    // keeps drawing the one it showed, so it switches once to the whole bead
    // instead of flashing "Loading…" or pushing the page down when the
    // comments arrive.
    const wantedEntry = wanted === null ? undefined : all[wanted]
    if (wanted !== null && wantedEntry === undefined) ensure($, bd, [wanted])
    if (
      wanted !== null &&
      wantedEntry?.kind === 'found' &&
      wantedEntry.bead.commentCount > 0 &&
      wantedEntry.bead.comments === null &&
      !commentsPending.has(wanted)
    ) {
      commentsPending.add(wanted)
      refresh($, bd, [wanted])
    }
    // It waits on the view it last drew, the list or a bead, so a click from
    // the list never shows a bead from earlier in between.
    const canWait =
      lastShown === null || (lastShown !== undefined && all[lastShown]?.kind === 'found')
    const isWaiting =
      wanted !== null &&
      wanted !== lastShown &&
      (wantedEntry === undefined || commentsPending.has(wanted)) &&
      canWait
    const id = isWaiting ? (lastShown ?? null) : wanted

    const nowMs = await $.clock.now()
    await read($, pulse)
    lastDrawMs = nowMs
    watchChanges($, bd)
    if (isPollMode && !isPolling) {
      isPolling = true
      poll($, bd)
    }
    const isExpanded = (await read($, expanded)) === id
    const narrowed = await read($, only)
    const onlyStatus = narrowed !== null && narrowed.id === id ? narrowed.status : null
    // Every link in the pane is Markdown, so one handler serves them all.
    const press = async (href: string) => {
      const target = href.slice(BASE.length)
      if (target === '~all') return update($, expanded, v => (v === id ? null : id))
      // A status count narrows the children to that status; pressed again, it clears.
      if (target.startsWith('~only:') && id !== null) {
        const status = target.slice('~only:'.length)
        return update($, only, v => (v?.id === id && v.status === status ? null : { id, status }))
      }
      if (target === '~home') return update($, selected, () => null)
      // Selected first, so the lookup fetches its comments.
      await update($, selected, () => target)
      refresh($, bd, [target])
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
    // Every ID is in the body font, as a desktop draws a link's code as plain
    // text. An ID in prose keeps its hyphen from breaking the line (`demo-` /
    // `g5h6`): the label gets a non-breaking hyphen, the link the real ID.
    const repo = found.repo
    // The files the shown bead links to that aren't in the session's folder,
    // such as a design still on an open pull request's branch.
    const shownBead = id === null ? undefined : all[id]
    const texts =
      shownBead?.kind === 'found'
        ? [
            shownBead.bead.description,
            shownBead.bead.closeReason,
            ...shownBead.bead.extras.map(x => x.text),
            ...(shownBead.bead.comments ?? []).map(c => c.text),
          ]
        : []
    for (const path of texts.flatMap(fileLinks)) {
      if (!fileExists.has(path)) fileExists.set(path, await $.fs.exists(path))
      if (fileExists.get(path) === false && repo && !fileElsewhere.has(path)) {
        findElsewhere($, path, repo)
      }
    }
    // A link to a file here stays; one to a file only on a pushed branch goes
    // to its copy on GitHub; one to a file on none is drawn as text.
    const fileTarget = (path: string) =>
      fileExists.get(path) === false ? (fileElsewhere.get(path) ?? null) : undefined
    const linkify = (text: string) => {
      const withBeads = linkIds(relinkFiles(text, fileTarget), prefix, ref =>
        link(ref, ref.replace(/-/g, '‑')),
      )
      return keepLineBreaks(repo ? linkGitHub(withBeads, repo) : withBeads)
    }

    // Notes written as dated entries show each entry under its date; any other
    // text keeps the line breaks it was written with.
    const notesBody = (label: string, text: string) => {
      const entries = label === 'Notes' ? datedEntries(text) : null
      if (!entries) return md(`text-${label}`, linkify(text))
      return (
        <Box key={`text-${label}`} flexDirection="column" gap="sm">
          {entries.map((entry, i) => (
            <Box key={`note-${i}`} flexDirection="column">
              <Text size="caption" color="subtle">
                {noteWhen(entry.when, nowMs)}
              </Text>
              {md(`note-${i}-text`, linkify(entry.text))}
            </Box>
          ))}
        </Box>
      )
    }

    // A section: a small upper-case heading over its content.
    const section = (
      key: string,
      heading: string,
      body: RenderChildren,
      color = 'subtle',
      badge: RenderChildren = null,
      icon: IconName | null = null,
    ) => (
      <Box key={key} flexDirection="column" gap="xs">
        <Box gap="xs" alignItems="center">
          {icon && Svg && (
            // Every Svg has an `alt`: a desktop draws none of one without.
            <Svg key={`${key}-icon`} alt={heading} {...iconSvg(icon, 13)} />
          )}
          <Text size="caption" weight="semibold" color={color}>
            {heading.toUpperCase()}
          </Text>
          {badge}
        </Box>
        {body}
      </Box>
    )
    // A speech bubble's outline, in about the grey of the heading beside it:
    // an SVG draws as an image, so it can't take the theme's colour.
    // The count in a speech bubble beside a heading, where the surface draws
    // SVG; the terminal gets the count as text.
    const bubble = (n: number) => {
      if (!Svg)
        return (
          <Text size="caption" color="subtle">
            {n}
          </Text>
        )
      const drawn = countBubble(n)
      return (
        <Svg
          key="count-bubble"
          alt={`${n}`}
          width={drawn.width}
          height={drawn.height}
          source={drawn.source}
        />
      )
    }
    // A list of beads, one row each: the ID in a grey column, the status glyph,
    // and the title as the link. A closed bead's title isn't dimmed, because
    // dim link blue on a dark background is hard to read. Children show only
    // their own `.n`, since the parent's ID is in the breadcrumb.
    // `spaced` puts room under each row, for a list read one bead at a time.
    // It is in the row's ID cell, which stretches over it, so a tree's lines
    // run through it to the next row.
    const list = (
      key: string,
      refs: Ref[],
      parentId = '',
      notes: Record<string, string> = {},
      spaced = false,
      rowKey = key,
      isRightAligned = parentId !== '',
      width: number | null = null,
      isBranch = false,
      hasStem = false,
    ) => {
      const shortOf = (r: Ref) =>
        parentId && r.id.startsWith(`${parentId}.`) ? r.id.slice(parentId.length) : r.id
      // The ID column is as wide as the longest ID in the list, so the glyphs
      // and titles form one straight column. A child's ID is a number such as
      // `.9` or `.11`, right-aligned so it lines up on its last digit, as in a
      // table; a full ID is left-aligned, since they all start alike.
      // A given width is the whole tree's column; otherwise it fits this list.
      const idWidth = width ?? Math.max(...refs.map(r => shortOf(r).length))
      // A priority slot only when some row has one, kept for every row so the
      // titles line up.
      const hasPriority = refs.some(r => r.priority !== undefined)
      const align = isRightAligned ? 'flex-end' : 'flex-start'
      // Each row's type icon, smaller and fainter than the title's, only in
      // a list that mixes types: in one of tasks alone it would say nothing.
      const showsTypes = new Set(refs.flatMap(r => (r.type ? [r.type] : []))).size > 1
      const typeOf = (r: Ref) => {
        const icon = Svg && r.type ? typeIcon(r.type, 12, 0, 0.7) : null
        // An image, not an interactive frame: a frame loads after its row, so
        // rows a filter brings back would draw their icons a beat late.
        return Svg && icon && <Svg key={`${rowKey}-${r.id}-type`} alt={r.type ?? ''} {...icon} />
      }
      return (
        <Box key={key} flexDirection="column">
          {refs.map((r, i) => (
            // Stretched, so the ID cell is as tall as a title that wraps.
            <Box key={`${rowKey}-${r.id}`} gap="xs" alignItems="stretch">
              {/* A child's branch back to its parent sits at the start of the
                  ID column, under the parent's ID, and the child's own ID at
                  its end: one line tall, drawn where the surface draws SVG,
                  box characters in the terminal. The rows touch, so the line
                  runs on to the next child. */}
              <Box
                width={idWidth}
                flexShrink={0}
                justifyContent={isBranch ? 'space-between' : align}
                // Stretched to the row, a Box centres what it holds on a
                // desktop: the ID, branch and priority stay on the first line.
                alignItems="flex-start"
                {...(spaced ? { paddingBottom: 'sm' as const } : {})}
                {...(Svg && (hasStem || (isBranch && i < refs.length - 1))
                  ? { overflow: 'hidden' as const }
                  : {})}
              >
                {/* Where the row wraps, the tree's line runs on below its
                    first line to the next row: under a parent's ID, or a
                    child's branch with siblings after it. Drawn long and
                    clipped by the cell, as an SVG can't stretch. */}
                {Svg && (hasStem || (isBranch && i < refs.length - 1)) && (
                  <Box position="absolute" top={0} left={0}>
                    <Svg
                      key={`${rowKey}-${r.id}-stem`}
                      alt="│"
                      width={BRANCH_WIDTH}
                      height={STEM_HEIGHT}
                      source={STEM_SVG}
                    />
                  </Box>
                )}
                {isBranch &&
                  (Svg ? (
                    <Svg
                      key={`${rowKey}-${r.id}-branch`}
                      alt={i === refs.length - 1 ? '└' : '├'}
                      width={BRANCH_WIDTH}
                      height={BRANCH_HEIGHT}
                      source={branchSvg(i === refs.length - 1)}
                    />
                  ) : (
                    <Text color="subtle">{i === refs.length - 1 ? '└' : '├'}</Text>
                  ))}
                {/* The branch's arm runs on to the ID, however short the ID:
                    drawn long and clipped by a box that takes the room left. */}
                {isBranch && Svg && (
                  <Box flexGrow={1} flexShrink={1} width={0} overflow="hidden" marginRight="xs">
                    <Svg
                      key={`${rowKey}-${r.id}-arm`}
                      alt="─"
                      width={ARM_WIDTH}
                      height={BRANCH_HEIGHT}
                      source={ARM_SVG}
                    />
                  </Box>
                )}
                <Text color="subtle">{shortOf(r)}</Text>
              </Box>
              <Text color={statusOf(r.status).color} dimColor={r.status === 'closed'}>
                {GLYPH[r.status] ?? '○'}
              </Text>
              {/* The bead's priority, read with its title; dim once closed,
                  as its glyph is. */}
              {hasPriority && (
                <Box width={2} flexShrink={0} alignItems="flex-start">
                  {r.priority !== undefined && (
                    <Text color={priorityColor(r.priority)} dimColor={r.status === 'closed'}>
                      P{r.priority}
                    </Text>
                  )}
                </Box>
              )}
              {/* A zero-width character makes the slot one line tall, so the
                  icon centres on the title's first line. */}
              {Svg && showsTypes && (
                <Box
                  width={2}
                  flexShrink={0}
                  alignItems="center"
                  justifyContent="center"
                  alignSelf="flex-start"
                >
                  {typeOf(r)}
                  <Text>{'​'}</Text>
                </Box>
              )}
              <Box flexGrow={1} flexShrink={1}>
                {md(`${rowKey}-${r.id}-title`, link(r.id, r.title || r.id))}
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
      lastShown = null
      askActor($, bd)
      const seen = Object.entries(await read($, touched)).sort(([, a], [, b]) => b.atMs - a.atMs)
      ensure(
        $,
        bd,
        seen.flatMap(([ref]) => (ref in all ? [] : [ref])),
      )
      const rowsOf = (entries: typeof seen): Ref[] =>
        entries.flatMap(([ref]) => {
          const entry = all[ref]
          if (entry?.kind === 'missing') return []
          const bead = entry?.kind === 'found' ? entry.bead : null
          return [
            {
              id: ref,
              title: bead?.title ?? '',
              status: bead?.status ?? '',
              ...(bead?.priority !== null && bead?.priority !== undefined
                ? { priority: bead.priority }
                : {}),
            },
          ]
        })
      // The beads the session worked on, each with what it last did, then the
      // ones a reply only linked.
      const worked = rowsOf(seen.filter(([, t]) => isWork(t.how)))
      const looked = rowsOf(seen.filter(([, t]) => !isWork(t.how)))
      const notes = Object.fromEntries(seen.map(([ref, t]) => [ref, t.how]))
      if (worked.length === 0 && looked.length === 0) {
        return (
          <Text color="subtle">
            None yet. A bead this session links, claims, creates, changes or closes shows here.
          </Text>
        )
      }
      // Beads that share a parent sit under its title, each by its own
      // `.n`, so the parent shows once; a bead with none is a row of its own.
      const parentOf = (ref: string) => {
        const entry = all[ref]
        return entry?.kind === 'found' ? entry.bead.parent : null
      }
      // A tree: each parent a full row of its own, its children indented under
      // it by their `.n`, and the beads with no parent rows beside it. Every
      // top-level row shares one ID column, so their glyphs line up and a bead
      // after a group reads as the parent's sibling, not its child.
      // The groups a tree draws: a parent that's also in the list shows once,
      // as its group's row.
      const groupsOf = (rows: Ref[]) => {
        const groups = underParents(rows, parentOf)
        const parentIds = new Set(groups.flatMap(g => (g.parent ? [g.parent.id] : [])))
        return groups
          .map(g => ({ ...g, rows: g.parent ? g.rows : g.rows.filter(r => !parentIds.has(r.id)) }))
          .filter(g => g.parent || g.rows.length > 0)
      }
      // One ID column for every row of both lists, children included, so all
      // glyphs, priorities and titles line up. A child's cell holds its
      // branch, its `.n` and a cell between them.
      const childIdOf = (r: Ref, parentId: string) =>
        r.id.startsWith(`${parentId}.`) ? r.id.slice(parentId.length) : r.id
      const widthOf = (rows: Ref[]) =>
        Math.max(
          0,
          ...groupsOf(rows).flatMap(g =>
            g.parent
              ? [
                  g.parent.id.length,
                  ...g.rows.map(r => BRANCH_CELLS + 1 + childIdOf(r, g.parent?.id ?? '').length),
                ]
              : g.rows.map(r => r.id.length),
          ),
        )
      const tree = (
        key: string,
        rows: Ref[],
        rowNotes: Record<string, string>,
        topWidth: number,
      ) => {
        const shown = groupsOf(rows)
        return (
          <Box key={key} flexDirection="column" gap="sm">
            {shown.map(group =>
              group.parent === null ? (
                list(
                  `${key}-group-${group.rows[0]?.id}`,
                  group.rows,
                  '',
                  rowNotes,
                  true,
                  key,
                  false,
                  topWidth,
                )
              ) : (
                <Box key={`${key}-under-${group.parent.id}`} flexDirection="column">
                  {list(
                    `${key}-parent-${group.parent.id}`,
                    [group.parent],
                    '',
                    rowNotes,
                    true,
                    key,
                    false,
                    topWidth,
                    false,
                    group.rows.length > 0,
                  )}
                  {list(
                    `${key}-group-${group.parent.id}`,
                    group.rows,
                    group.parent.id,
                    rowNotes,
                    true,
                    key,
                    true,
                    topWidth,
                    true,
                  )}
                </Box>
              ),
            )}
          </Box>
        )
      }
      const width = Math.max(widthOf(worked), widthOf(looked))
      return (
        <Box flexDirection="column" gap="lg">
          {worked.length > 0 &&
            section('worked-section', 'Worked on', tree('worked', worked, notes, width))}
          {looked.length > 0 &&
            section('mentioned-section', 'Mentioned', tree('mentioned', looked, {}, width))}
        </Box>
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
    lastShown = id

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

    // The breadcrumb: ▤ for the pane's list, then each bead above, then
    // this one. As in the lists, a bead's link is its title and its ID is
    // grey: each ancestor by its title, shortened, and this bead by its ID.
    const shortTitle = (title: string) =>
      title.length <= 32 ? title : `${title.slice(0, 32).replace(/\s+\S*$/, '')}…`
    // A wait longer than OPENING_MS names the bead being opened in the
    // breadcrumb, so a slow click still shows. Nothing below it moves.
    if (!isWaiting) waiting = null
    else if (waiting?.id !== wanted) {
      waiting = { id: wanted, sinceMs: nowMs }
      showOpeningLater($)
    }
    const isOpeningShown = waiting !== null && nowMs - waiting.sinceMs >= OPENING_MS
    const steps: { to: string; label: string }[] = isOpeningShown
      ? [{ to: '', label: `${wanted} · opening…` }]
      : [
          ...above.map(r => ({ to: r.id, label: shortTitle(r.title || r.id) })),
          { to: '', label: id },
        ]
    const crumbs = (
      // Links and grey text in one row, top-aligned: both are a body line
      // tall, so their text lines up, where centring aligns their boxes.
      <Box key="trail" gap="xs" alignItems="flex-start" flexWrap="wrap">
        {md('crumb-home', link('~home', '▤'))}
        {steps.flatMap(step => [
          // A drawn chevron, centred on the line as the type icons are: the
          // › glyph is small and sits at the lower case's height.
          Svg ? (
            <Box key={`sep-${step.label}`} alignItems="center" marginX="xs">
              <Svg alt="›" width={7} height={11} source={CHEVRON_SVG} />
              <Text>{'\u200b'}</Text>
            </Box>
          ) : (
            <Text key={`sep-${step.label}`} color="subtle">
              ›
            </Text>
          ),
          step.to === '' ? (
            <Text key={`crumb-${step.label}`} color="subtle">
              {step.label}
            </Text>
          ) : (
            md(`crumb-${step.to}`, link(step.to, step.label))
          ),
        ])}
      </Box>
    )

    const status = statusOf(bead.status)
    const refHref = bead.externalRef === '' ? null : refUrl(bead.externalRef, repo)

    const isBlocked = bead.blockedBy.some(b => b.status !== 'closed')
    // Centred on the title's line, the icon centres on the capitals, a
    // little taller than they are.
    const titleIcon = typeIcon(bead.type, 16, 0, 1, true)

    // Children whose IDs nest under this bead's come first, in ID order, so
    // they set the ID column; a child filed elsewhere comes after them.
    const nests = (r: Ref) => r.id.startsWith(`${id}.`)
    const kids = [...bead.children.filter(nests), ...bead.children.filter(r => !nests(r))]
    // A bar with a run of cells in each status's colour, done first, as the
    // context bar shows what fills the window.
    const runs = barRuns(kids, 20)
    // A long list is summarised: a count for each status left, then the work
    // left and a link to the rest. The heading counts the closed ones.
    const LONG = 12
    const FIRST = 8
    const isLong = kids.length > LONG
    const shown =
      onlyStatus !== null
        ? kids.filter(k => k.status === onlyStatus)
        : isLong && !isExpanded
          ? summarised(kids, FIRST)
          : kids
    // The children on screen are looked up now, in the same `bd show` as the
    // blockers, so opening one is usually instant.
    ensure(
      $,
      bd,
      shown.flatMap(k => (k.id in all ? [] : [k.id])),
    )
    // Every status's count, closed included, as a chip that filters to it.
    const counts = countByStatus(kids)
    const children = kids.length > 0 && (
      <Box key="children" flexDirection="column" gap="xs">
        {/* Each status's count, left-aligned: links that filter on a long
            list, `5/7` on a short one; then the progress bar, a few pixels
            tall where the surface draws SVG. The `.n` IDs below say these
            are the children, so the block needs no heading. */}
        <Box flexDirection="column" gap="xs">
          {isLong && counts.length > 1 ? (
            <Box gap="md" flexWrap="wrap" alignItems="center">
              {counts.map(([st, n]) => {
                // A link per status after its coloured glyph: a desktop's
                // native button has no small size, and outweighed the
                // title. With one on, the others dim, so nothing changes
                // width and the row stays put; pressing it again clears it.
                const isDim = onlyStatus !== null && st !== onlyStatus
                return (
                  <Box key={`chip-${st}`} gap="xs" alignItems="center">
                    <Text color={statusOf(st).color} dimColor={isDim}>
                      {GLYPH[st] ?? '○'}
                    </Text>
                    <Markdown
                      key={`count-${st}`}
                      text={link(`~only:${st}`, `${n} ${statusOf(st).label.toLowerCase()}`)}
                      dimColor={isDim}
                      pressableLinks={[`${BASE}~only:${st}`]}
                      onLinkPress={pressed => {
                        press(pressed.href).catch(err =>
                          logFailure($, 'filtering the children', err),
                        )
                      }}
                    />
                  </Box>
                )
              })}
            </Box>
          ) : (
            <Text size="caption" color="subtle">
              {kids.filter(k => k.status === 'closed').length}/{kids.length}
            </Text>
          )}
          {Svg ? (
            <Svg
              key="bar"
              alt={`${kids.filter(k => k.status === 'closed').length} of ${kids.length} closed`}
              {...progressBar(runs)}
            />
          ) : (
            <Text size="caption">
              {runs.map(([st, n]) => (
                <Text key={`bar-${st}`} color={statusOf(st).color} dimColor={st === 'closed'}>
                  {'━'.repeat(n)}
                </Text>
              ))}
            </Text>
          )}
        </Box>
        {list('kids', shown, id)}
        {isLong &&
          onlyStatus === null &&
          md('all', link('~all', isExpanded ? 'Show fewer' : `Show all ${kids.length}`))}
      </Box>
    )

    const isEpic = bead.type === 'epic'

    return (
      <Box flexDirection="column" gap="lg">
        {/* The description sits closer to the header than the sections below
            sit to each other: it is the header's body. */}
        <Box flexDirection="column" gap="md">
          <Box flexDirection="column" gap="xs">
            {/* The breadcrumb row is always drawn, so the rest of the pane stays
              in place when it moves to another bead. It is the pane's only
              navigation: ▤ leads to this session's beads, ancestors
              are links, and the conversation's links reopen anything else. */}
            {crumbs}
            {/* The type's icon leads the title, so an epic, a task and a bug
              look different at a glance; the status line names the type. */}
            <Box gap="xs" alignItems="flex-start">
              {Svg && titleIcon && (
                // A zero-width character in the title's size makes this box one
                // title line tall, so the icon centres on the first line.
                <Box alignItems="center" flexShrink={0}>
                  <Svg key="type-icon" alt={bead.type} {...titleIcon} isInteractive />
                  <Text size="heading" weight="semibold">
                    {'\u200b'}
                  </Text>
                </Box>
              )}
              <Text size="heading" weight="semibold">
                {bead.title}
              </Text>
            </Box>
            {/* Status, priority, type and assignee, then where the bead is
              tracked elsewhere, as a link where it can be one. */}
            <Box gap="xs" alignItems="center" flexWrap="wrap">
              <Text size="footnote">
                <Text color={status.color} dimColor={bead.status === 'closed'}>
                  {GLYPH[bead.status] ?? '○'}{' '}
                </Text>
                {status.label}
                {bead.priority !== null && <Text color="subtle">{'  ·  '}</Text>}
                {bead.priority !== null && (
                  <Text color={priorityColor(bead.priority)}>P{bead.priority}</Text>
                )}
                {/* The type in words only where no icon says it. */}
                {bead.type !== '' && !(Svg && titleIcon) && <Text color="subtle">{'  ·  '}</Text>}
                {bead.type !== '' &&
                  !(Svg && titleIcon) &&
                  bead.type.replace(/^./, c => c.toUpperCase())}
                <Text color="subtle">{'  ·  '}</Text>
                {bead.assignee ? bead.assignee : <Text color="subtle">Unassigned</Text>}
              </Text>
              {refHref !== null && <Text color="subtle">·</Text>}
              {refHref !== null && md('ref', `[${refLabel(bead.externalRef)}](${refHref})`)}
              {/* Then, smaller, when it last changed, any ref that can't be a
                link, and its labels: one row, wrapping on a narrow pane. */}
              <Text color="subtle">·</Text>
              <Text size="caption" color="subtle">
                {[
                  bead.status === 'closed' && bead.closedMs !== null
                    ? `Closed ${ago(bead.closedMs, nowMs)}`
                    : `Updated ${ago(bead.updatedMs, nowMs)}`,
                  `created ${ago(bead.createdMs, nowMs)}`,
                  refHref === null ? bead.externalRef : '',
                  ...bead.labels,
                ]
                  .filter(part => part !== '')
                  .join(' · ')}
              </Text>
            </Box>
          </Box>
          {/* The bead's main text, under its title as an issue's body is, so it
            needs no heading of its own. */}
          {bead.description.trim() !== '' && md('desc', linkify(bead.description))}
        </Box>
        {/* Every blocker, closed ones too, so it's plain what the bead waited
            on: under a red heading while any is open, a grey one after. */}
        {bead.blockedBy.length > 0 &&
          section(
            'blockers',
            isBlocked ? 'Blocked by' : 'Was blocked by',
            list('blocker-list', bead.blockedBy),
            isBlocked ? 'error' : 'subtle',
          )}
        {isEpic && children}
        {bead.status === 'closed' &&
          bead.closeReason.trim() !== '' &&
          section(
            'resolution',
            'Resolution',
            md('text-resolution', linkify(bead.closeReason)),
            'subtle',
            null,
            'resolution',
          )}
        {bead.extras.map(x =>
          section(
            `extra-${x.label}`,
            x.label,
            notesBody(x.label, x.text),
            'subtle',
            null,
            EXTRA_ICONS[x.label] ?? null,
          ),
        )}
        {bead.specId !== '' &&
          section('spec', 'Spec', <Text>{bead.specId}</Text>, 'subtle', null, 'spec')}
        {/* Drawn once the comments are in, so the section doesn't flash. */}
        {bead.comments !== null &&
          bead.comments.length > 0 &&
          section(
            'comments',
            'Comments',
            <Box flexDirection="column" gap="sm">
              {bead.comments.map((c, i) => (
                <Box key={`comment-${i}`} flexDirection="column">
                  <Text size="caption" color="subtle">
                    {c.author || 'Someone'} · {ago(c.createdMs, nowMs)}
                  </Text>
                  {md(`comment-${i}-text`, linkify(c.text))}
                </Box>
              ))}
            </Box>,
            'subtle',
            bubble(bead.comments.length),
          )}
        {!isEpic && children}
      </Box>
    )
  })
}
