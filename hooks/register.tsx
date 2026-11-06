import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Bead, Ref } from '../types'

// A bead ID is `fp-` and three to five base-36 characters, plus `.n` for each
// level of child (`fp-g5h6.4`, `fp-abcd.1.2`). Skip
// one already inside a link, a code span or a path.
const ID = /(?<![\w[`/.-])fp-[a-z0-9]{3,6}(?:\.\d+)*(?![\w\]`/-])/g
const BD = '/opt/homebrew/bin/bd'
const BASE = 'https://beads.invalid/'
const PANE = 'bead'

// null: asked, and no such bead. Change the tag when Bead's fields change.
const beads = atom({ plugin: 'bead-pane', key: 'beads' } as const, {}, {
  shape: 'beads-6',
})
// The bead the pane shows. Hover reveals do
// not draw on the desktop surface, so a press on an ID opens the pane instead.
const selected = atom({ plugin: 'bead-pane', key: 'selected' } as const, null, {
  shape: 'selected-1',
})

// The bead whose long list of children the person has opened in full, if any.
// Moving to another bead leaves it, so each long list starts summarised.
const expanded = atom({ plugin: 'bead-pane', key: 'expanded' } as const, null, {
  shape: 'expanded-1',
})

// One glyph per status, all from the circle family so they read as one set:
// empty to full as work moves on, with the status colour on top. The header
// and every list use the same glyph. Closed's green is drawn dim wherever it
// appears: a column of full-strength green dots is the loudest thing in a list.
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

const ago = (iso: string, now: number): string => {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return '-'
  const mins = Math.max(0, Math.round((now - then) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  if (mins < 2880) return `${Math.round(mins / 60)}h ago`
  if (mins < 86400) return `${Math.round(mins / 1440)}d ago`
  return new Date(then).toLocaleDateString()
}

// `fp-g5h6.10` after `fp-g5h6.9`: the numeric parts compare as numbers.
const byId = (a: Ref, b: Ref): number => {
  const pa = a.id.split('.')
  const pb = b.id.split('.')
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? ''
    const y = pb[i] ?? ''
    const n = Number(x) - Number(y)
    if (x !== y) return Number.isNaN(n) || n === 0 ? x.localeCompare(y) : n
  }
  return 0
}

// Bead IDs already asked about this load; a reload asks again, once each.
const asked = new Set<string>()

// Looks a bead up off the current dispatch and caches it, so a draw never
// waits on `bd`; the atom's write redraws whatever reads it.
function ensure($: EngineInterface, id: string): void {
  if (asked.has(id)) return
  asked.add(id)
  $.clock.after(0, async () => {
    const ran = await $.process.run([BD, 'show', id, '--json'], {
      timeoutMs: 10000,
    })
    let bead: Bead | null = null
    if (ran.exitCode === 0) {
      try {
        const row = JSON.parse(ran.stdout)[0]
        const deps: { id: string; title: string; status: string; dependency_type?: string }[] =
          row.dependencies ?? []
        bead = {
          status: String(row.status ?? '?'),
          title: String(row.title ?? ''),
          description: String(row.description ?? ''),
          priority: typeof row.priority === 'number' ? row.priority : null,
          type: String(row.issue_type ?? ''),
          assignee: String(row.assignee ?? ''),
          created: String(row.created_at ?? ''),
          updated: String(row.updated_at ?? ''),
          extras: (
            [
              ['Notes', row.notes],
              ['Design', row.design],
              ['Acceptance criteria', row.acceptance_criteria],
            ] as const
          )
            .filter(([, text]) => typeof text === 'string' && text.trim() !== '')
            .map(([label, text]) => ({ label, text: String(text) })),
          blockedBy: deps
            .filter(dep => dep.dependency_type === 'blocks')
            .map(dep => ({
              id: String(dep.id),
              title: String(dep.title ?? ''),
              status: String(dep.status ?? ''),
            })),
          parent: null,
          children: [],
          closeReason: String(row.close_reason ?? ''),
        }
        const up = deps.find(dep => dep.dependency_type === 'parent-child' || dep.id === row.parent)
        if (up) {
          bead.parent = {
            id: String(up.id),
            title: String(up.title ?? ''),
            status: String(up.status ?? ''),
          }
        }
        // Only a bead something depends on can have children: skip the call otherwise.
        if (Number(row.dependent_count ?? 0) > 0) {
          const kids = await $.process.run([BD, 'children', id, '--json'], {
            timeoutMs: 10000,
          })
          if (kids.exitCode === 0) {
            const rows: { id: string; title: string; status: string }[] = JSON.parse(kids.stdout)
            bead.children = rows
              .map(k => ({ id: String(k.id), title: String(k.title ?? ''), status: String(k.status ?? '') }))
              .sort(byId)
          }
        }
      } catch {
        bead = null
      }
    }
    await update($, beads, all => ({ ...all, [id]: bead }))
  })
}

export const register: Register = on => {
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const ids = [...new Set(e.props.text.match(ID) ?? [])]
    if (ids.length === 0) return next(e)

    const known = await read($, beads)
    for (const id of ids) if (!(id in known)) ensure($, id)

    // Only a bead the lookup found becomes a link; the rest stays text.
    const links = ids.filter(id => known[id])
    if (links.length === 0) return next(e)

    const { Markdown } = $.ui.resolve(e)
    const text = e.props.text.replace(ID, id =>
      known[id] ? `[${id}](${BASE}${id})` : id,
    )

    return (
      <Markdown
        key={`msg-${e.requestId}`}
        text={text}
        pressableLinks={links.map(id => `${BASE}${id}`)}
        onLinkPress={async link => {
          await update($, selected, () => link.href.slice(BASE.length))
          await $.ui.open({ id: PANE, title: 'Bead' })
        }}
      />
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Markdown } = $.ui.resolve(e)
    const id = await read($, selected)
    const all = await read($, beads)
    if (id === null) {
      return <Text color="subtle">Click a bead ID in the conversation to see it here.</Text>
    }
    const bead = all[id]
    if (bead === undefined) return <Text color="subtle">Loading {id}…</Text>
    if (bead === null) return <Text color="subtle">{id} is not a bead.</Text>

    const now = await $.clock.now()
    const isExpanded = (await read($, expanded)) === id
    const go = async (to: string) => {
      ensure($, to)
      await update($, selected, () => to)
    }
    // Every link in the pane is Markdown, so one handler serves them all.
    const press = async (href: string) => {
      const target = href.slice(BASE.length)
      if (target === '~all') return update($, expanded, v => (v === id ? null : id))
      return go(target)
    }
    const md = (key: string, text: string, isDim = false) => {
      const links = [...text.matchAll(/\]\((https:\/\/beads\.invalid\/[^)\s]+)\)/g)].map(m => m[1])
      return (
        <Markdown
          key={key}
          text={text}
          dimColor={isDim}
          pressableLinks={links}
          onLinkPress={link => press(link.href)}
        />
      )
    }
    const link = (to: string, label = to) => `[${label}](${BASE}${to})`
    // An ID in prose keeps its hyphen from breaking the line (`fp-` / `g5h6`):
    // the label gets a non-breaking hyphen, the link keeps the real ID.
    const linkify = (text: string) => text.replace(ID, ref => link(ref, ref.replace(/-/g, '\u2011')))

    // The chain of beads above this one, outermost first, as far as it is known.
    const above: Ref[] = []
    for (let ref = bead.parent, seen = 0; ref && seen < 8; seen++) {
      above.unshift(ref)
      ensure($, ref.id)
      const up = all[ref.id]
      ref = up ? up.parent : null
    }
    for (const b of bead.blockedBy) if (!(b.id in all)) ensure($, b.id)

    // The breadcrumb: each bead below the first by its own `.n`, as the IDs
    // nest (`fp-g5h6 › .5 › .1`); the bead shown is the last, unlinked.
    const trail = [...above.map(r => r.id), id]
      .map((ref, i, all) => {
        const prev = all[i - 1]
        const label = prev && ref.startsWith(`${prev}.`) ? ref.slice(prev.length) : ref
        return i === all.length - 1 ? label : link(ref, label)
      })
      .join(' › ')

    const status = statusOf(bead.status)
    // A section: a small upper-case heading over its content, the same for
    // every section, so the eye finds them by shape.
    const section = (key: string, heading: string, body: unknown, color = 'subtle') => (
      <Box key={key} flexDirection="column" gap="xs">
        <Text size="caption" weight="semibold" color={color}>
          {heading.toUpperCase()}
        </Text>
        {body}
      </Box>
    )
    // A list of beads, one row each: the ID in a quiet column, a status glyph
    // in its colour, and the title as the link. Link colour stays at full
    // strength: dimmed link blue on a dark background is hard to read, so the
    // glyph alone says a bead is closed. Children show only their own `.n`,
    // since the parent's part is the bead above them.
    const list = (key: string, refs: Ref[], prefix = '') => {
      const shortOf = (r: Ref) =>
        prefix && r.id.startsWith(`${prefix}.`) ? r.id.slice(prefix.length) : r.id
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
            </Box>
          ))}
        </Box>
      )
    }

    const openBlockers = bead.blockedBy.filter(b => b.status !== 'closed')
    const doneBlockers = bead.blockedBy.length - openBlockers.length

    const kids = bead.children
    const doneKids = kids.filter(k => k.status === 'closed')
    const BAR = 12
    const filled = kids.length ? Math.round((doneKids.length / kids.length) * BAR) : 0
    // A long list is summarised: a count for each status, then the first few
    // in ID order and a link to the rest. Order, not status, decides what shows.
    const LONG = 12
    const FIRST = 8
    const isLong = kids.length > LONG
    const shown = isLong && !isExpanded ? kids.slice(0, FIRST) : kids
    // The heading already counts the closed ones (`120/178`), so the summary
    // counts only the rest, and says nothing when nothing else is left.
    const counts = Object.entries(
      kids
        .filter(k => k.status !== 'closed')
        .reduce<Record<string, number>>((n, k) => ({ ...n, [k.status]: (n[k.status] ?? 0) + 1 }), {}),
    )
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
            <Text color="success" dimColor>
              {'━'.repeat(filled)}
            </Text>
            <Text color="subtle">{'━'.repeat(BAR - filled)}</Text>
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
        {isLong &&
          md('all', link('~all', isExpanded ? 'Show fewer' : `Show all ${kids.length}`))}
      </Box>
    )

    const isEpic = bead.type === 'epic'

    return (
      <Box flexDirection="column" gap="lg">
        <Box flexDirection="column" gap="xs">
          {/* The breadcrumb, always there, so moving between beads moves nothing.
              It is the pane's only navigation: ancestors are links, and the
              conversation's links reopen anything else. */}
          <Box>
            <Markdown
              key="trail"
              text={trail}
              pressableLinks={above.map(r => `${BASE}${r.id}`)}
              onLinkPress={l => press(l.href)}
            />
          </Box>
          <Text size="heading" weight="semibold">
            {bead.title}
          </Text>
          {/* The properties in one line, separated so none reads as a badge,
              and the dates under it, quieter. */}
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
            Updated {ago(bead.updated, now)} · created {ago(bead.created, now)}
          </Text>
        </Box>
        {openBlockers.length > 0 &&
          section('blockers', `Blocked by`, list('blocker-list', openBlockers), 'error')}
        {openBlockers.length === 0 && doneBlockers > 0 && (
          <Text size="footnote" color="subtle">
            <Text color="success" dimColor>
              {GLYPH.closed}{' '}
            </Text>
            {doneBlockers === 1 ? 'Its blocker is closed' : `All ${doneBlockers} blockers are closed`}
          </Text>
        )}
        {isEpic && children}
        {bead.description.trim() !== '' &&
          section('description', 'Description', md('desc', linkify(bead.description)))}
        {bead.status === 'closed' &&
          bead.closeReason.trim() !== '' &&
          section('resolution', 'Resolution', md('text-resolution', linkify(bead.closeReason)))}
        {bead.extras.map(x => section(`extra-${x.label}`, x.label, md(`text-${x.label}`, linkify(x.text))))}
        {!isEpic && children}
      </Box>
    )
  })
}
